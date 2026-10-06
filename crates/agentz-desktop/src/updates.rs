//! Update channels and database backups for nightly builds.
//!
//! The stable channel uses the endpoint from `tauri.conf.json`
//! (`.../releases/download/<id>-latest/latest.json`). The nightly channel
//! reads `<id>-nightly` next to it and also asks the stable channel, so a
//! stable release newer than the last nightly is never missed. Signatures
//! are verified by the updater plugin for both channels with the same key.

use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::Serialize;
use tauri::{AppHandle, Manager, ResourceId, State, Url, Webview, Wry};
use tauri_plugin_updater::{Update, UpdaterExt};

/// Backups kept per app, including the one about to be written.
const KEEP_BACKUPS: usize = 5;

/// App ID of the running host; names the database and the release channels.
pub struct HostId(pub &'static str);

/// Mirrors the updater plugin's check result, so the webview can construct
/// `new Update(metadata)` and use the plugin's own download/install commands.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateMetadata {
    rid: ResourceId,
    current_version: String,
    version: String,
    date: Option<String>,
    body: Option<String>,
    raw_json: serde_json::Value,
}

/// `.../<id>-latest/latest.json` becomes `.../<id>-nightly/latest.json`.
pub(crate) fn nightly_endpoint(stable_endpoints: &[String], id: &str) -> Option<Url> {
    let stable = format!("/{id}-latest/latest.json");
    let nightly = format!("/{id}-nightly/latest.json");
    stable_endpoints.iter().find_map(|endpoint| {
        let url = Url::parse(endpoint).ok()?;
        if url.scheme() != "https" || !url.path().ends_with(&stable) {
            return None;
        }
        let path = url.path();
        let mut next = url.clone();
        next.set_path(&format!("{}{nightly}", &path[..path.len() - stable.len()]));
        Some(next)
    })
}

fn configured_endpoints(webview: &Webview<Wry>) -> Vec<String> {
    webview
        .config()
        .plugins
        .0
        .get("updater")
        .and_then(|updater| updater.get("endpoints"))
        .and_then(|endpoints| endpoints.as_array())
        .map(|endpoints| {
            endpoints
                .iter()
                .filter_map(|endpoint| endpoint.as_str().map(str::to_owned))
                .collect()
        })
        .unwrap_or_default()
}

/// The newer of two optional updates. Unparseable versions never win.
pub(crate) fn newer(a: Option<Update>, b: Option<Update>) -> Option<Update> {
    match (a, b) {
        (Some(a), Some(b)) => {
            let va = semver::Version::parse(&a.version).ok();
            let vb = semver::Version::parse(&b.version).ok();
            if vb > va {
                Some(b)
            } else {
                Some(a)
            }
        }
        (a, b) => a.or(b),
    }
}

#[tauri::command]
pub async fn update_check(
    webview: Webview<Wry>,
    host: State<'_, HostId>,
    channel: String,
) -> Result<Option<UpdateMetadata>, String> {
    let stable = webview
        .updater_builder()
        .build()
        .map_err(|e| e.to_string())?;
    let update = match channel.as_str() {
        "stable" => stable.check().await.map_err(|e| e.to_string())?,
        "nightly" => {
            let endpoint = nightly_endpoint(&configured_endpoints(&webview), host.0)
                .ok_or_else(|| "no nightly endpoint for this app".to_string())?;
            let nightly = webview
                .updater_builder()
                .endpoints(vec![endpoint])
                .and_then(|builder| builder.build())
                .map_err(|e| e.to_string())?;
            let (stable, nightly) = (stable.check().await, nightly.check().await);
            match (stable, nightly) {
                (Ok(stable), Ok(nightly)) => newer(stable, nightly),
                // A missing nightly release must not hide a stable update, and
                // vice versa; only a failure of both is an error.
                (Ok(stable), Err(_)) => stable,
                (Err(_), Ok(nightly)) => nightly,
                (Err(error), Err(_)) => return Err(error.to_string()),
            }
        }
        other => return Err(format!("unknown update channel: {other}")),
    };
    Ok(update.map(|update| UpdateMetadata {
        current_version: update.current_version.clone(),
        version: update.version.clone(),
        date: None,
        body: update.body.clone(),
        raw_json: update.raw_json.clone(),
        rid: webview.resources_table().add(update),
    }))
}

