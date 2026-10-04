//! Native bridge to the OpenAI Codex CLI running as `codex app-server`.
//!
//! The webview can only start the located `codex` binary with the fixed
//! subcommand `app-server` plus validated `-c key=value` overrides from an
//! allowlist. It exchanges newline-delimited JSON-RPC lines over stdio.

use serde::Serialize;
use std::{
    collections::HashMap,
    ffi::OsString,
    io::{BufRead, BufReader, Read, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{
        atomic::{AtomicU32, Ordering},
        mpsc, Arc, Mutex, MutexGuard, OnceLock, PoisonError,
    },
    thread,
    time::{Duration, Instant},
};
use tauri::{ipc::Channel, AppHandle, Manager, RunEvent, WebviewWindow, WindowEvent, Wry};

/// Config keys the webview may override. Entries ending in `.` are prefixes.
const ALLOWED_CONFIG_KEYS: &[&str] = &[
    "web_search",
    "model_reasoning_summary",
    "features.",
    "tools.",
    "sandbox_mode",
    "approval_policy",
    "show_raw_agent_reasoning",
    "hide_agent_reasoning",
    "model_reasoning_effort",
];
const MAX_CONFIG_ENTRIES: usize = 32;
const MAX_CONFIG_VALUE_CHARS: usize = 200;
/// Characters that `cmd.exe` interprets even inside arguments. Rejected on
/// every platform so validation does not depend on how the binary is launched.
const FORBIDDEN_VALUE_CHARS: &[char] = &['%', '!', '^', '&', '|', '<', '>'];

const LOGIN_SHELL_TIMEOUT: Duration = Duration::from_secs(3);
const VERSION_TIMEOUT: Duration = Duration::from_secs(5);
/// Time a session gets to exit on its own after stdin closes before it is killed.
const STOP_GRACE: Duration = Duration::from_millis(500);
const EXIT_POLL: Duration = Duration::from_millis(100);
/// Upper bound for draining remaining output after the process exited.
const DRAIN_TIMEOUT: Duration = Duration::from_secs(1);
#[cfg_attr(windows, allow(dead_code))]
const PATH_MARKER: &str = "__AGENTZ_PATH__";

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CodexLocation {
    pub path: String,
    pub version: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum CodexEvent {
    Stdout { line: String },
    Stderr { line: String },
    Exit { code: Option<i32> },
}

struct Session {
    child: Arc<Mutex<Child>>,
    stdin: Arc<Mutex<Option<ChildStdin>>>,
}

type Sessions = Arc<Mutex<HashMap<u32, Session>>>;

/// Managed state holding every running app-server process.
#[derive(Default)]
pub struct Codex {
    sessions: Sessions,
    next_id: AtomicU32,
}

/// A panic in one reader thread must not disable the bridge.
fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

fn require_main(window: &WebviewWindow<Wry>) -> Result<(), String> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err("only the main window may control Codex".into())
    }
}

/// Validates one `key=value` override against the allowlist.
fn validate_config_entry(entry: &str) -> Result<(), String> {
    let invalid = || format!("config override not allowed: {entry:?}");
    let (key, value) = entry.split_once('=').ok_or_else(invalid)?;
    if key.is_empty()
        || !key
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '.')
    {
        return Err(invalid());
    }
    let allowed = ALLOWED_CONFIG_KEYS
        .iter()
        .any(|allowed| match allowed.strip_suffix('.') {
            Some(_) => key.len() > allowed.len() && key.starts_with(allowed),
            None => key == *allowed,
        });
    if !allowed {
        return Err(invalid());
    }
    let count = value.chars().count();
    if count == 0
        || count > MAX_CONFIG_VALUE_CHARS
        || value
            .chars()
            .any(|c| c.is_control() || FORBIDDEN_VALUE_CHARS.contains(&c))
    {
        return Err(invalid());
    }
    Ok(())
}

fn validate_config(config: &[String]) -> Result<(), String> {
    if config.len() > MAX_CONFIG_ENTRIES {
        return Err("too many config overrides".into());
    }
    config
        .iter()
        .try_for_each(|entry| validate_config_entry(entry))
}

