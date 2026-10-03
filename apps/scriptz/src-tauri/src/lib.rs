// Phase 11 end-state: pure plugin wiring.
// All persistence, search, export and CRUD is handled in TypeScript.
// The Rust crate exists only because Tauri does — it owns the window,
// the bundled plugins, and the SQLite migration list.

use tauri_plugin_sql::{Builder as SqlBuilder, Migration, MigrationKind};

const MIGRATION_001_BASELINE: &str = include_str!("../migrations/001_baseline.sql");
const MIGRATION_002_AI_CLEANUP: &str = include_str!("../migrations/002_ai_cleanup.sql");
const MIGRATION_003_REDESIGN: &str = include_str!("../migrations/003_redesign.sql");
const MIGRATION_004_WORD_COUNT_SENTINEL: &str =
    include_str!("../migrations/004_word_count_sentinel.sql");
const MIGRATION_005_RUNTIME_STATS: &str =
    include_str!("../migrations/005_runtime_stats.sql");
const MIGRATION_006_IDEA_FOLDERS: &str =
    include_str!("../migrations/006_idea_folders.sql");
const MIGRATION_007_WERKBANK: &str = include_str!("../migrations/007_werkbank.sql");

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![
        Migration {
            version: 1,
            description: "baseline schema",
            sql: MIGRATION_001_BASELINE,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "drop AI columns and ai.* settings",
            sql: MIGRATION_002_AI_CLEANUP,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "redesign: tags, ideas, daily word log",
            sql: MIGRATION_003_REDESIGN,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "last_word_count: 0 -> -1 sentinel",
            sql: MIGRATION_004_WORD_COUNT_SENTINEL,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "runtime stats: dialog_word_count + direction_block_count",
            sql: MIGRATION_005_RUNTIME_STATS,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 6,
            description: "ideas.folder_id: share folders with scripts",
            sql: MIGRATION_006_IDEA_FOLDERS,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 7,
            description: "werkbank: scripts.status + status_changed_at, folder length range",
            sql: MIGRATION_007_WERKBANK,
            kind: MigrationKind::Up,
        },
    ];

    tauri::Builder::default()
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(
            SqlBuilder::default()
                .add_migrations("sqlite:scriptz.db", migrations)
                .build(),
        )
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
