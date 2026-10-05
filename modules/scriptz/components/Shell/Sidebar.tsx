import { For, Show, createSignal, onCleanup, type JSX } from "solid-js";
import { navStore } from "../../stores/nav";
import { openStore } from "../../stores/open";
import { uiStore, type SidebarSection } from "../../stores/ui";
import { K } from "@agentz/kit/platform";
import { scriptStages, stageLabel } from "../../lib/stages";
import type { Folder, ScriptStatus } from "../../lib/types";
import { t } from "../../i18n";
import { AgentAvatar } from "../Agent/AgentAvatar";
import { agentSettings } from "../../stores/agentSettings";
import { agentUi } from "../../stores/agentUi";
import { agentStore } from "../../stores/agent";
import { Icon } from "@agentz/kit/ui";
import { StageGlyph } from "../Common/StageGlyph";
import { ContextMenu, type ContextMenuItem } from "../Library/ContextMenu";
import { SCRIPT_DRAG_MIME } from "../Library/dnd";
import {
  createFolder,
  deleteFolder,
  moveScriptsTo,
  openNewScript,
  renameFolder,
} from "../Library/actions";
import { WritingCounter } from "../Activity/WritingCounter";
import { closeOpenScript, closeOtherOpenScripts } from "./openActions";
import { folderColor, library } from "./libraryData";

/**
 * Left navigation (concept `#tpl-side`): app row, "Neues Skript", the inbox
 * (only while work is in progress), "Alle Skripte", the pipeline and the
 * folders (both collapsible), the "Open" list and the footer with the
 * writing counter, trash and settings. Always dark (`--side-*`).
 *
 * The navigation keeps its natural height and scrolls only when it would
 * squeeze the "Open" list below its minimum; the list takes the rest of
 * the height and scrolls on its own (see Shell.css).
 */