pub(crate) fn valid_label(label: &str) -> bool {
    !label.is_empty()
        && label.len() <= 64
        && label
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-')
}

/// Deletes the oldest `<id>-*.db` backups so that `keep - 1` remain.
pub(crate) fn prune_backups(dir: &Path, id: &str, keep: usize) -> std::io::Result<()> {
    let prefix = format!("{id}-");
    let mut backups: Vec<PathBuf> = fs::read_dir(dir)?
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .filter(|path| {
            path.is_file()
                && path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| name.starts_with(&prefix) && name.ends_with(".db"))
        })
        .collect();
    // Names start with a fixed-width Unix timestamp, so they sort by age.
    backups.sort();
    let excess = backups.len().saturating_sub(keep.saturating_sub(1));
    for path in backups.into_iter().take(excess) {
        fs::remove_file(path)?;
    }
    Ok(())
}

/// Returns a fresh path in `<app config dir>/backups/` (next to the database)
/// for `VACUUM INTO`, after pruning old backups. Writes no database data.
#[tauri::command]
pub fn prepare_database_backup(
    app: AppHandle<Wry>,
    host: State<'_, HostId>,
    label: String,
) -> Result<String, String> {
    if !valid_label(&label) {
        return Err("invalid backup label".into());
    }
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join("backups");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    prune_backups(&dir, host.0, KEEP_BACKUPS).map_err(|e| e.to_string())?;
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_secs();
    let path = dir.join(format!("{}-{seconds:010}-{label}.db", host.0));
    if path.exists() {
        return Err("backup already exists".into());
    }
    path.into_os_string()
        .into_string()
        .map_err(|_| "backup path is not valid UTF-8".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn derives_the_nightly_endpoint_from_the_stable_pointer() {
        let stable =
            "https://github.com/AgentZ-Media/AgentZ-Suite/releases/download/scriptz-latest/latest.json";
        assert_eq!(
            nightly_endpoint(&[stable.into()], "scriptz").map(String::from),
            Some(
                "https://github.com/AgentZ-Media/AgentZ-Suite/releases/download/scriptz-nightly/latest.json"
                    .into()
            )
        );
    }

    #[test]
    fn refuses_foreign_or_insecure_endpoints() {
        let other =
            "https://github.com/AgentZ-Media/AgentZ-Suite/releases/download/other-latest/latest.json";
        let http =
            "http://github.com/AgentZ-Media/AgentZ-Suite/releases/download/scriptz-latest/latest.json";
        assert_eq!(
            nightly_endpoint(&[other.into(), http.into()], "scriptz"),
            None
        );
        assert_eq!(nightly_endpoint(&[], "scriptz"), None);
    }

    #[test]
    fn accepts_only_plain_backup_labels() {
        assert!(valid_label("before-0.10.1-nightly.202610051500"));
        assert!(!valid_label(""));
        assert!(!valid_label("../escape"));
        assert!(!valid_label("a/b"));
        assert!(!valid_label(&"x".repeat(65)));
    }

    #[test]
    fn prunes_the_oldest_backups_of_this_app_only() {
        let dir = std::env::temp_dir().join(format!(
            "agentz-backups-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        for second in 1..=6 {
            fs::write(dir.join(format!("scriptz-{second:010}-before-x.db")), b"").unwrap();
        }
        fs::write(dir.join("other-0000000001-before-x.db"), b"").unwrap();
        fs::write(dir.join("scriptz-notes.txt"), b"").unwrap();
        prune_backups(&dir, "scriptz", 5).unwrap();
        let mut names: Vec<String> = fs::read_dir(&dir)
            .unwrap()
            .map(|entry| entry.unwrap().file_name().into_string().unwrap())
            .collect();
        names.sort();
        assert_eq!(
            names,
            [
                "other-0000000001-before-x.db",
                "scriptz-0000000003-before-x.db",
                "scriptz-0000000004-before-x.db",
                "scriptz-0000000005-before-x.db",
                "scriptz-0000000006-before-x.db",
                "scriptz-notes.txt",
            ]
        );
        fs::remove_dir_all(dir).unwrap();
    }
}
