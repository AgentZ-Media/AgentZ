#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    agentz_desktop::builder(agentz_desktop::Config {
        db_url: "sqlite:sandbox.db",
        migrations: vec![tauri_plugin_sql::Migration {
            version: 1,
            description: "kit baseline",
            sql: include_str!("../migrations/001_baseline.sql"),
            kind: tauri_plugin_sql::MigrationKind::Up,
        }],
    })
    .run(tauri::generate_context!())
    .expect("error while running desktop application");
}
