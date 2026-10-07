use tauri_plugin_sql::{Migration, MigrationKind};

const MIGRATION_001_BASELINE: &str = include_str!("../migrations/001_baseline.sql");
const MIGRATION_002_AI_CLEANUP: &str = include_str!("../migrations/002_ai_cleanup.sql");
const MIGRATION_003_REDESIGN: &str = include_str!("../migrations/003_redesign.sql");
const MIGRATION_004_WORD_COUNT_SENTINEL: &str =
    include_str!("../migrations/004_word_count_sentinel.sql");
const MIGRATION_005_RUNTIME_STATS: &str = include_str!("../migrations/005_runtime_stats.sql");
const MIGRATION_006_IDEA_FOLDERS: &str = include_str!("../migrations/006_idea_folders.sql");
const MIGRATION_007_WERKBANK: &str = include_str!("../migrations/007_werkbank.sql");
const MIGRATION_008_AGENT: &str = include_str!("../migrations/008_agent.sql");
const MIGRATION_009_LOCAL_CHANGES: &str = include_str!("../migrations/009_local_changes.sql");
const MIGRATION_010_AGENT_SESSIONS: &str = include_str!("../migrations/010_agent_sessions.sql");
const MIGRATION_011_TRACK_AGENT_SESSIONS: &str =
    include_str!("../migrations/011_track_agent_sessions.sql");
const MIGRATION_012_AGENT_LEARNED_TEXT: &str =
    include_str!("../migrations/012_agent_learned_text.sql");
const MIGRATION_013_LARGE_LIBRARY_INDEXES: &str =
    include_str!("../migrations/013_large_library_indexes.sql");
const MIGRATION_014_CLOUD_SYNC: &str = include_str!("../migrations/014_cloud_sync.sql");
const MIGRATION_016_AGENT_THREADS: &str = include_str!("../migrations/016_agent_threads.sql");

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
        Migration {
            version: 8,
            description: "agent: memory, chats, learned state",
            sql: MIGRATION_008_AGENT,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 9,
            description: "local content change tracking",
            sql: MIGRATION_009_LOCAL_CHANGES,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 10,
            description: "agent mode: sessions and idea origin",
            sql: MIGRATION_010_AGENT_SESSIONS,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 11,
            description: "track agent session columns in local changes",
            sql: MIGRATION_011_TRACK_AGENT_SESSIONS,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 12,
            description: "agent: learned script text",
            sql: MIGRATION_012_AGENT_LEARNED_TEXT,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 13,
            description: "indexes for large libraries, search index map",
            sql: MIGRATION_013_LARGE_LIBRARY_INDEXES,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 14,
            description: "cloud sync bookkeeping and other devices' word counts",
            sql: MIGRATION_014_CLOUD_SYNC,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 16,
            description: "transcripts of the in-app agent harness",
            sql: MIGRATION_016_AGENT_THREADS,
            kind: MigrationKind::Up,
        },
    ];

    agentz_desktop::builder(agentz_desktop::Config {
        id: "scriptz",
        migrations,
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