export function Sidebar() {
  const route = () => navStore.route();

  const isAllOn = () => {
    const r = route();
    return r.kind === "scripts" && !r.status && !r.folderId;
  };
  const isStatusOn = (st: ScriptStatus) => {
    const r = route();
    return r.kind === "scripts" && r.status === st && !r.folderId;
  };
  const isFolderOn = (id: string) => {
    const r = route();
    return r.kind === "scripts" && r.folderId === id && !r.status;
  };

  // ---- folders: inline create / rename ----
  const [creatingFolder, setCreatingFolder] = createSignal(false);
  const [renamingId, setRenamingId] = createSignal<string | null>(null);
  const [dropTarget, setDropTarget] = createSignal<string | null>(null);
  const [menu, setMenu] = createSignal<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);

  const folderItems = (f: Folder): ContextMenuItem[] => [
    { label: t("folder.menu.rename"), icon: "pen", onClick: () => setRenamingId(f.id) },
    {
      label: t("shell.folder.rangeMenu"),
      icon: "history",
      onClick: () => uiStore.openSettings("folders"),
    },
    {
      label: t("folder.menu.delete"),
      icon: "trash",
      danger: true,
      separatorBefore: true,
      onClick: () => void deleteFolder(f),
    },
  ];

  const openItems = (id: string): ContextMenuItem[] => [
    { label: t("shell.open.close"), icon: "x", onClick: () => void closeOpenScript(id) },
    {
      label: t("shell.open.closeOthers"),
      disabled: openStore.ids().length < 2,
      onClick: () => void closeOtherOpenScripts(id),
    },
    { label: t("shell.open.closeAll"), separatorBefore: true, onClick: () => void closeOtherOpenScripts(null) },
  ];

  const openTitle = (id: string) =>
    library.script(id)?.title || navStore.recent().find((r) => r.scriptId === id)?.title || t("common.untitled");

  const startFolder = () => {
    if (uiStore.isSectionCollapsed("folders")) uiStore.toggleSection("folders");
    setCreatingFolder(true);
  };

  const acceptsScript = (e: DragEvent) =>
    !!e.dataTransfer && Array.from(e.dataTransfer.types).includes(SCRIPT_DRAG_MIME);

  return (
    <>
      <div class="side-actions">
        <button
          type="button"
          class="side-primary"
          title={t("shell.newScript.title", { hotkey: K("Mod+N") })}
          onClick={() => openNewScript()}
        >
          <Icon name="plus" />
          <span class="side-primary-lbl">{t("browser.newScript")}</span>
          <kbd>{K("Mod+N")}</kbd>
        </button>
      </div>

      <nav class="side-scroll side-split">
        <div class="side-top-nav">
          {/* Only while something is in progress; stays while open so the
              active entry doesn't vanish when its last item is finished. */}
          <Show when={library.inboxCount() > 0 || route().kind === "inbox"}>
            <NavItem
              on={route().kind === "inbox"}
              icon={<Icon name="inbox" size={14} />}
              label={t("shell.nav.inbox")}
              count={library.inboxCount()}
              onClick={() => navStore.openInbox()}
            />
          </Show>
          <NavItem
            on={isAllOn()}
            icon={<Icon name="stack" size={14} />}
            label={t("shell.nav.all")}
            count={library.scripts().length}
            onClick={() => navStore.openScripts()}
          />

          <SectionHead section="pipeline" label={t("shell.section.pipeline")} />
          <Show when={!uiStore.isSectionCollapsed("pipeline")}>
            <NavItem
              on={route().kind === "ideas"}
              icon={<StageGlyph stage="idea" />}
              label={t("shell.nav.ideas")}
              count={library.openIdeas().length}
              onClick={() => navStore.openIdeas()}
            />
            <For each={scriptStages().map((stage) => stage.id)}>
              {(st) => (
                <NavItem
                  on={isStatusOn(st)}
                  icon={<StageGlyph stage={st} />}
                  label={stageLabel(st)}
                  count={library.statusCounts().get(st) ?? 0}
                  onClick={() => navStore.openScripts({ status: st })}
                />
              )}
            </For>
          </Show>

          <SectionHead section="folders" label={t("shell.section.folders")}>
            <button
              type="button"
              class="h-add"
              title={t("folder.new")}
              aria-label={t("folder.new")}
              onClick={startFolder}
            >
              <Icon name="plus" size={12} />
            </button>
          </SectionHead>
          <Show when={!uiStore.isSectionCollapsed("folders")}>
            <For each={library.folders()}>
              {(f) => (
                <Show
                  when={renamingId() !== f.id}
                  fallback={
                    <InlineInput
                      initial={f.name}
                      color={folderColor(f.id)}
                      label={t("folder.renameLabel")}
                      onCommit={(v) => {
                        setRenamingId(null);
                        void renameFolder(f, v);
                      }}
                      onCancel={() => setRenamingId(null)}
                    />
                  }
                >
                  <NavItem
                    sub
                    on={isFolderOn(f.id)}
                    drop={dropTarget() === f.id}
                    icon={<span class="dot" style={{ background: folderColor(f.id) }} />}
                    label={f.name}
                    count={library.folderCounts().get(f.id) ?? 0}
                    onClick={() => navStore.openScripts({ folderId: f.id })}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setMenu({ x: e.clientX, y: e.clientY, items: folderItems(f) });
                    }}
                    onDragOver={(e) => {
                      if (!acceptsScript(e)) return;
                      e.preventDefault();
                      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
                      setDropTarget(f.id);
                    }}
                    onDragLeave={() => setDropTarget((cur) => (cur === f.id ? null : cur))}
                    onDrop={(e) => {
                      setDropTarget(null);
                      const id = e.dataTransfer?.getData(SCRIPT_DRAG_MIME);
                      if (!id) return;
                      e.preventDefault();
                      if (library.script(id)?.folder_id !== f.id) void moveScriptsTo([id], f.id);
                    }}
                  />
                </Show>
              )}
            </For>
            <Show when={creatingFolder()}>
              <InlineInput
                initial=""
                placeholder={t("folder.placeholder")}
                label={t("folder.createTitle")}
                onCommit={(v) => {
                  setCreatingFolder(false);
                  void createFolder(v);
                }}
                onCancel={() => setCreatingFolder(false)}
              />
            </Show>
            <Show when={library.folders().length === 0 && !creatingFolder()}>
              <button type="button" class="nav sub side-ghost" onClick={startFolder}>
                <Icon name="plus" size={13} />
                <span class="lbl">{t("folder.new")}</span>
              </button>
            </Show>
          </Show>
        </div>

        <div class="side-open">
          <div class="side-h">
            <span class="side-h-lbl">{t("shell.section.open")}</span>
            <Show when={openStore.ids().length > 1}>
              <button
                type="button"
                class="h-add"
                title={t("shell.open.closeAll")}
                aria-label={t("shell.open.closeAll")}
                onClick={() => void closeOtherOpenScripts(null)}
              >
                <Icon name="x" size={12} />
              </button>
            </Show>
          </div>
          <div class="side-open-list">
            <For each={openStore.ids()} fallback={<div class="side-open-empty">{t("shell.open.empty")}</div>}>
              {(id) => (
                <OpenItem
                  id={id}
                  title={openTitle(id)}
                  status={library.script(id)?.status}
                  on={navStore.activeScriptId() === id}
                  onOpen={() => void navStore.openScript(id, openTitle(id))}
                  onClose={() => void closeOpenScript(id)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setMenu({ x: e.clientX, y: e.clientY, items: openItems(id) });
                  }}
                />
              )}
            </For>
          </div>
        </div>
      </nav>

      <Show when={menu()}>
        {(m) => <ContextMenu x={m().x} y={m().y} items={m().items} width={220} onClose={() => setMenu(null)} />}
      </Show>
    </>
  );
}