/// Builds the fixed argument list: `app-server [-c k=v ...]`.
fn app_server_args(config: &[String]) -> Vec<String> {
    let mut args = vec!["app-server".to_string()];
    for entry in config {
        args.push("-c".into());
        args.push(entry.clone());
    }
    args
}

/// Runs a command and returns its stdout, or `None` on failure or timeout.
fn output_with_timeout(mut command: Command, timeout: Duration) -> Option<String> {
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    hide_console(&mut command);
    let mut child = command.spawn().ok()?;
    let mut stdout = child.stdout.take()?;
    let (tx, rx) = mpsc::channel();
    // A grandchild may keep the pipe open; never join this reader.
    thread::spawn(move || {
        let mut buffer = Vec::new();
        let _ = stdout.read_to_end(&mut buffer);
        let _ = tx.send(buffer);
    });
    let deadline = Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let remaining = deadline.saturating_duration_since(Instant::now());
                let buffer = rx.recv_timeout(remaining.max(EXIT_POLL)).ok()?;
                return status
                    .success()
                    .then(|| String::from_utf8_lossy(&buffer).into_owned());
            }
            Ok(None) if Instant::now() < deadline => thread::sleep(Duration::from_millis(20)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    }
}

#[cfg(windows)]
fn hide_console(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
fn hide_console(_command: &mut Command) {}

fn home_dir() -> Option<PathBuf> {
    #[cfg(windows)]
    let home = std::env::var_os("USERPROFILE");
    #[cfg(not(windows))]
    let home = std::env::var_os("HOME");
    home.filter(|value| !value.is_empty()).map(PathBuf::from)
}

/// Extracts the PATH printed between markers, ignoring rc-file noise.
#[cfg_attr(windows, allow(dead_code))]
fn parse_marked_path(output: &str) -> Option<String> {
    let start = output.find(PATH_MARKER)? + PATH_MARKER.len();
    let rest = &output[start..];
    let end = rest.find(PATH_MARKER)?;
    let path = rest[..end].trim();
    (!path.is_empty()).then(|| path.to_string())
}

/// macOS GUI apps do not inherit the shell PATH; ask the login shell once.
#[cfg(not(windows))]
fn login_shell_path() -> Option<String> {
    let script = format!("printf '{PATH_MARKER}%s{PATH_MARKER}' \"$PATH\"");
    let configured = std::env::var("SHELL")
        .ok()
        .filter(|shell| shell.starts_with('/'));
    let shells = configured.into_iter().chain(["/bin/zsh".to_string()]);
    for shell in shells {
        let mut command = Command::new(&shell);
        command.args(["-ilc", &script]);
        if let Some(path) = output_with_timeout(command, LOGIN_SHELL_TIMEOUT)
            .as_deref()
            .and_then(parse_marked_path)
        {
            return Some(path);
        }
    }
    None
}

#[cfg(windows)]
fn login_shell_path() -> Option<String> {
    None
}

/// Directories where Codex installers and Node version managers put binaries.
fn common_dirs(home: Option<&Path>) -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    #[cfg(not(windows))]
    {
        if let Some(home) = home {
            for relative in [
                ".local/bin",
                ".codex/bin",
                ".npm-global/bin",
                ".volta/bin",
                ".bun/bin",
            ] {
                dirs.push(home.join(relative));
            }
            let mut nvm: Vec<PathBuf> = std::fs::read_dir(home.join(".nvm/versions/node"))
                .map(|entries| {
                    entries
                        .flatten()
                        .map(|entry| entry.path().join("bin"))
                        .collect()
                })
                .unwrap_or_default();
            // Newest version first (lexicographic is good enough as a tiebreaker).
            nvm.sort();
            nvm.reverse();
            dirs.extend(nvm);
        }
        dirs.push(PathBuf::from("/opt/homebrew/bin"));
        dirs.push(PathBuf::from("/usr/local/bin"));
    }
    #[cfg(windows)]
    {
        if let Some(appdata) = std::env::var_os("APPDATA") {
            dirs.push(PathBuf::from(appdata).join("npm"));
        }
        if let Some(home) = home {
            dirs.push(home.join(".local").join("bin"));
            dirs.push(home.join(".codex").join("bin"));
            dirs.push(home.join(".volta").join("bin"));
            dirs.push(home.join(".bun").join("bin"));
        }
    }
    dirs
}

