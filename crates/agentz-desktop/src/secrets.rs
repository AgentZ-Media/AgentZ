//! Small secrets in the operating system's credential store (macOS Keychain,
//! Windows Credential Manager): the account session and the sync data key.
//! Entries belong to the app's bundle identifier, so the development build
//! and the installed app share them, like they share the database.

use keyring::{Entry, Error};
use tauri::{AppHandle, Wry};

/// Fixed, short names only; values never appear in logs or errors.
fn entry(app: &AppHandle<Wry>, key: &str) -> Result<Entry, String> {
    let valid = !key.is_empty()
        && key.len() <= 64
        && key.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'.' || b == b'-');
    if !valid {
        return Err("invalid secret name".into());
    }
    Entry::new(&app.config().identifier, key).map_err(|error| error.to_string())
}

/// Credential stores may block (a system prompt), so calls leave the IPC thread.
async fn blocking<T: Send + 'static>(job: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(job).await.map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn secret_get(app: AppHandle<Wry>, key: String) -> Result<Option<String>, String> {
    let entry = entry(&app, &key)?;
    blocking(move || match entry.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(Error::NoEntry) => Ok(None),
        Err(error) => Err(error.to_string()),
    })
    .await
}

#[tauri::command]
pub async fn secret_set(app: AppHandle<Wry>, key: String, value: String) -> Result<(), String> {
    if value.len() > 2048 {
        return Err("secret too large".into());
    }
    let entry = entry(&app, &key)?;
    blocking(move || entry.set_password(&value).map_err(|error| error.to_string())).await
}

#[tauri::command]
pub async fn secret_delete(app: AppHandle<Wry>, key: String) -> Result<(), String> {
    let entry = entry(&app, &key)?;
    blocking(move || match entry.delete_credential() {
        Ok(()) | Err(Error::NoEntry) => Ok(()),
        Err(error) => Err(error.to_string()),
    })
    .await
}
