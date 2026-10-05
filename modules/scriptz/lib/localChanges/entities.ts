// Durable user content only. Settings, app_state and the rebuildable FTS index
// are intentionally absent. Keep this list aligned with the migrations (009
// tracks, 011 extends the triggers for 010); the SQLite integration tests
// check table coverage, every exported column and every update trigger.
export const CONTENT_ENTITIES = {
  scripts: { key: "id", columns: ["id", "title", "highlighting_enabled", "content_json", "characters_meta", "created_at", "updated_at", "archived_at", "page_count", "folder_id", "last_word_count", "dialog_word_count", "direction_block_count", "status", "status_changed_at"] },
  folders: { key: "id", columns: ["id", "name", "created_at", "updated_at", "length_min_sec", "length_max_sec"] },
  ideas: { key: "id", columns: ["id", "title", "notes", "created_at", "used_at", "script_id", "folder_id", "source_chat_id"] },
  snapshots: { key: "id", columns: ["id", "script_id", "content_json", "trigger", "created_at"] },
  character_colors: { key: "name", columns: ["name", "default_color", "override_color", "updated_at"] },
  agent_chats: { key: "id", columns: ["id", "script_id", "provider", "thread_id", "items_json", "created_at", "updated_at", "kind", "title", "folder_id"] },
  agent_memory: { key: "id", columns: ["id", "kind", "folder_id", "subject", "content", "source", "source_script_id", "created_at", "updated_at"] },
  agent_learned: { key: "script_id", columns: ["script_id", "content_hash", "learned_at"] },
  daily_word_log: { key: "date", columns: ["date", "words_added"] },
} as const;

export type ContentEntity = keyof typeof CONTENT_ENTITIES;
export type ContentValue = string | number | null;
export type ContentRow<E extends ContentEntity> = Record<
  (typeof CONTENT_ENTITIES)[E]["columns"][number], ContentValue
>;