/// Joins path lists in order, dropping empty and duplicate entries.
fn merge_paths(lists: impl IntoIterator<Item = Vec<PathBuf>>) -> Vec<PathBuf> {
    let mut merged: Vec<PathBuf> = Vec::new();
    for dir in lists.into_iter().flatten() {
        if !dir.as_os_str().is_empty() && !merged.contains(&dir) {
            merged.push(dir);
        }
    }
    merged
}

fn split_path(value: &str) -> Vec<PathBuf> {
    std::env::split_paths(value).collect()
}

/// The PATH used for lookup and for the child: login shell, own env, common dirs.
fn resolved_path() -> &'static [PathBuf] {
    static PATH: OnceLock<Vec<PathBuf>> = OnceLock::new();
    PATH.get_or_init(|| {
        let shell = login_shell_path()
            .map(|path| split_path(&path))
            .unwrap_or_default();
        let own = std::env::var_os("PATH")
            .map(|path| std::env::split_paths(&path).collect())
            .unwrap_or_default();
        merge_paths([shell, own, common_dirs(home_dir().as_deref())])
    })
}

#[cfg(not(windows))]
fn executable_in(dir: &Path) -> Option<PathBuf> {
    use std::os::unix::fs::PermissionsExt;
    let candidate = dir.join("codex");
    let metadata = std::fs::metadata(&candidate).ok()?;
    (metadata.is_file() && metadata.permissions().mode() & 0o111 != 0).then_some(candidate)
}

#[cfg(windows)]
fn executable_in(dir: &Path) -> Option<PathBuf> {
    ["codex.exe", "codex.cmd"]
        .iter()
        .map(|name| dir.join(name))
        .find(|candidate| candidate.is_file())
}

fn find_codex(dirs: &[PathBuf]) -> Option<PathBuf> {
    dirs.iter().find_map(|dir| executable_in(dir))
}

/// The child PATH starts with the binary's own directory so npm shims find `node`.
fn child_path(binary: &Path) -> Option<OsString> {
    let own = binary.parent().map(Path::to_path_buf).into_iter().collect();
    std::env::join_paths(merge_paths([own, resolved_path().to_vec()])).ok()
}

/// `codex-cli 0.160.0` becomes `0.160.0`; unknown formats are kept verbatim.
fn parse_version(output: &str) -> Option<String> {
    let line = output
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())?;
    let token = line.split_whitespace().last()?;
    let version = if token.starts_with(|c: char| c.is_ascii_digit()) {
        token
    } else {
        line
    };
    Some(version.to_string())
}

fn codex_version(binary: &Path) -> Option<String> {
    let mut command = Command::new(binary);
    command.arg("--version");
    if let Some(path) = child_path(binary) {
        command.env("PATH", path);
    }
    output_with_timeout(command, VERSION_TIMEOUT)
        .as_deref()
        .and_then(parse_version)
}

fn locate() -> Option<CodexLocation> {
    let binary = find_codex(resolved_path())?;
    let version = codex_version(&binary);
    Some(CodexLocation {
        path: binary.to_string_lossy().into_owned(),
        version,
    })
}

/// A neutral, empty working directory so Codex never acts on user folders.
fn workspace_dir(app: &AppHandle<Wry>) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("agent-workspace");
    std::fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir)
}

/// Streams lines without a length limit; invalid UTF-8 is replaced, not fatal.
fn pump_lines(
    reader: impl Read,
    channel: Channel<CodexEvent>,
    wrap: fn(String) -> CodexEvent,
    done: mpsc::Sender<()>,
) {
    let mut reader = BufReader::new(reader);
    let mut buffer = Vec::new();
    loop {
        buffer.clear();
        match reader.read_until(b'\n', &mut buffer) {
            Ok(0) | Err(_) => break,
            Ok(_) => {
                while matches!(buffer.last(), Some(b'\n' | b'\r')) {
                    buffer.pop();
                }
                let line = String::from_utf8_lossy(&buffer).into_owned();
                if channel.send(wrap(line)).is_err() {
                    // The webview is gone; keep draining so the child never blocks.
                    continue;
                }
            }
        }
    }
    let _ = done.send(());
}

