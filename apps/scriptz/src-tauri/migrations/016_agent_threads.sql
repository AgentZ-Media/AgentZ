-- Conversation transcripts of agent providers without their own thread
-- storage (OpenRouter). Codex keeps its threads itself; this table plays that
-- part for the in-app harness, so a chat resumes with its full history.
-- Purely additive. Device-local provider state like agent_chats.thread_id:
-- not user content, not tracked by local_changes, never synced or exported.
CREATE TABLE agent_threads (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  messages_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_agent_threads_updated ON agent_threads (updated_at);
