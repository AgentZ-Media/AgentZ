// Transcripts of the in-app harness (OpenRouter) through the storage
// boundary; Codex keeps its threads itself.
import { getStorageAdapter } from "../storage";
import type { ThreadStoreLike } from "./openrouter/provider";

export const threadStore: ThreadStoreLike = {
  get: (id) => getStorageAdapter().agent.getThread(id),
  save: (record) => getStorageAdapter().agent.saveThread(record),
  prune: (keep) => getStorageAdapter().agent.pruneThreads(keep),
};
