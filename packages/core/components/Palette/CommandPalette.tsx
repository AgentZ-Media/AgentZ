import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  type JSX,
} from "solid-js";
import { Portal } from "solid-js/web";
import { api } from "../../lib/api";
import { K } from "../../lib/keys";
import { SCRIPT_STATUSES, type SearchHit } from "../../lib/types";
import { navStore } from "../../stores/nav";
import { uiStore } from "../../stores/ui";
import { ideasStore } from "../../stores/ideas";
import { t } from "../../i18n";
import { Icon, type IconName } from "../Common/Icon";
import { StageGlyph } from "../Common/StageGlyph";
import { library } from "../Shell/libraryData";
import { createScript, importScriptzFile } from "../Library/actions";
import { setStageWithUndo } from "../Script/stageActions";
import { safeSnippet } from "./snippet";
import "./CommandPalette.css";

type GroupKey = "recent" | "scripts" | "ideas" | "commands";

interface PaletteItem {
  id: string;
  group: GroupKey;
  label: string;
  /** Plain secondary line. */
  sub?: string;
  /** Escaped full-text snippet (HTML with <mark>). */
  snippetHtml?: string;
  icon: () => JSX.Element;
  hint?: string;
  /** Extra search words for commands. */
  keywords?: string;
  run: () => void;
}

const MAX_SCRIPTS = 8;
const MAX_CONTENT = 8;
const MAX_IDEAS = 6;
const MAX_RECENT = 6;

function groupLabel(g: GroupKey): string {
  if (g === "recent") return t("shell.palette.group.recent");
  if (g === "scripts") return t("shell.palette.group.scripts");
  if (g === "ideas") return t("shell.palette.group.ideas");
  return t("shell.palette.group.commands");
}

function icon(name: IconName): () => JSX.Element {
  return () => <Icon name={name} size={14} />;
}

/** All commands; script-bound ones only while a script is open. */
function commands(): PaletteItem[] {
  const scriptId = navStore.activeScriptId();
  const list: PaletteItem[] = [
    {
      id: "cmd:new-script",
      group: "commands",
      label: t("browser.newScript"),
      icon: icon("plus"),
      hint: K("Mod+N"),
      run: () => void createScript(),
    },
    {
      id: "cmd:new-idea",
      group: "commands",
      label: t("shell.cmd.newIdea"),
      icon: icon("bulb"),
      hint: K("Mod+I"),
      run: () => uiStore.openCapture(),
    },
    {
      id: "cmd:ideas",
      group: "commands",
      label: t("shell.cmd.openIdeas"),
      icon: () => <StageGlyph stage="idea" />,
      run: () => navStore.openIdeas(),
    },
    {
      id: "cmd:all",
      group: "commands",
      label: t("shell.nav.all"),
      icon: icon("stack"),
      run: () => navStore.openScripts(),
    },
  ];
  if (scriptId) {
    const current = library.script(scriptId)?.status;
    list.push(
      {
        id: "cmd:export",
        group: "commands",
        label: t("shell.cmd.export"),
        icon: icon("export"),
        hint: K("Mod+E"),
        run: () => uiStore.openExport(scriptId),
      },
      {
        id: "cmd:timeline",
        group: "commands",
        label: t("shell.cmd.timeline"),
        icon: icon("play"),
        hint: K("Mod+J"),
        run: () => uiStore.toggleTimeline(),
      },
      {
        id: "cmd:inspector",
        group: "commands",
        label: t("shell.cmd.inspector"),
        icon: icon("inspector"),
        hint: K("Mod+Shift+\\"),
        run: () => uiStore.toggleInspector(),
      },
      {
        id: "cmd:focus",
        group: "commands",
        label: t("shell.cmd.focus"),
        icon: icon("sun"),
        hint: K("Mod+Shift+F"),
        run: () => uiStore.toggleFocus(scriptId),
      },
    );
    for (const st of SCRIPT_STATUSES) {
      if (st === current) continue;
      list.push({
        id: `cmd:stage:${st}`,
        group: "commands",
        label: t("shell.cmd.stage", { stage: t(`stage.${st}`) }),
        keywords: t("shell.menu.stage"),
        icon: () => <StageGlyph stage={st} />,
        run: () => void setStageWithUndo(scriptId, st),
      });
    }
  }
  list.push(
    {
      id: "cmd:sidebar",
      group: "commands",
      label: t("shell.cmd.sidebar"),
      icon: icon("sidebar"),
      hint: K("Mod+\\"),
      run: () => uiStore.toggleSidebar(),
    },
    {
      id: "cmd:trash",
      group: "commands",
      label: t("browser.trash"),
      icon: icon("trash"),
      run: () => navStore.go({ kind: "trash" }),
    },
    {
      id: "cmd:import",
      group: "commands",
      label: t("browser.import.title"),
      icon: icon("import"),
      run: () => void importScriptzFile(),
    },
    {
      id: "cmd:settings",
      group: "commands",
      label: t("settings.title"),
      icon: icon("gear"),
      hint: K("Mod+,"),
      run: () => uiStore.openSettings(),
    },
    {
      id: "cmd:onboarding",
      group: "commands",
      label: t("shell.cmd.onboarding"),
      icon: icon("info"),
      run: () => uiStore.openOnboarding(),
    },
  );
  return list;
}

