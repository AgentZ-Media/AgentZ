import { For, Show, createMemo, createSignal, onCleanup, type JSX } from "solid-js";
import { navStore } from "../../stores/nav";
import { uiStore } from "../../stores/ui";
import { K } from "@agentz/kit/platform";
import { SCRIPT_STATUSES, type Folder, type ScriptStatus } from "../../lib/types";
import { t } from "../../i18n";
import { Icon } from "@agentz/kit/ui";
import { StageGlyph } from "../Common/StageGlyph";
import { ContextMenu, type ContextMenuItem } from "../Library/ContextMenu";
import { SCRIPT_DRAG_MIME } from "../Library/dnd";
import {
  createFolder,
  createScript,
  deleteFolder,
  moveScriptsTo,
  renameFolder,
} from "../Library/actions";
import { WritingCounter } from "../Activity/WritingCounter";
import { folderColor, library } from "./libraryData";

/** Row height used until a real `.nav` row can be measured. */
const FALLBACK_ROW_PX = 30;

/**
 * Left navigation (concept `#tpl-side`): app row, search + new, the inbox
 * (only while work is in progress), "Alle Skripte", the pipeline, folders,
 * recently opened scripts and the footer with the writing counter, trash
 * and settings. Always dark (`--side-*`).
 *
 * The recent section takes whatever height the nav has left after the
 * pipeline and folders (flex, see Shell.css) and shows as many scripts as
 * fit, so it grows with the window and never makes the sidebar scroll.
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

  // Rows that fit into the recent list. Without ResizeObserver (tests) the
  // whole history is shown.
  const [recentRows, setRecentRows] = createSignal(0);
  const fitRecent = (list: HTMLDivElement) => {
    if (typeof ResizeObserver === "undefined") {
      setRecentRows(Infinity);
      return;
    }
    const ro = new ResizeObserver(([entry]) => {
      const row =
        list.closest(".side-scroll")?.querySelector<HTMLElement>(".nav")?.offsetHeight || FALLBACK_ROW_PX;
      // The list's height comes from the flex layout, not from its rows, so
      // changing the row count never feeds back into this measurement.
      setRecentRows(Math.max(0, Math.floor((entry?.contentRect.height ?? 0) / row + 0.01)));
    });
    ro.observe(list);
    onCleanup(() => ro.disconnect());
  };

  const recent = createMemo(() =>
    navStore
      .recent()
      .slice(0, recentRows())
      .map((r) => ({
        id: r.scriptId,
        title: library.script(r.scriptId)?.title || r.title || t("common.untitled"),
      })),
  );

  const acceptsScript = (e: DragEvent) =>
    !!e.dataTransfer && Array.from(e.dataTransfer.types).includes(SCRIPT_DRAG_MIME);

  return (
    <>
      <div class="side-actions">
        <button type="button" class="side-search" onClick={() => uiStore.openPalette()}>
          <Icon name="search" size={14} />
          <span class="side-search-lbl">{t("shell.search")}</span>
          <kbd>{K("Mod+K")}</kbd>
        </button>
        <button
          type="button"
          class="side-new"
          title={t("shell.newScript.title", { hotkey: K("Mod+N") })}
          aria-label={t("browser.newScript")}
          onClick={() => void createScript()}
        >
          <Icon name="plus" />
        </button>
      </div>

      <nav class="side-scroll side-fit">
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

        <div class="side-h">{t("shell.section.pipeline")}</div>
        <NavItem
          on={route().kind === "ideas"}
          icon={<StageGlyph stage="idea" />}
          label={t("shell.nav.ideas")}
          count={library.openIdeas().length}
          onClick={() => navStore.openIdeas()}
        />
        <For each={SCRIPT_STATUSES}>
          {(st) => (
            <NavItem
              on={isStatusOn(st)}
              icon={<StageGlyph stage={st} />}
              label={t(`stage.${st}`)}
              count={library.statusCounts()[st]}
              onClick={() => navStore.openScripts({ status: st })}
            />
          )}
        </For>

        <div class="side-h">
          {t("shell.section.folders")}
          <button
            type="button"
            class="h-add"
            title={t("folder.new")}
            aria-label={t("folder.new")}
            onClick={() => setCreatingFolder(true)}
          >
            <Icon name="plus" size={12} />
          </button>
        </div>
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
          <button type="button" class="nav sub side-ghost" onClick={() => setCreatingFolder(true)}>
            <Icon name="plus" size={13} />
            <span class="lbl">{t("folder.new")}</span>
          </button>
        </Show>

        <Show when={navStore.recent().length > 0}>
          <div class="side-recent">
            {/* Hidden, not removed, when no row fits: removing it would give
                the list room for a row and toggle back and forth. */}
            <div class="side-h" classList={{ "is-hidden": recent().length === 0 }}>
              {t("shell.section.recent")}
            </div>
            <div class="side-recent-list" ref={fitRecent}>
              <For each={recent()}>
                {(r) => (
                  <NavItem
                    sub
                    on={navStore.activeScriptId() === r.id}
                    icon={<Icon name="doc" size={14} />}
                    label={r.title}
                    onClick={() => navStore.openScript(r.id, r.title)}
                  />
                )}
              </For>
            </div>
          </div>
        </Show>
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
