import { createSignal } from "solid-js";
import { createNavStore, pushToast } from "@agentz/kit/stores";
import { t } from "../i18n";
import type { ScriptStatus } from "../lib/types";

export type Route =
  | {
      kind: "scripts";
      /** Pipeline filter. Undefined/null = all scripts. */
      status?: ScriptStatus | null;
      /** Folder filter. Undefined/null = every folder; INBOX_FOLDER_ID =
       *  scripts without a folder (see lib/folders.ts). */
      folderId?: string | null;
    }
  /** Work in progress: open ideas and every script before the last stage. */
  | { kind: "inbox" }
  | { kind: "ideas"; folderId?: string | null }
  | { kind: "script"; scriptId: string }
  | { kind: "trash" }
  /** Agent mode: one conversation (session) by its chat id. A new id is an
   *  empty session that is stored with its first message. */
  | { kind: "agent"; chatId: string };

export interface RecentEntry {
  scriptId: string;
  title: string;
  openedAt: number;
}


const HOME: Route = { kind: "scripts" };
// Upper bound for the persisted history; the sidebar shows as many of these
// as fit its height (see components/Shell/Sidebar.tsx).
const MAX_RECENT = 50;
const [recent, setRecent] = createSignal<RecentEntry[]>([]);
function touchRecent(scriptId: string, title?: string) {
  const previous = recent();
  const entry = { scriptId, title: title ?? previous.find((r) => r.scriptId === scriptId)?.title ?? "", openedAt: Date.now() };
  setRecent([entry, ...previous.filter((r) => r.scriptId !== scriptId)].slice(0, MAX_RECENT));
}
const navigation = createNavStore<Route>({
  home: HOME,
  encode: (route) => JSON.stringify({ route, recent: recent() }),
  onNavigate: (route) => { if (route.kind === "script") touchRecent(route.scriptId); },
  onFlushFailed: () => pushToast(t("save.navigationBlocked"), "error"),
  async read(kv, active) {
    const raw = await kv.getAppState("nav.state");
    if (!active()) return;
    if (raw) {
      const parsed = JSON.parse(raw) as { route?: Route; recent?: RecentEntry[] };
      setRecent(Array.isArray(parsed.recent) ? parsed.recent.slice(0, MAX_RECENT) : []);
      if (!parsed.route || typeof parsed.route !== "object") return HOME;
      // An agent route needs its chat id; anything else falls back home.
      if (parsed.route.kind === "agent" && typeof parsed.route.chatId !== "string") return HOME;
      return parsed.route;
    }
    const legacy = await kv.getAppState("open_tabs");
    if (!active()) return;
    setRecent([]);
    if (legacy) {
      const parsed = JSON.parse(legacy) as { tabs?: Array<{ scriptId?: string; scriptTitle?: string }> };
      const now = Date.now();
      setRecent((parsed.tabs ?? [])
        .filter((entry): entry is { scriptId: string; scriptTitle?: string } => !!entry?.scriptId)
        .reverse().slice(0, MAX_RECENT)
        .map((entry, index) => ({ scriptId: entry.scriptId, title: entry.scriptTitle ?? "", openedAt: now - index })));
      navigation.persist();
    }
    return HOME;
  },
});

export const startNavRuntime = navigation.start;
export const navStore = {
  ...navigation,
  recent,
  activeScriptId(): string | null {
    const current = navigation.route();
    return current.kind === "script" ? current.scriptId : null;
  },
  isScript: () => navigation.route().kind === "script",
  isIdeas: () => navigation.route().kind === "ideas",
  isScripts: () => navigation.route().kind === "scripts",
  isInbox: () => navigation.route().kind === "inbox",
  isTrash: () => navigation.route().kind === "trash",
  isAgent: () => navigation.route().kind === "agent",
  /** Chat id of the agent mode on screen, else null. */
  activeAgentChatId(): string | null {
    const current = navigation.route();
    return current.kind === "agent" ? current.chatId : null;
  },
  openAgent(chatId: string): Promise<void> {
    return navigation.go({ kind: "agent", chatId });
  },
  openScript(scriptId: string, title?: string): Promise<void> {
    if (title !== undefined) touchRecent(scriptId, title);
    return navigation.go({ kind: "script", scriptId });
  },
  openScripts(filter: { status?: ScriptStatus | null; folderId?: string | null } = {}): Promise<void> {
    return navigation.go({ kind: "scripts", ...filter });
  },
  openInbox(): Promise<void> {
    return navigation.go({ kind: "inbox" });
  },
  openIdeas(folderId?: string | null): Promise<void> {
    return navigation.go({ kind: "ideas", folderId: folderId ?? null });
  },
  setScriptTitle(scriptId: string, title: string) {
    if (!recent().some((r) => r.scriptId === scriptId && r.title !== title)) return;
    setRecent(recent().map((r) => r.scriptId === scriptId ? { ...r, title } : r));
    navigation.persist();
  },
  reconcile(liveScriptIds: Set<string>) {
    setRecent(recent().filter((r) => liveScriptIds.has(r.scriptId)));
    navigation.reconcile((route) => route.kind !== "script" || liveScriptIds.has(route.scriptId));
  },
};
