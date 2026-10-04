import { For, Show, createMemo, createResource, createSignal, type JSX } from "solid-js";
import { DialogFrame, Icon } from "@agentz/kit/ui";
import { pushToast } from "@agentz/kit/stores";
import { localeCompare } from "@agentz/kit/i18n";
import { t, tPlural } from "../../i18n";
import {
  addMemory,
  deleteMemory,
  listMemory,
  memoryVersion,
  MemoryFullError,
  updateMemory,
  type MemoryEntry,
  type MemoryKind,
} from "../../lib/agent/memory";
import { agentSettings } from "../../stores/agentSettings";
import { agentUi } from "../../stores/agentUi";
import { library } from "../Shell/libraryData";
import { AgentAvatar } from "./AgentAvatar";
import "./Agent.css";

type View = { kind: "global" } | { kind: "character"; name: string } | { kind: "folder"; id: string };

const sameView = (a: View, b: View) =>
  a.kind === b.kind && (a.kind !== "character" || a.name === (b as { name: string }).name) && (a.kind !== "folder" || a.id === (b as { id: string }).id);

/** Everything the agent has remembered, editable. */
export function MemoryDialog() {
  const [entries, { refetch }] = createResource(() => (agentUi.memoryOpen() ? memoryVersion() : null), async (v) => (v === null ? [] : listMemory()));
  const [view, setView] = createSignal<View>({ kind: "global" });

  const all = () => entries.latest ?? [];
  const folderName = (id: string | null) => (id ? library.folder(id)?.name ?? t("agent.scope.unknownFolder") : "");
  const characters = createMemo(() => {
    const names = new Set<string>();
    for (const e of all()) {
      if (e.kind === "character" && e.subject) names.add(e.subject);
      if (e.kind === "relation" && e.subject) for (const n of e.subject.split("|")) names.add(n);
    }
    return [...names].sort(localeCompare);
  });
  const folderIds = createMemo(() => {
    const ids = new Set<string>();
    for (const e of all()) if (e.folderId) ids.add(e.folderId);
    return [...ids].sort((a, b) => localeCompare(folderName(a), folderName(b)));
  });
  const count = (pred: (e: MemoryEntry) => boolean) => all().filter(pred).length;

  return (
    <DialogFrame open={agentUi.memoryOpen()} onClose={() => agentUi.closeMemory()} label={t("agent.mem.title")} class="ag-memdlg">
      <nav class="ag-mem-nav">
        <div class="ag-mem-id">
          <AgentAvatar look={agentSettings.look()} size={38} state="idle" />
          <div>
            <b>{agentSettings.displayName()}</b>
            <small>{tPlural("agent.mem.entries", all().length)}</small>
          </div>
        </div>
        <NavItem active={sameView(view(), { kind: "global" })} onClick={() => setView({ kind: "global" })} count={count((e) => e.kind === "global")}>
          <Icon name="bulb" size={14} />{t("agent.mem.global")}
        </NavItem>
        <Show when={characters().length}>
          <div class="ag-mem-navh">{t("agent.mem.characters")}</div>
          <For each={characters()}>
            {(name) => (
              <NavItem
                active={sameView(view(), { kind: "character", name })}
                onClick={() => setView({ kind: "character", name })}
                count={count((e) => e.subject === name || (e.kind === "relation" && !!e.subject?.split("|").includes(name)))}
              >
                <span class="ag-mem-who">{name}</span>
              </NavItem>
            )}
          </For>
        </Show>
        <Show when={folderIds().length}>
          <div class="ag-mem-navh">{t("agent.mem.folders")}</div>
          <For each={folderIds()}>
            {(id) => (
              <NavItem active={sameView(view(), { kind: "folder", id })} onClick={() => setView({ kind: "folder", id })} count={count((e) => e.folderId === id)}>
                <Icon name="folder" size={14} />{folderName(id)}
              </NavItem>
            )}
          </For>
        </Show>
      </nav>
      <div class="ag-mem-body">
        <div class="ag-mem-top">
          <div>
            <h2>
              <Show when={view().kind === "global"}>{t("agent.mem.global")}</Show>
              <Show when={view().kind === "character" && (view() as { name: string }).name}>{(n) => <span class="ag-mem-h-who">{n()}</span>}</Show>
              <Show when={view().kind === "folder" && (view() as { id: string }).id}>{(id) => folderName(id())}</Show>
            </h2>
            <p>{view().kind === "global" ? t("agent.mem.global.help") : t("agent.mem.sub", { name: agentSettings.displayName() })}</p>
          </div>
          <button type="button" class="dlg-esc" onClick={() => agentUi.closeMemory()} aria-label={t("agent.mem.back")}><kbd>esc</kbd></button>
        </div>
        <div class="ag-mem-scroll">
          <Show when={all().length > 0 || view().kind === "global"} fallback={<p class="ag-mem-empty">{t("agent.mem.emptyAll", { name: agentSettings.displayName() })}</p>}>
            <Show when={view().kind === "global"}>
              <Section entries={all().filter((e) => e.kind === "global")} add={{ kind: "global", folderId: null, subject: null }} onChange={refetch} emptyAll={all().length === 0} />
            </Show>
            <Show when={view().kind === "character" && (view() as { name: string }).name} keyed>
              {(name) => {
                const own = () => all().filter((e) => e.kind === "character" && e.subject === name);
                const folders = () => [...new Set(own().filter((e) => e.folderId).map((e) => e.folderId as string))];
                const relations = () => all().filter((e) => e.kind === "relation" && !!e.subject?.split("|").includes(name));
                return (
                  <>
                    <Section
                      title={t("agent.mem.base")}
                      sub={t("agent.mem.base.help")}
                      accent
                      entries={own().filter((e) => e.folderId === null)}
                      add={{ kind: "character", folderId: null, subject: name }}
                      onChange={refetch}
                    />
                    <div class="ag-mem-pair">
                      <For each={folders()}>
                        {(fid) => (
                          <Section
                            title={folderName(fid)}
                            icon="folder"
                            entries={own().filter((e) => e.folderId === fid)}
                            add={{ kind: "character", folderId: fid, subject: name }}
                            onChange={refetch}
                          />
                        )}
                      </For>
                    </div>
                    <Show when={relations().length}>
                      <Section title={t("agent.mem.relations")} entries={relations()} onChange={refetch} showScope={(e) => relationLabel(e, folderName)} />
                    </Show>
                  </>
                );
              }}
            </Show>
            <Show when={view().kind === "folder" && (view() as { id: string }).id} keyed>
              {(fid) => {
                const inFolder = () => all().filter((e) => e.folderId === fid);
                const chars = () => [...new Set(inFolder().filter((e) => e.kind === "character").map((e) => e.subject as string))].sort(localeCompare);
                return (
                  <>
                    <Section title={t("agent.mem.folderNotes")} accent entries={inFolder().filter((e) => e.kind === "folder")} add={{ kind: "folder", folderId: fid, subject: null }} onChange={refetch} />
                    <For each={chars()}>
                      {(name) => (
                        <Section
                          title={name}
                          who
                          entries={inFolder().filter((e) => e.kind === "character" && e.subject === name)}
                          add={{ kind: "character", folderId: fid, subject: name }}
                          onChange={refetch}
                          onTitle={() => setView({ kind: "character", name })}
                        />
                      )}
                    </For>
                    <Show when={inFolder().some((e) => e.kind === "relation")}>
                      <Section title={t("agent.mem.relations")} entries={inFolder().filter((e) => e.kind === "relation")} onChange={refetch} showScope={(e) => relationLabel(e, folderName)} />
                    </Show>
                  </>
                );
              }}
            </Show>
          </Show>
        </div>
      </div>
    </DialogFrame>
  );
}