fn spawn_session(
    app: &AppHandle<Wry>,
    codex: &Codex,
    config: &[String],
    channel: Channel<CodexEvent>,
) -> Result<u32, String> {
    validate_config(config)?;
    let binary = find_codex(resolved_path()).ok_or("Codex CLI not found")?;
    let cwd = workspace_dir(app)?;
    let mut command = Command::new(&binary);
    command
        .args(app_server_args(config))
        .current_dir(&cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(path) = child_path(&binary) {
        command.env("PATH", path);
    }
    // On Windows, std runs `.cmd` shims through cmd.exe with safe argument
    // escaping (and refuses arguments it cannot escape).
    hide_console(&mut command);
    let mut child = command
        .spawn()
        .map_err(|error| format!("could not start Codex: {error}"))?;
    let stdin = child.stdin.take().ok_or("missing stdin pipe")?;
    let stdout = child.stdout.take().ok_or("missing stdout pipe")?;
    let stderr = child.stderr.take().ok_or("missing stderr pipe")?;

    let id = codex
        .next_id
        .fetch_add(1, Ordering::Relaxed)
        .wrapping_add(1);
    let child = Arc::new(Mutex::new(child));
    lock(&codex.sessions).insert(
        id,
        Session {
            child: child.clone(),
            stdin: Arc::new(Mutex::new(Some(stdin))),
        },
    );

    let (done_tx, done_rx) = mpsc::channel();
    {
        let channel = channel.clone();
        let done = done_tx.clone();
        thread::spawn(move || {
            pump_lines(stdout, channel, |line| CodexEvent::Stdout { line }, done)
        });
    }
    {
        let channel = channel.clone();
        thread::spawn(move || {
            pump_lines(stderr, channel, |line| CodexEvent::Stderr { line }, done_tx)
        });
    }
    let sessions = codex.sessions.clone();
    thread::spawn(move || {
        let status = loop {
            match lock(&child).try_wait() {
                Ok(Some(status)) => break Some(status),
                Ok(None) => {}
                Err(_) => break None,
            }
            thread::sleep(EXIT_POLL);
        };
        // Deliver remaining output before the exit event, but never hang on
        // grandchildren that inherited the pipes.
        let deadline = Instant::now() + DRAIN_TIMEOUT;
        for _ in 0..2 {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if done_rx.recv_timeout(remaining).is_err() {
                break;
            }
        }
        lock(&sessions).remove(&id);
        let code = status.and_then(|status| status.code());
        let _ = channel.send(CodexEvent::Exit { code });
    });
    Ok(id)
}

/// Closes stdin first so Codex can shut down its own children, then kills.
fn shutdown(sessions: Vec<Session>, grace: Duration) {
    for session in &sessions {
        lock(&session.stdin).take();
    }
    let deadline = Instant::now() + grace;
    loop {
        let running = sessions
            .iter()
            .any(|session| matches!(lock(&session.child).try_wait(), Ok(None)));
        if !running || Instant::now() >= deadline {
            break;
        }
        thread::sleep(Duration::from_millis(20));
    }
    for session in &sessions {
        let mut child = lock(&session.child);
        if matches!(child.try_wait(), Ok(None)) {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

fn take_all(app: &AppHandle<Wry>) -> Vec<Session> {
    let Some(codex) = app.try_state::<Codex>() else {
        return Vec::new();
    };
    let sessions = lock(&codex.sessions)
        .drain()
        .map(|(_, session)| session)
        .collect();
    sessions
}

/// Finds the Codex binary and its version; `None` means not installed.
#[tauri::command]
pub async fn codex_locate(window: WebviewWindow<Wry>) -> Result<Option<CodexLocation>, String> {
    require_main(&window)?;
    tauri::async_runtime::spawn_blocking(locate)
        .await
        .map_err(|error| error.to_string())
}

/// Starts `codex app-server` and streams its output to `on_event`.
#[tauri::command]
pub async fn codex_start(
    window: WebviewWindow<Wry>,
    app: AppHandle<Wry>,
    config: Vec<String>,
    on_event: Channel<CodexEvent>,
) -> Result<u32, String> {
    require_main(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let codex = app.state::<Codex>();
        spawn_session(&app, &codex, &config, on_event)
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Writes one line (plus `\n`) to the session's stdin.
#[tauri::command]
pub async fn codex_send(
    window: WebviewWindow<Wry>,
    app: AppHandle<Wry>,
    id: u32,
    line: String,
) -> Result<(), String> {
    require_main(&window)?;
    if line.contains('\n') {
        return Err("a line must not contain newlines".into());
    }
    let stdin = {
        let codex = app.state::<Codex>();
        let sessions = lock(&codex.sessions);
        sessions
            .get(&id)
            .map(|session| session.stdin.clone())
            .ok_or("unknown Codex session")?
    };
    // A full pipe may block; keep that off the async runtime and the session map.
    tauri::async_runtime::spawn_blocking(move || {
        let mut guard = lock(&stdin);
        let pipe = guard.as_mut().ok_or("Codex session is stopping")?;
        pipe.write_all(line.as_bytes())
            .and_then(|()| pipe.write_all(b"\n"))
            .and_then(|()| pipe.flush())
            .map_err(|error| format!("Codex session is not running: {error}"))
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Stops a session. Unknown or already finished sessions are not an error.
#[tauri::command]
pub async fn codex_stop(
    window: WebviewWindow<Wry>,
    app: AppHandle<Wry>,
    id: u32,
) -> Result<(), String> {
    require_main(&window)?;
    let session = lock(&app.state::<Codex>().sessions).remove(&id);
    if let Some(session) = session {
        tauri::async_runtime::spawn_blocking(move || shutdown(vec![session], STOP_GRACE))
            .await
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

/// A reloaded main webview can no longer talk to its sessions. Only `Started`
/// counts: `Finished` can arrive after the new page already started a session.
pub fn on_page_load(webview: &tauri::Webview<Wry>, payload: &tauri::webview::PageLoadPayload<'_>) {
    if webview.label() != "main" || payload.event() != tauri::webview::PageLoadEvent::Started {
        return;
    }
    let sessions = take_all(webview.app_handle());
    if !sessions.is_empty() {
        thread::spawn(move || shutdown(sessions, STOP_GRACE));
    }
}

/// No Codex process may outlive the app or its main window.
pub fn on_event(app: &AppHandle<Wry>, event: &RunEvent) {
    match event {
        RunEvent::Exit => shutdown(take_all(app), STOP_GRACE),
        RunEvent::WindowEvent {
            label,
            event: WindowEvent::Destroyed,
            ..
        } if label == "main" => {
            let sessions = take_all(app);
            if !sessions.is_empty() {
                thread::spawn(move || shutdown(sessions, STOP_GRACE));
            }
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entries(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| value.to_string()).collect()
    }

    #[test]
    fn accepts_allowlisted_overrides() {
        for entry in [
            "web_search=\"live\"",
            "model_reasoning_summary=detailed",
            "features.web_search_request=true",
            "tools.view_image=false",
            "sandbox_mode=read-only",
            "approval_policy=never",
            "show_raw_agent_reasoning=false",
            "hide_agent_reasoning=true",
            "model_reasoning_effort=high",
            "sandbox_mode=[\"a\", \"b\"]",
        ] {
            assert_eq!(validate_config_entry(entry), Ok(()), "{entry}");
        }
    }

    /// Mirror of `LAUNCH_CONFIG` in `modules/scriptz/lib/agent/codex/provider.ts`.
    /// Keep both in sync: a rejected entry stops the agent from starting.
    #[test]
    fn accepts_the_scriptz_launch_config() {
        let mut config = entries(&["web_search=\"live\""]);
        for feature in [
            "shell_tool",
            "unified_exec",
            "apps",
            "plugins",
            "multi_agent",
            "multi_agent_v2",
            "image_generation",
            "browser_use",
            "computer_use",
            "in_app_browser",
            "goals",
            "sleep_tool",
            "memories",
            "tool_suggest",
            "skill_search",
            "view_image",
            "hooks",
            "chronicle",
        ] {
            config.push(format!("features.{feature}=false"));
        }
        assert_eq!(validate_config(&config), Ok(()));
    }

    #[test]
    fn rejects_keys_outside_the_allowlist() {
        for entry in [
            "model=o3",
            "shell_environment_policy.inherit=all",
            "web_search_extra=1",
            "sandbox_mode.inner=1",
            "features.=true",
            "features=true",
            "tools=x",
            "mcp_servers.evil.command=sh",
            "Sandbox_mode=read-only",
            "sandbox-mode=read-only",
            "=x",
            "sandbox_mode",
            " sandbox_mode=x",
        ] {
            assert!(validate_config_entry(entry).is_err(), "{entry}");
        }
    }

    #[test]
    fn rejects_unsafe_or_oversized_values() {
        let long = format!("sandbox_mode={}", "a".repeat(MAX_CONFIG_VALUE_CHARS + 1));
        let max = format!("sandbox_mode={}", "ä".repeat(MAX_CONFIG_VALUE_CHARS));
        assert!(validate_config_entry(&long).is_err());
        assert_eq!(validate_config_entry(&max), Ok(()));
        for entry in [
            "sandbox_mode=",
            "sandbox_mode=a\nb",
            "sandbox_mode=a\0",
            "sandbox_mode=x & calc",
            "sandbox_mode=%PATH%",
            "sandbox_mode=a|b",
            "sandbox_mode=a>b",
            "sandbox_mode=!x!",
            "sandbox_mode=^x",
        ] {
            assert!(validate_config_entry(entry).is_err(), "{entry:?}");
        }
    }

    #[test]
    fn limits_the_number_of_overrides() {
        let many = vec!["sandbox_mode=read-only".to_string(); MAX_CONFIG_ENTRIES + 1];
        assert!(validate_config(&many).is_err());
        assert!(validate_config(&many[..MAX_CONFIG_ENTRIES]).is_ok());
    }

    #[test]
    fn builds_fixed_app_server_arguments() {
        assert_eq!(app_server_args(&[]), vec!["app-server"]);
        assert_eq!(
            app_server_args(&entries(&[
                "sandbox_mode=read-only",
                "approval_policy=never"
            ])),
            vec![
                "app-server",
                "-c",
                "sandbox_mode=read-only",
                "-c",
                "approval_policy=never"
            ]
        );
    }

    #[test]
    fn extracts_marked_path_from_noisy_shell_output() {
        let output = format!("welcome!\n{PATH_MARKER}/a/bin:/b/bin{PATH_MARKER}\nbye");
        assert_eq!(parse_marked_path(&output).as_deref(), Some("/a/bin:/b/bin"));
        assert_eq!(parse_marked_path("no markers"), None);
        assert_eq!(
            parse_marked_path(&format!("{PATH_MARKER}{PATH_MARKER}")),
            None
        );
    }

    #[test]
    fn parses_cli_versions() {
        assert_eq!(
            parse_version("codex-cli 0.160.0\n").as_deref(),
            Some("0.160.0")
        );
        assert_eq!(parse_version("\n0.1.2").as_deref(), Some("0.1.2"));
        assert_eq!(parse_version("codex dev").as_deref(), Some("codex dev"));
        assert_eq!(parse_version("  \n"), None);
    }

    #[test]
    fn merges_paths_without_duplicates_or_empties() {
        let merged = merge_paths([
            vec![PathBuf::from("/a"), PathBuf::from("")],
            vec![PathBuf::from("/b"), PathBuf::from("/a")],
        ]);
        assert_eq!(merged, vec![PathBuf::from("/a"), PathBuf::from("/b")]);
    }

    /// Collects serialized events sent through a channel.
    fn recording_channel() -> (Channel<CodexEvent>, Arc<Mutex<Vec<String>>>) {
        let events = Arc::new(Mutex::new(Vec::new()));
        let sink = events.clone();
        let channel = Channel::new(move |body| {
            if let tauri::ipc::InvokeResponseBody::Json(json) = body {
                lock(&sink).push(json);
            }
            Ok(())
        });
        (channel, events)
    }

    #[test]
    fn pumps_large_crlf_and_invalid_utf8_lines() {
        let big = "x".repeat(300_000);
        let mut input = format!("{{\"a\":1}}\r\n{big}\n").into_bytes();
        input.extend_from_slice(b"bad \xff byte\nlast-without-newline");
        let (channel, events) = recording_channel();
        let (done_tx, done_rx) = mpsc::channel();
        pump_lines(
            &input[..],
            channel,
            |line| CodexEvent::Stdout { line },
            done_tx,
        );
        assert!(done_rx.try_recv().is_ok());
        let events = lock(&events);
        assert_eq!(events.len(), 4);
        assert_eq!(events[0], r#"{"type":"stdout","line":"{\"a\":1}"}"#);
        assert_eq!(
            events[1].len(),
            big.len() + r#"{"type":"stdout","line":""}"#.len()
        );
        assert_eq!(
            events[2],
            "{\"type\":\"stdout\",\"line\":\"bad \u{fffd} byte\"}"
        );
        assert_eq!(
            events[3],
            r#"{"type":"stdout","line":"last-without-newline"}"#
        );
    }

    #[test]
    fn serializes_events_with_a_type_tag() {
        let exit = serde_json::to_string(&CodexEvent::Exit { code: Some(0) }).unwrap();
        assert_eq!(exit, r#"{"type":"exit","code":0}"#);
        let killed = serde_json::to_string(&CodexEvent::Exit { code: None }).unwrap();
        assert_eq!(killed, r#"{"type":"exit","code":null}"#);
        let stderr = serde_json::to_string(&CodexEvent::Stderr { line: "e".into() }).unwrap();
        assert_eq!(stderr, r#"{"type":"stderr","line":"e"}"#);
    }

    /// Real handshake with the installed CLI through the same spawn settings.
    #[test]
    #[ignore]
    fn app_server_answers_initialize() {
        let binary = find_codex(resolved_path()).expect("codex should be installed");
        let cwd = std::env::temp_dir();
        let mut child = Command::new(&binary)
            .args(app_server_args(&entries(&[
                "sandbox_mode=read-only",
                "approval_policy=never",
            ])))
            .current_dir(cwd)
            .env("PATH", child_path(&binary).unwrap())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let stdout = child.stdout.take().unwrap();
        let (channel, events) = recording_channel();
        let (done_tx, _done_rx) = mpsc::channel();
        thread::spawn(move || {
            pump_lines(stdout, channel, |line| CodexEvent::Stdout { line }, done_tx)
        });
        let mut stdin = child.stdin.take().unwrap();
        let request = r#"{"method":"initialize","id":1,"params":{"clientInfo":{"name":"agentz-test","title":"AgentZ Test","version":"0.0.0"}}}"#;
        writeln!(stdin, "{request}").unwrap();
        stdin.flush().unwrap();
        let deadline = Instant::now() + Duration::from_secs(15);
        let response = loop {
            if let Some(found) = lock(&events)
                .iter()
                .find(|event| event.contains(r#"\"id\":1"#))
            {
                break found.clone();
            }
            assert!(Instant::now() < deadline, "no initialize response");
            thread::sleep(Duration::from_millis(50));
        };
        println!("initialize response: {response}");
        drop(stdin);
        let started = Instant::now();
        while matches!(child.try_wait(), Ok(None)) && started.elapsed() < STOP_GRACE * 4 {
            thread::sleep(Duration::from_millis(20));
        }
        println!("exited after stdin closed: {:?}", child.try_wait());
        let _ = child.kill();
        let _ = child.wait();
    }

    /// Runs against the real machine: `cargo test -p agentz-desktop --locked -- --ignored`.
    #[test]
    #[ignore]
    fn locates_the_installed_codex_cli() {
        let location = locate().expect("codex should be installed on this machine");
        println!("resolved PATH: {:?}", resolved_path());
        println!("located: {location:?}");
        assert!(location.path.ends_with("codex") || location.path.contains("codex."));
        assert!(location.version.is_some());
    }
}
