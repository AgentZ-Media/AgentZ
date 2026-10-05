// Human labels for agent activity. Tool calls and memory scopes are always
// described in words - raw arguments or JSON never reach the UI.

import { t } from "../../i18n";
import type { ChatItem } from "../../lib/agent/chats";
import type { MemoryEntry } from "../../lib/agent/memory";
import type { Folder } from "../../lib/types";

export interface Lookup {
  folderName(id: string | null): string | null;
  scriptTitle(id: string): string | null;
}

const short = (value: unknown, max = 60): string => {
  const s = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};

export function toolLabel(item: Extract<ChatItem, { kind: "tool" }>, lookup: Lookup): { label: string; detail: string } {
  const running = item.status === "running";
  const a = item.args;
  let label: string;
  let detail = "";
  switch (item.tool) {
    case "get_current_script":
      label = running ? t("agent.tool.currentScript.running") : t("agent.tool.currentScript.done");
      break;
    case "list_scripts": {
      label = running ? t("agent.tool.listScripts.running") : t("agent.tool.listScripts.done");
      const folder = short(a.folder, 40);
      if (folder && folder !== "current" && folder !== "none") {
        detail = t("agent.tool.listScripts.folder", { folder: lookup.folderName(folder) ?? folder });
      }
      break;
    }
    case "read_script": {
      const id = typeof a.id === "string" ? a.id : "";
      const title = short(lookup.scriptTitle(id) ?? "", 48) || t("agent.tool.readScript.unknown");
      label = running ? t("agent.tool.readScript.running", { title }) : t("agent.tool.readScript.done", { title });
      break;
    }
    case "search_scripts": {
      const query = short(a.query, 40);
      label = running ? t("agent.tool.search.running", { query }) : t("agent.tool.search.done", { query });
      break;
    }
    case "list_folders":
      label = t("agent.tool.folders.done");
      break;
    case "get_memory":
      label = t("agent.tool.memory.done");
      break;
    case "get_writing_context":
      label = running ? t("agentMode.tool.context.running") : t("agentMode.tool.context.done");
      break;
    case "list_ideas":
      label = running ? t("agentMode.tool.ideas.running") : t("agentMode.tool.ideas.done");
      break;
    default:
      label = running ? t("agent.tool.running") : t("agent.tool.done");
  }
  if (item.status === "failed") label = t("agent.tool.failed", { label });
  return { label, detail };
}

export function searchLabel(item: Extract<ChatItem, { kind: "search" }>): { label: string; detail: string } {
  const isUrl = /^https?:\/\//.test(item.query);
  if (item.status === "running") return { label: t("agent.web.running"), detail: short(item.query, 70) };
  if (isUrl) {
    let host = item.query;
    try { host = new URL(item.query).hostname.replace(/^www\./, ""); } catch { /* keep */ }
    return { label: t("agent.web.page"), detail: host };
  }
  return { label: t("agent.web.done"), detail: short(item.query, 70) };
}

export function scopeLabel(entry: MemoryEntry, lookup: Lookup): string {
  const folder = () => lookup.folderName(entry.folderId) ?? t("agent.scope.unknownFolder");
  switch (entry.kind) {
    case "global":
      return t("agent.scope.global");
    case "folder":
      return t("agent.scope.folder", { folder: folder() });
    case "character":
      return entry.folderId
        ? t("agent.scope.character", { name: entry.subject ?? "", folder: folder() })
        : t("agent.scope.characterBase", { name: entry.subject ?? "" });
    case "relation": {
      const [a, b] = (entry.subject ?? "").split("|");
      return t("agent.scope.relation", { a: a ?? "", b: b ?? "" });
    }
  }
}

export function folderLookup(folders: readonly Folder[], titles: (id: string) => string | null): Lookup {
  const byId = new Map(folders.map((f) => [f.id, f.name]));
  const byName = new Map(folders.map((f) => [f.name.toLowerCase(), f.name]));
  return {
    folderName: (id) => (id ? byId.get(id) ?? byName.get(id.toLowerCase()) ?? null : null),
    scriptTitle: titles,
  };
}