function relationLabel(entry: MemoryEntry, folderName: (id: string | null) => string): string {
  const [a, b] = (entry.subject ?? "").split("|");
  const pair = t("agent.scope.relation", { a: a ?? "", b: b ?? "" });
  return entry.folderId ? `${pair} · ${folderName(entry.folderId)}` : pair;
}

function NavItem(props: { active: boolean; onClick(): void; count: number; children: JSX.Element }) {
  return (
    <button type="button" class="ag-mem-it" classList={{ on: props.active }} aria-current={props.active ? "true" : undefined} onClick={() => props.onClick()}>
      {props.children}
      <span class="ag-mem-n">{props.count}</span>
    </button>
  );
}

interface SectionProps {
  title?: string;
  sub?: string;
  icon?: "folder";
  who?: boolean;
  accent?: boolean;
  entries: MemoryEntry[];
  add?: { kind: MemoryKind; folderId: string | null; subject: string | null };
  onChange(): void;
  showScope?: (entry: MemoryEntry) => string;
  emptyAll?: boolean;
  onTitle?: () => void;
}

function Section(props: SectionProps) {
  const [adding, setAdding] = createSignal(false);
  const [text, setText] = createSignal("");
  const save = async () => {
    const value = text().trim();
    if (!value || !props.add) return;
    try {
      await addMemory({ ...props.add, content: value, source: "user" });
      setText("");
      setAdding(false);
      props.onChange();
    } catch (error) {
      pushToast(error instanceof MemoryFullError ? t("agent.mem.full") : t("agent.mem.saveFailed", { message: String(error) }), "error");
    }
  };
  return (
    <section class="ag-mem-sec" classList={{ "is-accent": !!props.accent }}>
      <Show when={props.title}>
        <div class="ag-mem-sec-h">
          <Show when={props.icon}><Icon name="folder" size={12} /></Show>
          <Show when={props.onTitle} fallback={<span classList={{ "ag-mem-who": !!props.who }}>{props.title}</span>}>
            <button type="button" class="ag-mem-link" classList={{ "ag-mem-who": !!props.who }} onClick={() => props.onTitle?.()}>{props.title}</button>
          </Show>
          <Show when={props.sub}><small>{props.sub}</small></Show>
        </div>
      </Show>
      <Show when={props.entries.length > 0} fallback={<p class="ag-mem-none">{props.emptyAll ? t("agent.mem.emptyAll", { name: agentSettings.displayName() }) : t("agent.mem.empty")}</p>}>
        <ul class="ag-mem-list">
          <For each={props.entries}>{(entry) => <EntryRow entry={entry} onChange={props.onChange} scope={props.showScope?.(entry)} />}</For>
        </ul>
      </Show>
      <Show when={props.add}>
        <Show
          when={adding()}
          fallback={<button type="button" class="ag-mem-add" onClick={() => setAdding(true)}><Icon name="plus" size={12} />{t("agent.mem.add")}</button>}
        >
          <div class="ag-mem-edit">
            <textarea
              class="field"
              rows={2}
              maxLength={400}
              placeholder={t("agent.mem.addPlaceholder", { name: agentSettings.displayName() })}
              value={text()}
              onInput={(e) => setText(e.currentTarget.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void save(); } }}
              ref={(el) => queueMicrotask(() => el.focus())}
            />
            <div class="ag-mem-edit-f">
              <button type="button" class="btn ghost" onClick={() => { setAdding(false); setText(""); }}>{t("agent.mem.cancel")}</button>
              <button type="button" class="btn primary" disabled={!text().trim()} onClick={() => void save()}>{t("agent.mem.save")}</button>
            </div>
          </div>
        </Show>
      </Show>
    </section>
  );
}

