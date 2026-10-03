use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex, MutexGuard, PoisonError,
    },
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager, RunEvent, WebviewWindow, WindowEvent, Wry};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

const EXIT_EVENT: &str = "agentz:exit-requested";
const MENU_EVENT: &str = "agentz:menu-action";
/// A frontend that never finished booting has nothing unsaved; quit anyway.
const NOT_READY_TIMEOUT: Duration = Duration::from_secs(10);
/// A repeated Quit after this delay offers to quit without the save handshake.
const FORCE_PROMPT_AFTER: Duration = Duration::from_secs(2);

#[derive(Default)]
pub struct Lifecycle(Mutex<ExitState>, AtomicBool);

#[derive(Default)]
struct ExitState {
    ready: bool,
    next_id: u32,
    pending: Option<(u32, i32)>,
    pending_since: Option<Instant>,
    prompting: bool,
    authorized: bool,
    closed_main: bool,
    menu_action: Option<&'static str>,
    german: bool,
}

#[derive(Debug, PartialEq, Eq)]
enum Request {
    /// Announce to the ready frontend.
    Announce(u32),
    /// Held until the frontend reports ready.
    Held(u32),
    /// An earlier request is still pending since the given duration.
    AlreadyPending(Duration),
}

impl ExitState {
    fn request(&mut self, code: i32, now: Instant) -> Request {
        if self.pending.is_some() {
            let since = self.pending_since.map_or(Duration::ZERO, |at| now - at);
            return Request::AlreadyPending(since);
        }
        self.next_id = self.next_id.wrapping_add(1);
        self.pending = Some((self.next_id, code));
        self.pending_since = Some(now);
        if self.ready {
            Request::Announce(self.next_id)
        } else {
            Request::Held(self.next_id)
        }
    }

    fn clear_pending(&mut self) -> Option<(u32, i32)> {
        self.pending_since = None;
        self.pending.take()
    }

    fn finish(&mut self, id: u32, ok: bool) -> Option<i32> {
        let (pending_id, code) = self.pending?;
        if pending_id != id {
            return None;
        }
        self.clear_pending();
        self.authorized = ok;
        ok.then_some(code)
    }

    /// Authorizes exactly this pending request without the frontend.
    fn force(&mut self, id: u32) -> Option<i32> {
        let (pending_id, code) = self.pending?;
        if pending_id != id {
            return None;
        }
        self.clear_pending();
        self.authorized = true;
        Some(code)
    }
}

/// A panic elsewhere must never turn every later Quit into an abort.
fn exit_state(app: &AppHandle<Wry>) -> MutexGuard<'_, ExitState> {
    app.state::<Lifecycle>()
        .inner()
        .0
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
}

fn announce_exit(app: &AppHandle<Wry>, request_id: u32) -> Result<(), String> {
    app.emit_to(
        "main",
        EXIT_EVENT,
        serde_json::json!({ "requestId": request_id }),
    )
    .map_err(|error| error.to_string())
}

/// The frontend calls this after installing listeners, before loading its module.
/// An early Quit is held until this handshake instead of losing the event.
#[tauri::command]
pub fn ready(window: WebviewWindow<Wry>, app: AppHandle<Wry>) -> Result<(), String> {
    if window.label() != "main" {
        return Err("only the main window owns the desktop lifecycle".into());
    }
    let (pending, action) = {
        let mut state = exit_state(&app);
        state.ready = true;
        state.closed_main = false;
        (state.pending.map(|(id, _)| id), state.menu_action.take())
    };
    if let Some(id) = pending {
        announce_exit(&app, id)?;
    }
    if let Some(action) = action {
        app.emit_to("main", MENU_EVENT, action)
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

/// Only an acknowledgment of the current request can authorize one exit.
#[tauri::command]
pub fn finish_exit(
    window: WebviewWindow<Wry>,
    app: AppHandle<Wry>,
    request_id: u32,
    ok: bool,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("only the main window can acknowledge an exit".into());
    }
    let code = exit_state(&app).finish(request_id, ok);
    if let Some(code) = code {
        app.exit(code);
    }
    Ok(())
}

/// Stores the UI language used by native menus and dialogs.
pub fn set_language(app: &AppHandle<Wry>, german: bool) {
    exit_state(app).german = german;
}

fn force_exit(app: &AppHandle<Wry>, request_id: u32) {
    let code = exit_state(app).force(request_id);
    if let Some(code) = code {
        app.exit(code);
    }
}

/// Exits if the frontend never became ready to answer the request.
fn watch_unready(app: &AppHandle<Wry>, request_id: u32) {
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(NOT_READY_TIMEOUT);
        if !exit_state(&app).ready {
            force_exit(&app, request_id);
        }
    });
}

