import { For, Show, createSignal, createEffect } from "solid-js";
import type { LexicalEditor } from "lexical";
import { setBlockType } from "./plugins/blockHotkeys";
import type { BlockType } from "../../lib/types";
import { K } from "../../lib/keys";
import { t } from "../../i18n";
import "./EditorToolbar.css";

interface BlockDef {
  id: BlockType;
  label: string;
  hint: string;
}

// The three block types (Action, Character, Dialog) - the full set since
// the block-type reduction. This toolbar is replaced by the Werkbank head
// bar; kept compiling until then.
function primaryBlocks(): BlockDef[] {
  return [
    { id: "scriptz-action",    label: t("block.action"),    hint: K("Mod+1") },
    { id: "scriptz-character", label: t("block.character"), hint: K("Mod+2") },
    { id: "scriptz-dialog",    label: t("block.dialog"),    hint: K("Mod+3") },
  ];
}

export interface EditorToolbarProps {
  /** Current script title — shown as a controlled inline input. */
  title: string;
  /** Called when the title should be committed (blur / Enter). */
  onTitleCommit(next: string): void;

  /** Back to the overview (activates the home tab). */
  onBack(): void;

  /** Lexical editor instance for block switching; null before the editor mounts. */
  editor: LexicalEditor | null;
  /** Current block type under the cursor (drives the is-active state of
   *  the block pills). null = cursor not in any scriptz block. */
  activeBlock: string | null;

  /** Quick mode: active? available? toggle */
  quickModeOn(): boolean;
  quickModeAvailable(): boolean;
  onToggleQuickMode(): void;

  /** Character highlighting: currently on? toggle */
  highlightOn(): boolean;
  onToggleHighlight(): void;

  /** Toggle focus mode (⇧⌘F) */
  onToggleFocus(): void;

  /** Open the export dialog (⌘E) */
  onOpenExport(): void;
}

export function EditorToolbar(props: EditorToolbarProps) {
  const [draftTitle, setDraftTitle] = createSignal(props.title);

  createEffect(() => {
    setDraftTitle(props.title);
  });

  function commit() {
    const v = draftTitle().trim();
    if (v && v !== props.title) {
      props.onTitleCommit(v);
    } else {
      setDraftTitle(props.title);
    }
  }

  function clickBlock(id: BlockType) {
    const ed = props.editor;
    if (!ed) return;
    setBlockType(ed, id);
    requestAnimationFrame(() => {
      try { ed.focus(); } catch { /* ignore */ }
    });
  }

  return (
    <div class="editor-toolbar">
      <button
        type="button"
        class="editor-toolbar-back"
        onMouseDown={(e) => e.preventDefault() /* kein contenteditable-blur */}
        onClick={props.onBack}
        title={t("editor.toolbar.back.title")}
      >
        <ChevronLeftIcon />
        <span>{t("editor.toolbar.back")}</span>
      </button>

      <div class="editor-toolbar-divider" />

      <div class="editor-title-wrap">
        <input
          class="editor-title-input"
          value={draftTitle()}
          onInput={(e) => setDraftTitle(e.currentTarget.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              (e.currentTarget as HTMLInputElement).blur();
            } else if (e.key === "Escape") {
              setDraftTitle(props.title);
              (e.currentTarget as HTMLInputElement).blur();
            }
          }}
          spellcheck={false}
          aria-label={t("script.titleAriaLabel")}
        />
      </div>

      <div class="block-toolbar" role="group" aria-label={t("editor.toolbar.blockGroup")}>
        <For each={primaryBlocks()}>
          {(b) => (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              classList={{ "is-active": props.activeBlock === b.id }}
              title={`${b.label}  ${b.hint}`}
              onClick={() => clickBlock(b.id)}
              disabled={!props.editor}
              aria-disabled={!props.editor}
              aria-pressed={props.activeBlock === b.id}
            >
              <span class="block-toolbar-label">{b.label}</span>
              <span class="block-toolbar-hint" aria-hidden="true">{b.hint}</span>
            </button>
          )}
        </For>
      </div>

      <Show when={props.quickModeAvailable()}>
        <button
          class="editor-toolbar-action"
          classList={{ "is-on": props.quickModeOn() }}
          onClick={props.onToggleQuickMode}
          title={
            props.quickModeOn()
              ? t("editor.toolbar.quickOn")
              : t("editor.toolbar.quickOff")
          }
          aria-label={t("editor.toolbar.quickAria")}
          aria-pressed={props.quickModeOn()}
        >
          <BoltIcon />
        </button>
      </Show>

      <button
        class="editor-toolbar-action"
        classList={{ "is-on": props.highlightOn() }}
        onClick={props.onToggleHighlight}
        title={props.highlightOn() ? t("editor.toolbar.highlightOn") : t("editor.toolbar.highlightOff")}
        aria-label={t("editor.toolbar.highlightAria")}
        aria-pressed={props.highlightOn()}
      >
        <HighlightIcon />
      </button>

      <button
        class="editor-toolbar-action"
        onClick={props.onToggleFocus}
        title={t("editor.toolbar.focus.title", { hotkey: K("Mod+Shift+F") })}
        aria-label={t("editor.toolbar.focus.aria")}
      >
        <FocusIcon />
      </button>

      <button
        class="editor-toolbar-action editor-toolbar-export"
        onClick={props.onOpenExport}
        title={t("editor.toolbar.export.title", { hotkey: K("Mod+E") })}
      >
        <PdfIcon />
        <span>{t("editor.toolbar.export")}</span>
      </button>
    </div>
  );
}

/* ---- Icons ---- */
function ChevronLeftIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}
function BoltIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z" />
    </svg>
  );
}
function HighlightIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="6" cy="12" r="3" fill="#e0791f" />
      <circle cx="12" cy="12" r="3" fill="#3a8ed4" />
      <circle cx="18" cy="12" r="3" fill="#7a4ad4" />
    </svg>
  );
}
function FocusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
function PdfIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}