function EntryRow(props: { entry: MemoryEntry; onChange(): void; scope?: string }) {
  const [editing, setEditing] = createSignal(false);
  const [text, setText] = createSignal(props.entry.content);
  const source = () => {
    if (props.entry.source === "user") return t("agent.mem.source.user");
    if (props.entry.source === "chat") return t("agent.mem.source.chat");
    const title = props.entry.sourceScriptId ? library.script(props.entry.sourceScriptId)?.title : undefined;
    return title ? t("agent.mem.source.script", { title }) : t("agent.mem.source.scriptUnknown");
  };
  const save = async () => {
    const value = text().trim();
    if (!value) return;
    try {
      await updateMemory(props.entry.id, value);
      setEditing(false);
      props.onChange();
    } catch (error) {
      pushToast(t("agent.mem.saveFailed", { message: String(error) }), "error");
    }
  };
  const remove = async () => {
    await deleteMemory(props.entry.id);
    pushToast(t("agent.mem.deleted"), "ok");
    props.onChange();
  };
  return (
    <li class="ag-mem-entry">
      <Show
        when={editing()}
        fallback={
          <>
            <div class="ag-mem-entry-b">
              <Show when={props.scope}><span class="ag-mem-entry-scope">{props.scope}</span></Show>
              <p>{props.entry.content}</p>
              <small>{source()}</small>
            </div>
            <span class="ag-mem-entry-act">
              <button type="button" class="ag-ic" title={t("agent.mem.edit")} aria-label={t("agent.mem.edit")} onClick={() => { setText(props.entry.content); setEditing(true); }}>
                <Icon name="pen" size={13} />
              </button>
              <button type="button" class="ag-ic" title={t("agent.mem.delete")} aria-label={t("agent.mem.delete")} onClick={() => void remove()}>
                <Icon name="trash" size={13} />
              </button>
            </span>
          </>
        }
      >
        <div class="ag-mem-edit">
          <textarea
            class="field"
            rows={2}
            maxLength={400}
            value={text()}
            onInput={(e) => setText(e.currentTarget.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void save(); } }}
            ref={(el) => queueMicrotask(() => el.focus())}
          />
          <div class="ag-mem-edit-f">
            <button type="button" class="btn ghost" onClick={() => setEditing(false)}>{t("agent.mem.cancel")}</button>
            <button type="button" class="btn primary" disabled={!text().trim()} onClick={() => void save()}>{t("agent.mem.save")}</button>
          </div>
        </div>
      </Show>
    </li>
  );
}
