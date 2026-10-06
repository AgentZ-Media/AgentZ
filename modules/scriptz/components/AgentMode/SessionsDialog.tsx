import { For, Show, createEffect, createSignal, on, onCleanup } from "solid-js";
import { DialogFrame, Icon } from "@agentz/kit/ui";
import { t, tPlural } from "../../i18n";
import { listSessions, type SessionSummary } from "../../lib/agent/chats";
import { agentStore } from "../../stores/agent";
import { navStore } from "../../stores/nav";
import { ideaAge } from "../Ideas/ideaGroups";
import { library } from "../Shell/libraryData";

/** Sessions per page; "more" loads the next page, search runs in the
 *  database, so every session stays reachable. */
const PAGE = 100;

export function sessionSubline(s: SessionSummary): string {
  if (s.lastDraft) return t("agentMode.sessions.draftLine", { title: s.lastDraft, n: s.lastDraftVersion });
  if (s.savedIdeas > 0) return tPlural("agentMode.sessions.ideasLine", s.savedIdeas);
  return t("agentMode.sessions.chatOnly");
}

export function SessionsDialog(props: { open: boolean; onClose(): void; onDelete(chatId: string): Promise<boolean> }) {
  const [list, setList] = createSignal<SessionSummary[]>([]);
  const [loaded, setLoaded] = createSignal(false);
  const [hasMore, setHasMore] = createSignal(false);
  const [query, setQuery] = createSignal("");
  let generation = 0;
  const load = async (append: boolean) => {
    const current = ++generation;
    const offset = append ? list().length : 0;
    try {
      const rows = await listSessions(PAGE + 1, offset, query());
      if (current !== generation) return;
      const page = rows.slice(0, PAGE);
      setList(append ? [...list(), ...page] : page);
      setHasMore(rows.length > PAGE);
    } catch (error) {
      console.warn("[agent] listing sessions failed", error);
    } finally {
      if (current === generation) setLoaded(true);
    }
  };
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(searchTimer));
  createEffect(on(() => [props.open, agentStore.sessions()] as const, ([open]) => { if (open) void load(false); }));
  createEffect(on(query, () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { if (props.open) void load(false); }, 180);
  }, { defer: true }));
  createEffect(on(() => props.open, (open) => { if (!open) { setQuery(""); setLoaded(false); } }));
  const open = (id: string) => {
    props.onClose();
    void navStore.openAgent(id);
  };
  return (
    <DialogFrame open={props.open} onClose={() => props.onClose()} label={t("agentMode.sessions.allTitle")} class="am-sessions">
      <div class="am-sessions-h">
        <b>{t("agentMode.sessions.allTitle")}</b>
        <span class="am-sp" />
        <button type="button" class="ag-ic" aria-label={t("common.close")} title={t("common.close")} onClick={() => props.onClose()}>
          <Icon name="x" size={15} />
        </button>
      </div>
      <label class="field-box am-sessions-q">
        <Icon name="search" size={13} />
        <input
          value={query()}
          placeholder={t("agentMode.sessions.search")}
          aria-label={t("agentMode.sessions.search")}
          spellcheck={false}
          onInput={(e) => setQuery(e.currentTarget.value)}
          ref={(el) => queueMicrotask(() => el.focus())}
        />
      </label>
      <div class="am-sessions-list">
        <Show when={loaded() && list().length === 0}>
          <div class="am-sessions-empty">{query().trim() ? t("agentMode.sessions.noMatch") : t("agentMode.sessions.empty")}</div>
        </Show>
        <For each={list()}>
          {(s) => (
            <div class="am-sessions-row">
              <button type="button" class="am-rs" onClick={() => open(s.id)}>
                <Icon name="dots" size={14} />
                <span class="am-rs-t">
                  <b>{s.title || t("agentMode.bar.newSession")}</b>
                  <small>
                    {sessionSubline(s)}
                    <Show when={library.folder(s.folderId)}>{(f) => <> · {f().name}</>}</Show>
                  </small>
                </span>
                <Show
                  when={s.openDrafts > 0}
                  fallback={
                    <Show when={s.finished > 0} fallback={<span class="am-dchip">{t("agentMode.sessions.chatChip")}</span>}>
                      <span class="am-dchip is-done"><Icon name="check" size={11} />{t("agentMode.sessions.finishedChip")}</span>
                    </Show>
                  }
                >
                  <span class="am-dchip is-live"><i />{tPlural("agentMode.sessions.draftsChip", s.openDrafts)}</span>
                </Show>
                <span class="am-rs-age">{ideaAge(s.updatedAt, Date.now())}</span>
              </button>
              <button
                type="button"
                class="ag-ic am-sessions-del"
                title={t("agentMode.sessions.delete")}
                aria-label={t("agentMode.sessions.delete")}
                onClick={() => void props.onDelete(s.id).then((deleted) => {
                  if (deleted) setList((rows) => rows.filter((row) => row.id !== s.id));
                })}
              >
                <Icon name="trash" size={14} />
              </button>
            </div>
          )}
        </For>
        <Show when={hasMore()}>
          <button type="button" class="am-sessions-more" onClick={() => void load(true)}>
            {t("agentMode.sessions.more")}
          </button>
        </Show>
      </div>
    </DialogFrame>
  );
}