export function SidebarFooter() {
  const route = () => navStore.route();
  return (
    <>
      <SidebarAgent />
      <div class="side-foot">
        <div class="side-foot-counter">
          <WritingCounter />
        </div>
        <button
          type="button"
          class="ic-btn"
          classList={{ "is-on": route().kind === "trash" }}
          title={t("browser.trash")}
          aria-label={t("browser.trash")}
          onClick={() => navStore.go({ kind: "trash" })}
        >
          <Icon name="trash" />
        </button>
        <button
          type="button"
          class="ic-btn"
          title={t("shell.settings.title", { hotkey: K("Mod+,") })}
          aria-label={t("settings.title")}
          onClick={() => uiStore.openSettings()}
        >
          <Icon name="gear" />
        </button>
      </div>
    </>
  );
}

/** Agent row above the footer: face, name and what it is doing. */
function SidebarAgent() {
  const status = () => {
    const boot = agentStore.bootstrap();
    if (boot.running) return t("agent.prefs.relearn.running", { done: boot.done, total: boot.total });
    if (!agentSettings.onboarded()) return t("agent.state.setup.action");
    if (!agentSettings.enabled()) return t("agent.status.off");
    const learning = agentStore.learning();
    if (learning) return t("agent.status.learning", { title: learning.title });
    const state = agentStore.status().state;
    if (state === "ready") return t("agent.status.ready");
    if (state === "checking") return t("agent.status.checking");
    return t("agent.status.offline");
  };
  const busy = () => agentStore.bootstrap().running || agentStore.learning() !== null;
  return (
    <Show when={agentStore.available()}>
      <button
        type="button"
        class="side-agent"
        classList={{ "is-learning": busy() }}
        title={agentSettings.onboarded() ? t("agent.panel.memory") : t("agent.state.setup.action")}
        onClick={() => (agentSettings.onboarded() ? agentUi.openMemory() : agentUi.openOnboarding())}
      >
        <AgentAvatar look={agentSettings.look()} size={28} state={busy() ? "learn" : agentSettings.enabled() ? "idle" : "still"} onDark />
        <span class="side-agent-t">
          <b>{agentSettings.displayName()}</b>
          <small>{status()}</small>
        </span>
        <Show when={navStore.activeScriptId()}>
          <kbd>{K("Mod+L")}</kbd>
        </Show>
      </button>
    </Show>
  );
}

/** Section title of the sidebar. Click folds the section away; the
 *  choice is remembered (`sidebar.sections`). */
function SectionHead(props: { section: SidebarSection; label: string; children?: JSX.Element }) {
  const collapsed = () => uiStore.isSectionCollapsed(props.section);
  return (
    <div class="side-h">
      <button
        type="button"
        class="side-h-tog"
        aria-expanded={!collapsed()}
        title={collapsed() ? t("shell.group.expand") : t("shell.group.collapse")}
        onClick={() => uiStore.toggleSection(props.section)}
      >
        <span class="side-h-lbl">{props.label}</span>
        <Icon name={collapsed() ? "right" : "down"} size={11} class="side-h-chev" />
      </button>
      {props.children}
    </div>
  );
}