/// A stuck save must not make Quit permanently ineffective.
fn prompt_force_exit(app: &AppHandle<Wry>) {
    let (request_id, german) = {
        let mut state = exit_state(app);
        let Some((id, _)) = state.pending else { return };
        if state.prompting {
            return;
        }
        state.prompting = true;
        (id, state.german)
    };
    let name = app
        .config()
        .product_name
        .clone()
        .unwrap_or_else(|| app.package_info().name.clone());
    let (title, body, quit, cancel) = if german {
        (
            format!("{name} reagiert nicht"),
            "Das Speichern vor dem Beenden ist nicht abgeschlossen. Wenn du jetzt beendest, können ungespeicherte Änderungen verloren gehen.",
            "Trotzdem beenden",
            "Abbrechen",
        )
    } else {
        (
            format!("{name} is not responding"),
            "Saving before quitting has not finished. If you quit now, unsaved changes may be lost.",
            "Quit Anyway",
            "Cancel",
        )
    };
    let handle = app.clone();
    app.dialog()
        .message(body)
        .title(title)
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom(quit.into(), cancel.into()))
        .show(move |confirmed| {
            exit_state(&handle).prompting = false;
            if confirmed {
                force_exit(&handle, request_id);
            }
        });
}

/// Never build a webview synchronously inside a plugin event callback: Tauri
/// holds its plugin mutex while dispatching the event, and webview creation
/// needs the same mutex. A worker also avoids WebView2's event-handler deadlock.
pub fn show_main(app: &AppHandle<Wry>) {
    let state = app.state::<Lifecycle>();
    if state.1.swap(true, Ordering::AcqRel) {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let result = create_or_show_main(&app);
        app.state::<Lifecycle>().1.store(false, Ordering::Release);
        if let Err(error) = result {
            eprintln!("could not show app window: {error}");
        }
    });
}

fn create_or_show_main(app: &AppHandle<Wry>) -> tauri::Result<()> {
    let window = match app.get_webview_window("main") {
        Some(window) => window,
        None => {
            let config = app
                .config()
                .app
                .windows
                .iter()
                .find(|window| window.label == "main")
                .expect("desktop apps must configure a main window");
            tauri::WebviewWindowBuilder::from_config(app, config)?.build()?
        }
    };
    window.unminimize()?;
    window.show()?;
    window.set_focus()?;
    Ok(())
}

fn menu_action(app: &AppHandle<Wry>, action: &'static str) {
    let ready = {
        let mut state = exit_state(app);
        if !state.ready {
            state.menu_action = Some(action);
        }
        state.ready
    };
    show_main(app);
    if ready {
        if let Err(error) = app.emit_to("main", MENU_EVENT, action) {
            eprintln!("could not send menu action: {error}");
        }
    }
}

