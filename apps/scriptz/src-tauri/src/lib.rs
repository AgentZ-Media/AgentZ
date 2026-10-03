use tauri_plugin_sql::{Migration, MigrationKind};

const MIGRATION_001_BASELINE: &str = include_str!("../migrations/001_baseline.sql");
const MIGRATION_002_AI_CLEANUP: &str = include_str!("../migrations/002_ai_cleanup.sql");
const MIGRATION_003_REDESIGN: &str = include_str!("../migrations/003_redesign.sql");
const MIGRATION_004_WORD_COUNT_SENTINEL: &str =
    include_str!("../migrations/004_word_count_sentinel.sql");
const MIGRATION_005_RUNTIME_STATS: &str = include_str!("../migrations/005_runtime_stats.sql");
const MIGRATION_006_IDEA_FOLDERS: &str = include_str!("../migrations/006_idea_folders.sql");
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

    agentz_desktop::builder(agentz_desktop::Config {
        db_url: "sqlite:scriptz.db",
        migrations,
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
