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
  | { kind: "trash" };

export interface RecentEntry {
  scriptId: string;
  title: string;
  openedAt: number;
}


const HOME: Route = { kind: "scripts" };
const MAX_RECENT = 8;
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
      return parsed.route && typeof parsed.route === "object" ? parsed.route : HOME;
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