/** Commands shown with an empty query, in this order. */
const EMPTY_COMMANDS = new Set([
  "cmd:new-script",
  "cmd:new-idea",
  "cmd:ideas",
  "cmd:all",
  "cmd:export",
  "cmd:timeline",
  "cmd:focus",
  "cmd:settings",
]);

/**
 * ⌘K: search & commands. Empty query lists "Zuletzt" and the common
 * commands; with a query it searches script titles, full text
 * (`api.globalSearch`), ideas and commands. ↑↓ ⏎ Esc and mouse.
 */
export function CommandPalette() {
  const [query, setQuery] = createSignal("");
  const [hits, setHits] = createSignal<SearchHit[]>([]);
  const [active, setActive] = createSignal(0);
  let inputRef: HTMLInputElement | undefined;
  let listRef: HTMLDivElement | undefined;
  let searchSeq = 0;
  let searchTimer: ReturnType<typeof setTimeout> | null = null;

  // Element that had the focus before the palette opened (editor caret,
  // a list row); Esc hands the focus back to it.
  let returnFocus: HTMLElement | null = null;

  // Fresh state on every open.
  createEffect(
    on(uiStore.paletteOpen, (open) => {
      if (!open) return;
      const prev = document.activeElement;
      returnFocus = prev instanceof HTMLElement && prev !== document.body ? prev : null;
      setQuery("");
      setHits([]);
      setActive(0);
      queueMicrotask(() => inputRef?.focus());
    }),
  );

  const close = () => uiStore.closePalette();
  const dismiss = () => {
    const el = returnFocus;
    returnFocus = null;
    close();
    if (el?.isConnected) queueMicrotask(() => el.focus());
  };

  createEffect(
    on(query, (raw) => {
      const q = raw.trim();
      setActive(0);
      if (searchTimer) clearTimeout(searchTimer);
      const seq = ++searchSeq;
      if (q.length < 2) {
        setHits([]);
        return;
      }
      searchTimer = setTimeout(() => {
        api
          .globalSearch(q, 30)
          .then((r) => {
            if (seq === searchSeq) setHits(r);
          })
          .catch(() => {
            if (seq === searchSeq) setHits([]);
          });
      }, 140);
    }),
  );
  onCleanup(() => {
    if (searchTimer) clearTimeout(searchTimer);
  });

  const items = createMemo<PaletteItem[]>(() => {
    const q = query().trim().toLowerCase();
    if (!q) {
      const recent: PaletteItem[] = navStore
        .recent()
        .filter((r) => r.scriptId !== navStore.activeScriptId())
        .slice(0, MAX_RECENT)
        .map((r) => {
          const s = library.script(r.scriptId);
          const title = s?.title || r.title || t("common.untitled");
          return {
            id: `recent:${r.scriptId}`,
            group: "recent" as const,
            label: title,
            sub: s ? (library.folder(s.folder_id)?.name ?? undefined) : undefined,
            icon: s ? () => <StageGlyph stage={s.status} /> : icon("doc"),
            run: () => navStore.openScript(r.scriptId, title),
          };
        });
      return [...recent, ...commands().filter((c) => EMPTY_COMMANDS.has(c.id))];
    }

    // Scripts by title (prefix matches first), then full-text hits.
    const titleMatches = library
      .scripts()
      .filter((s) => s.title.toLowerCase().includes(q))
      .sort((a, b) => {
        const pa = a.title.toLowerCase().startsWith(q) ? 0 : 1;
        const pb = b.title.toLowerCase().startsWith(q) ? 0 : 1;
        return pa - pb || b.updated_at - a.updated_at;
      })
      .slice(0, MAX_SCRIPTS);
    const seen = new Set(titleMatches.map((s) => s.id));
    const scripts: PaletteItem[] = titleMatches.map((s) => ({
      id: `script:${s.id}`,
      group: "scripts",
      label: s.title || t("common.untitled"),
      sub: library.folder(s.folder_id)?.name,
      icon: () => <StageGlyph stage={s.status} />,
      run: () => navStore.openScript(s.id, s.title),
    }));
    let content = 0;
    for (const h of hits()) {
      if (seen.has(h.id) || content >= MAX_CONTENT) continue;
      const s = library.script(h.id);
      if (!s) continue; // archived or gone
      seen.add(h.id);
      content++;
      scripts.push({
        id: `hit:${h.id}`,
        group: "scripts",
        label: h.title || t("common.untitled"),
        snippetHtml: h.snippet ? safeSnippet(h.snippet) : undefined,
        icon: () => <StageGlyph stage={s.status} />,
        run: () => navStore.openScript(h.id, h.title),
      });
    }

    const ideas: PaletteItem[] = (ideasStore.ideas() ?? [])
      .filter((i) => !i.used_at)
      .filter((i) => i.title.toLowerCase().includes(q) || (i.notes ?? "").toLowerCase().includes(q))
      .slice(0, MAX_IDEAS)
      .map((i) => ({
        id: `idea:${i.id}`,
        group: "ideas",
        label: i.title,
        sub: (i.notes ?? "").split(/\r?\n/).find((l) => l.trim().length > 0)?.trim(),
        icon: () => <StageGlyph stage="idea" />,
        run: () => {
          // The ideas page selects + reveals it (clearing filters that hide it).
          uiStore.revealIdea(i.id);
          if (!navStore.isIdeas()) void navStore.openIdeas(i.folder_id);
        },
      }));

    const cmds = commands().filter((c) =>
      `${c.label} ${c.keywords ?? ""}`.toLowerCase().includes(q),
    );

    // A command whose label starts with the query ("neue idee", "zeitl")
    // is what the writer is typing out - lead with the commands so ⏎ runs
    // it instead of a full-text hit that merely contains the word.
    const cmdLeads = cmds.some((c) => c.label.toLowerCase().startsWith(q));
    return cmdLeads ? [...cmds, ...scripts, ...ideas] : [...scripts, ...ideas, ...cmds];
  });

  const groups = createMemo(() => {
    const out: { key: GroupKey; items: { item: PaletteItem; index: number }[] }[] = [];
    items().forEach((item, index) => {
      const last = out[out.length - 1];
      if (last && last.key === item.group) last.items.push({ item, index });
      else out.push({ key: item.group, items: [{ item, index }] });
    });
    return out;
  });

  const runItem = (item: PaletteItem | undefined) => {
    if (!item) return;
    returnFocus = null;
    close();
    // Let the palette unmount before the command opens another dialog.
    queueMicrotask(() => item.run());
  };

  // Keep the active row in view.
  createEffect(
    on(active, (i) => {
      queueMicrotask(() => {
        listRef?.querySelector<HTMLElement>(`[data-idx="${i}"]`)?.scrollIntoView({ block: "nearest" });
      });
    }),
  );

  const onKeyDown = (e: KeyboardEvent) => {
    const n = items().length;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      dismiss();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (n) setActive((i) => (i + 1) % n);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (n) setActive((i) => (i - 1 + n) % n);
    } else if (e.key === "Enter") {
      if (e.isComposing) return;
      e.preventDefault();
      runItem(items()[active()]);
    } else if (e.key === "Tab") {
      // Single-field dialog: keep the focus in the input.
      e.preventDefault();
    }
  };

  return (
    <Show when={uiStore.paletteOpen()}>
      <Portal>
        <div
          class="scrim top pal-scrim"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) dismiss();
          }}
        >
          <div class="dlg pal" role="dialog" aria-modal="true" aria-label={t("shell.palette.aria")}>
            <div class="pal-in">
              <Icon name="search" size={16} />
              <input
                ref={inputRef}
                class="pal-input"
                type="text"
                value={query()}
                placeholder={t("shell.palette.placeholder")}
                autocomplete="off"
                spellcheck={false}
                role="combobox"
                aria-expanded="true"
                aria-controls="pal-list"
                aria-activedescendant={items().length > 0 ? `pal-it-${active()}` : undefined}
                onInput={(e) => setQuery(e.currentTarget.value)}
                onKeyDown={onKeyDown}
              />
              <kbd>esc</kbd>
            </div>
            <div class="pal-list" id="pal-list" role="listbox" ref={listRef}>
              <Show
                when={items().length > 0}
                fallback={<div class="pal-empty">{t("shell.palette.empty", { query: query().trim() })}</div>}
              >
                <For each={groups()}>
                  {(g) => (
                    <div class="pal-grp" role="group" aria-label={groupLabel(g.key)}>
                      <div class="menu-h">{groupLabel(g.key)}</div>
                      <For each={g.items}>
                        {({ item, index }) => (
                          <div
                            id={`pal-it-${index}`}
                            data-idx={index}
                            class="pal-it"
                            classList={{ on: active() === index }}
                            role="option"
                            aria-selected={active() === index}
                            onMouseMove={() => {
                              if (active() !== index) setActive(index);
                            }}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => runItem(item)}
                          >
                            <span class="pal-ic">{item.icon()}</span>
                            <span class="pal-txt">
                              <span class="pal-lbl">{item.label}</span>
                              <Show
                                when={item.snippetHtml}
                                fallback={
                                  <Show when={item.sub}>
                                    <small>{item.sub}</small>
                                  </Show>
                                }
                              >
                                <small class="pal-snip" innerHTML={item.snippetHtml} />
                              </Show>
                            </span>
                            <Show when={item.hint}>
                              <kbd>{item.hint}</kbd>
                            </Show>
                            <span class="pal-enter" aria-hidden="true">
                              <Icon name="return" size={13} />
                            </span>
                          </div>
                        )}
                      </For>
                    </div>
                  )}
                </For>
              </Show>
            </div>
            <div class="pal-foot">
              <span>
                <kbd>↑</kbd>
                <kbd>↓</kbd>
                {t("shell.palette.hint.navigate")}
              </span>
              <span>
                <kbd>{K("Enter")}</kbd>
                {t("shell.palette.hint.open")}
              </span>
              <span>
                <kbd>esc</kbd>
                {t("shell.palette.hint.close")}
              </span>
            </div>
          </div>
        </div>
      </Portal>
    </Show>
  );
}

export default CommandPalette;