pub fn on_event(app: &AppHandle<Wry>, event: &RunEvent) {
    match event {
        RunEvent::ExitRequested { api, code, .. } => {
            // Tauri explicitly bypasses prevention for restart. The updater
            // must already have locked editing and successfully flushed.
            if *code == Some(tauri::RESTART_EXIT_CODE) {
                return;
            }
            let mut state = exit_state(app);
            if state.authorized {
                state.authorized = false;
                return;
            }
            let no_window = app.get_webview_window("main").is_none();
            #[cfg(target_os = "macos")]
            if no_window && code.is_none() && state.closed_main {
                // The runtime emits this directly after the last Destroyed;
                // the app stays in the Dock. An explicit Quit can still exit.
                state.closed_main = false;
                api.prevent_exit();
                return;
            }
            if no_window {
                // The close path already completed its successful flush.
                return;
            }
            api.prevent_exit();
            let request = state.request(code.unwrap_or(0), Instant::now());
            drop(state);
            match request {
                Request::Announce(id) => {
                    if let Err(error) = announce_exit(app, id) {
                        exit_state(app).clear_pending();
                        eprintln!("could not request save before exit: {error}");
                    }
                }
                Request::Held(id) => watch_unready(app, id),
                Request::AlreadyPending(since) if since >= FORCE_PROMPT_AFTER => {
                    prompt_force_exit(app)
                }
                Request::AlreadyPending(_) => {}
            }
        }
        RunEvent::WindowEvent {
            label,
            event: WindowEvent::Destroyed,
            ..
        } if label == "main" => {
            let code = {
                let mut state = exit_state(app);
                state.ready = false;
                state.closed_main = true;
                // The frontend destroys the window only after a successful
                // flush, so a Quit that arrived meanwhile can still complete.
                match state.pending {
                    Some((id, _)) => state.force(id),
                    None => None,
                }
            };
            if let Some(code) = code {
                app.exit(code);
            }
        }
        // Dock reopen. Note: a system-initiated quit (Dock menu, logout,
        // shutdown) bypasses ExitRequested in tao and therefore the save
        // handshake; edits rely on the editor's short autosave debounce.
        #[cfg(target_os = "macos")]
        RunEvent::Reopen { .. } => show_main(app),
        RunEvent::MenuEvent(event) => match event.id().as_ref() {
            super::menu::SETTINGS => menu_action(app, "settings"),
            super::menu::ABOUT => menu_action(app, "about"),
            super::menu::QUIT => app.exit(0),
            _ => {}
        },
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::{ExitState, Request, FORCE_PROMPT_AFTER};
    use std::time::Instant;

    #[test]
    fn early_quit_waits_for_frontend_readiness() {
        let mut state = ExitState::default();
        let now = Instant::now();
        assert_eq!(state.request(7, now), Request::Held(1));
        assert_eq!(state.pending, Some((1, 7)));
        state.ready = true;
        assert_eq!(state.finish(1, true), Some(7));
        assert!(state.authorized);
    }

    #[test]
    fn duplicate_and_stale_acknowledgments_cannot_authorize_exit() {
        let mut state = ExitState {
            ready: true,
            ..Default::default()
        };
        let now = Instant::now();
        assert_eq!(state.request(0, now), Request::Announce(1));
        assert!(matches!(state.request(0, now), Request::AlreadyPending(_)));
        assert_eq!(state.finish(99, true), None);
        assert!(!state.authorized);
        assert_eq!(state.finish(1, false), None);
        assert!(!state.authorized);
        assert_eq!(state.request(0, now), Request::Announce(2));
        assert_eq!(state.finish(1, true), None);
        assert!(!state.authorized);
        assert_eq!(state.finish(2, true), Some(0));
        assert_eq!(state.finish(2, true), None);
    }

    #[test]
    fn repeated_quit_reports_how_long_the_save_has_been_pending() {
        let mut state = ExitState {
            ready: true,
            ..Default::default()
        };
        let start = Instant::now();
        assert_eq!(state.request(0, start), Request::Announce(1));
        match state.request(0, start + FORCE_PROMPT_AFTER) {
            Request::AlreadyPending(since) => assert!(since >= FORCE_PROMPT_AFTER),
            other => panic!("unexpected {other:?}"),
        }
    }

    #[test]
    fn forcing_only_authorizes_the_matching_request() {
        let mut state = ExitState::default();
        assert_eq!(state.request(3, Instant::now()), Request::Held(1));
        assert_eq!(state.force(2), None);
        assert!(!state.authorized);
        assert_eq!(state.force(1), Some(3));
        assert!(state.authorized);
        assert_eq!(state.pending, None);
        assert_eq!(state.force(1), None);
    }
}
