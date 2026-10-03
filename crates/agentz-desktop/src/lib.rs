//! Shared native host. Product schemas and bundle identity remain app-owned.

mod lifecycle;
mod menu;

use tauri::{plugin::TauriPlugin, Wry};
use tauri_plugin_sql::Migration;

/// Baseline for new apps only. Existing apps must preserve migration checksums.
pub const KIT_BASELINE_SQL: &str = include_str!("baseline.sql");

pub struct Config {
    /// App ID; the database is `sqlite:<id>.db`, matching the frontend host.
    pub id: &'static str,
    pub migrations: Vec<Migration>,
}

/// Returns a normal builder so products can append plugins and commands.
/// Lifecycle interception lives in a plugin; `.run(context)` needs no wrapper.
/// Every app must also list the standard plugins as direct Cargo dependencies
/// so Tauri can discover their capability metadata through Cargo `links`.
pub fn builder(config: Config) -> tauri::Builder<Wry> {
    tauri::Builder::default()
        .manage(lifecycle::Lifecycle::default())
        // Must be first: a second process must never open the app database.
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            lifecycle::show_main(app);
        }))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(&format!("sqlite:{}.db", config.id), config.migrations)
                .build(),
        )
        .plugin(host_plugin())
}

fn host_plugin() -> TauriPlugin<Wry> {
    tauri::plugin::Builder::new("agentz-desktop")
        .invoke_handler(tauri::generate_handler![
            lifecycle::ready,
            lifecycle::finish_exit,
            menu::set_menu_language
        ])
        .setup(|_app, _| {
            // Only macOS gets an app menu; Windows keeps a plain window frame.
            #[cfg(target_os = "macos")]
            _app.set_menu(menu::build(_app, "en")?)?;
            Ok(())
        })
        .on_event(lifecycle::on_event)
        .build()
}