/** Entry of the "Open" list: stage, title, close button on hover. Middle
 *  click closes too; it can be dragged onto a folder like a list row. */
function OpenItem(props: {
  id: string;
  title: string;
  status: ScriptStatus | undefined;
  on: boolean;
  onOpen: () => void;
  onClose: () => void;
  onContextMenu: (e: MouseEvent) => void;
}) {
  return (
    <div
      class="nav side-open-item"
      classList={{ "is-on": props.on }}
      role="button"
      tabIndex={0}
      aria-current={props.on ? "page" : undefined}
      title={props.title}
      draggable={true}
      onDragStart={(e) => {
        if (!e.dataTransfer) return;
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData(SCRIPT_DRAG_MIME, props.id);
        e.dataTransfer.setData("text/plain", props.title);
      }}
      onClick={() => props.onOpen()}
      onAuxClick={(e) => {
        if (e.button !== 1) return;
        e.preventDefault();
        props.onClose();
      }}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          props.onOpen();
        }
      }}
      onContextMenu={(e) => props.onContextMenu(e)}
    >
      <Show when={props.status} fallback={<Icon name="doc" size={14} />}>
        {(st) => <StageGlyph stage={st()} />}
      </Show>
      <span class="lbl">{props.title}</span>
      <button
        type="button"
        class="side-open-x"
        title={t("shell.open.close")}
        aria-label={t("shell.open.closeAria", { title: props.title })}
        onClick={(e) => {
          e.stopPropagation();
          props.onClose();
        }}
      >
        <Icon name="x" size={12} />
      </button>
    </div>
  );
}

interface NavItemProps {
  on: boolean;
  sub?: boolean;
  drop?: boolean;
  icon: JSX.Element;
  label: string;
  count?: number;
  onClick: () => void;
  onContextMenu?: (e: MouseEvent) => void;
  onDragOver?: (e: DragEvent) => void;
  onDragLeave?: (e: DragEvent) => void;
  onDrop?: (e: DragEvent) => void;
}

function NavItem(props: NavItemProps) {
  return (
    <button
      type="button"
      class="nav"
      classList={{ "is-on": props.on, sub: !!props.sub, "is-drop": !!props.drop }}
      aria-current={props.on ? "page" : undefined}
      title={props.label}
      onClick={() => props.onClick()}
      onContextMenu={(e) => props.onContextMenu?.(e)}
      onDragOver={(e) => props.onDragOver?.(e)}
      onDragLeave={(e) => props.onDragLeave?.(e)}
      onDrop={(e) => props.onDrop?.(e)}
    >
      {props.icon}
      <span class="lbl">{props.label}</span>
      <Show when={props.count !== undefined && props.count > 0}>
        <span class="n">{props.count}</span>
      </Show>
    </button>
  );
}

function InlineInput(props: {
  initial: string;
  placeholder?: string;
  label: string;
  color?: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  let done = false;
  let inputRef: HTMLInputElement | undefined;
  const finish = (value: string | null) => {
    if (done) return;
    done = true;
    const v = value?.trim() ?? "";
    if (value === null || !v) props.onCancel();
    else props.onCommit(v);
  };
  // Removed while still editing (⌘\ hides the sidebar, the folder list
  // refreshes): a removed focused input doesn't reliably fire blur, so
  // commit like a blur would.
  onCleanup(() => {
    if (!done && inputRef) finish(inputRef.value);
  });
  return (
    <div class="nav sub side-edit">
      <span class="dot" style={props.color ? { background: props.color } : undefined} />
      <input
        ref={(el) => {
          inputRef = el;
          requestAnimationFrame(() => {
            el.focus();
            el.select();
          });
        }}
        type="text"
        value={props.initial}
        placeholder={props.placeholder}
        aria-label={props.label}
        spellcheck={false}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            finish(e.currentTarget.value);
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            finish(null);
          }
        }}
        onBlur={(e) => finish(e.currentTarget.value)}
      />
    </div>
  );
}
