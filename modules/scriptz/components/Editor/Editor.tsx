import { Show, onCleanup, onMount, createEffect, createSignal } from "solid-js";
import {
  createEditor,
  $getRoot,
  type LexicalEditor,
  type EditorThemeClasses,
} from "lexical";
import { registerHistory, createEmptyHistoryState } from "@lexical/history";
import { registerRichText } from "@lexical/rich-text";
import {
  SCRIPTZ_NODES,
  BaseScriptzNode,
  $createScriptzCharacterNode,
} from "./nodes";
import { installSmartEnter } from "./plugins/smartEnter";
import { installBlockDropdown } from "./plugins/blockDropdown";
import { installAllCaps } from "./plugins/allcaps";
import { installParentheticalLive } from "./plugins/parentheticalLive";
import { installInlineFormat } from "./plugins/inlineFormat";
import { installBlockHotkeys } from "./plugins/blockHotkeys";
import { installCharacterDropdown } from "./plugins/characterDropdown";
import { installHighlight } from "./plugins/highlight";
import { installColorPicker } from "./plugins/colorPicker";
import { api } from "../../lib/api";
import { normalizeLegacyContent } from "../../lib/legacyBlocks";
import { settingsStore } from "../../stores/settings";
import { K } from "@agentz/kit/platform";
import { t } from "../../i18n";
import type { ScriptCharacter } from "../../lib/types";
import { applyCursor, type CursorAddress } from "../../lib/scriptViewCache";
import { createActiveBlockReporter } from "./activeBlockReporter";
import { createCharacterReconcile } from "./characterReconcile";
import { createPersistence } from "./persistence";
import { installCanvasFocus } from "./canvasFocus";
import "./Editor.css";

export interface EditorProps {
  scriptId: string;
  initialContentJson: string | null | undefined;
  /** Optional cursor set after mount instead of `rootEnd`.
   *  The script screen passes the last known cursor of the script through
   *  here so the user lands back exactly where they were. */
  initialCursor?: CursorAddress | null;
  characters: ScriptCharacter[];
  highlighting?: boolean;
  /** Read-only mode for snapshot previews: the script renders identically
   *  but the editor is not editable, no autosave/persistence is wired, and
   *  the mutating plugins (smart-enter, block hotkeys, colour picker, ...)
   *  are not installed. Defaults to false for the normal editing flow. */
  readOnly?: boolean;
  /** Quick-mode toggle — when on AND the script has exactly 2 characters,
   * pressing Enter at the end of a Dialog auto-inserts the OTHER character
   * + a fresh Dialog block, so two-hander dialogue flows without manual
   * character-name entry. Read reactively (called on each Enter). */
  quickModeEnabled?: () => boolean;
  onSavingChange?: (saving: boolean) => void;
  /** Fires whenever the live character list changes — used by the parent
   * to drive the quick-mode availability check (need exactly 2). */
  onCharactersChange?: (chars: ScriptCharacter[]) => void;
  /** Fires when `initialContentJson` cannot be parsed by Lexical. The
   * editor will NOT mount (and will NOT auto-overwrite the broken state)
   * — the parent is expected to render a recovery UI instead. */
  onParseError?: (rawJson: string) => void;
  /** Returns the `LexicalEditor` instance to the parent after mount — the
   *  script screen uses it for the live timeline, the gutter label and
   *  jumping to a block. */
  onEditorReady?: (editor: LexicalEditor) => void;
  /** Fires whenever the cursor moves into a different block type (or out
   *  of any Scriptz block, in which case the value is `null`). Drives the
   *  block-type indicator of the parent. */
  onActiveBlockChange?: (blockType: string | null) => void;
  /** Hands the parent a function that opens the character colour picker
   *  for a name, anchored at a viewport point (the script inspector's cast
   *  dots use it). Not called in read-only mode. */
  onColorPickerReady?: (
    open: (name: string, anchor: { x: number; y: number }) => void,
  ) => void;
}

const THEME: EditorThemeClasses = {};

function seedEmptyState(editor: LexicalEditor) {
  editor.update(
    () => {
      const root = $getRoot();
      root.clear();
      const charBlock = $createScriptzCharacterNode();
      // Leave the block CHILDLESS — Lexical's reconciler injects a placeholder
      // <br> so the browser has a caret target. Pre-appending an empty
      // TextNode("") produces an empty span the browser can't caret-target.
      root.append(charBlock);
      charBlock.select(0, 0);
    },
    { discrete: true },
  );
}

export function Editor(props: EditorProps) {
  let rootRef: HTMLDivElement | undefined;
  let hostRef: HTMLDivElement | undefined;

  // Live character list seeded from storage, then updated in memory as
  // the writer adds/renames Charakter blocks. We deliberately stop refetching
  // the whole script after every save (that was disrupting contentEditable
  // focus mid-keystroke); instead, walk the Lexical state ourselves. Names
  // already persisted keep their assigned palette color; freshly-
  // typed names get a neutral placeholder until the script is reloaded.
  const [liveCharacters, setLiveCharacters] = createSignal<ScriptCharacter[]>(
    props.characters ?? [],
  );

  onMount(() => {
    if (!rootRef || !hostRef) return;

    const readOnly = !!props.readOnly;
    const noop = () => {};

    const editor = createEditor({
      namespace: "scriptz",
      nodes: SCRIPTZ_NODES as unknown as Array<typeof BaseScriptzNode>,
      theme: THEME,
      onError: (err: Error) => console.error("[lexical]", err),
    } as unknown as Parameters<typeof createEditor>[0]);

    editor.setRootElement(rootRef);

    // Read-only version preview: render the script but
    // disable editing. Set before the content is loaded so Lexical never
    // moves the DOM selection (and with it focus) into this instance.
    if (readOnly) editor.setEditable(false);

    // Expose the editor instance to the parent (script screen).
    props.onEditorReady?.(editor);

    // Lexical's default text-insertion handlers live in @lexical/rich-text.
    // Without this, beforeinput dispatches CONTROLLED_TEXT_INSERTION_COMMAND
    // but nobody handles it, so input visibly "stops working".
    const teardownRichText = registerRichText(editor);

    const teardownHistory = registerHistory(
      editor,
      createEmptyHistoryState(),
      1000,
    );

    let loaded = false;
    if (props.initialContentJson) {
      try {
        // Retired block types (camera, caption, sfx) have no
        // node class anymore - convert them to action before parsing, or
        // Lexical would reject the whole state.
        const { json } = normalizeLegacyContent(props.initialContentJson);
        const state = editor.parseEditorState(json);
        editor.setEditorState(state);
        loaded = true;
      } catch (err) {
        console.error(
          "[scriptz] failed to parse initial state — bailing out so we don't auto-overwrite",
          err,
        );
        // Tell the parent to mount the recovery UI. Importantly we DO
        // NOT seed an empty state and DO NOT attach the auto-save loop:
        // the next persist() would silently overwrite the user's broken-
        // but-present content_json with `{root:{children:[…empty…]}}`,
        // making recovery impossible.
        if (props.onParseError) {
          try { teardownHistory(); } catch { /* ignore */ }
          try { teardownRichText(); } catch { /* ignore */ }
          editor.setRootElement(null);
          props.onParseError(props.initialContentJson);
          return;
        }
        // No parent handler? Fall through to the historical behaviour
        // (seed empty) so the editor at least functions — but log loudly.
      }
    }
    if (!loaded) {
      seedEmptyState(editor);
    }

    // Word-style: when a script becomes the active editor, the writer
    // should be able to start typing immediately — no manual click into
    // the contenteditable area required. If an `initialCursor` was
    // provided (returning to a previously open script), we place
    // the cursor at the saved spot and focus WITHOUT `defaultSelection`
    // — otherwise Lexical would overwrite the just-set selection back
    // to rootEnd. Without a saved cursor: to the end of the document.
    const initialCursor = props.initialCursor ?? null;
    if (!readOnly)
      requestAnimationFrame(() => {
        try {
          if (initialCursor) {
            applyCursor(editor, initialCursor);
            editor.focus();
          } else {
            editor.focus(undefined, { defaultSelection: "rootEnd" });
          }
        } catch {
          /* ignore — non-fatal if the editor was torn down meanwhile */
        }
      });

    // In read-only mode the mutating/interactive plugins are skipped — only
    // the highlight pass stays so character tints render as usual.
    const teardownCanvasFocus = readOnly ? noop : installCanvasFocus(rootRef, editor);

    const teardownSmartEnter = readOnly
      ? noop
      : installSmartEnter(editor, {
          isQuickModeOn: () => !!props.quickModeEnabled?.(),
          getCharacters: () => liveCharacters(),
        });
    const teardownAllCaps = readOnly ? noop : installAllCaps(editor);
    const teardownParen = readOnly ? noop : installParentheticalLive(editor);
    const teardownInlineFmt = readOnly ? noop : installInlineFormat(editor);
    const teardownBlockHK = readOnly ? noop : installBlockHotkeys(editor);
    const teardownBlockDD = readOnly ? noop : installBlockDropdown(editor, hostRef);
    // Highlight first so we can pass its `refresh` to the colour picker —
    // the picker mutates `liveCharacters` outside any editor state change,
    // and without an explicit refresh the tint wouldn't repaint until the
    // next keystroke / selection change.
    const highlight = installHighlight(editor, () => liveCharacters());
    const colorPicker = readOnly
      ? { openFor: () => {}, teardown: noop }
      : installColorPicker(editor, hostRef, () => ({
          scriptId: props.scriptId,
          getCharacters: () => liveCharacters(),
          setCharacters: (next) => {
            setLiveCharacters(next);
            props.onCharactersChange?.(next);
            highlight.refresh();
          },
        }));
    if (!readOnly) props.onColorPickerReady?.(colorPicker.openFor);
    const teardownCharDD = readOnly
      ? noop
      : installCharacterDropdown(editor, hostRef, () => ({
          scriptCharacters: () => liveCharacters(),
          openColorPicker: colorPicker.openFor,
        }));

    // Recompute character tints when the user toggles the dark-paper option
    // or the resolved theme changes (auto + system switch).
    let firstPaperSync = true;
    createEffect(() => {
      settingsStore.darkPaper();
      settingsStore.resolvedTheme();
      if (firstPaperSync) {
        firstPaperSync = false;
        return;
      }
      // Next frame: the theme attributes on <html> (and with them the
      // `--paper` token the tint is mixed against) are written by the
      // settings store's own effect, which may run after this one.
      requestAnimationFrame(() => highlight.refresh());
    });

    // Cache of the app-wide character color records (override ?? default
    // from character_colors). Loaded once on mount and updated after
    // every save with the save result. The sync reconcile path
    // uses this so a recurring character (same name already tinted in
    // another script) gets the right color immediately instead of only
    // after the debounced DB roundtrip.
    const knownColors = new Map<string, string>();

    // Character reconciliation (runs synchronously on every keystroke).
    const charReconcile = createCharacterReconcile({
      editor,
      getKnownColors: () => knownColors,
      getLiveCharacters: () => liveCharacters(),
      setLiveCharacters,
      onChange: (next) => {
        props.onCharactersChange?.(next);
        highlight.refresh();
      },
    });

    api
      .listCharacterColors()
      .then((records) => {
        for (const r of records) {
          const color = r.override_color ?? r.default_color;
          if (color) knownColors.set(r.name.toUpperCase(), color);
        }
        // If the editor already contained characters (seeded from props),
        // reconcile again now so the cache takes effect.
        charReconcile.reconcileLiveCharactersSync();
      })
      .catch(() => {
        /* without the cache, the palette fallback further down takes over */
      });

    // Pull external color updates (e.g. from the settings characters tab)
    // live into the running editor. The script screen refetches on
    // `scriptsBus.bump()` and passes the fresh `characters` as a prop —
    // we merge ONLY colors (no replace), so currently-typed, not-yet-
    // saved names aren't overwritten. The first run is skipped because
    // `liveCharacters` is already seeded from props.
    let firstCharacterSync = true;
    createEffect(() => {
      const incoming = props.characters ?? [];
      if (firstCharacterSync) {
        firstCharacterSync = false;
        return;
      }
      if (charReconcile.mergeExternalColors(incoming)) {
        highlight.refresh();
      }
    });

    // Persistence (debounced save, teardown-race guard, snapshot loop).
    // Skipped entirely in read-only mode — nothing is ever written back.
    const persistence = readOnly
      ? null
      : createPersistence({
          editor,
          scriptId: props.scriptId,
          initialContentJson: props.initialContentJson,
          knownColors,
          mergeAfterSave: (summary) => charReconcile.mergeAfterSave(summary),
          onSavingChange: props.onSavingChange,
        });

    // Active-block reporter (block-type indicator + empty marker).
    const reporter = createActiveBlockReporter({
      editor,
      getRootEl: () => rootRef,
      onActiveBlockChange: props.onActiveBlockChange,
    });
    requestAnimationFrame(reporter.reportActiveBlock);
    requestAnimationFrame(reporter.updateEmptyMarker);

    const teardownUpdate = editor.registerUpdateListener(
      ({ dirtyElements, dirtyLeaves }) => {
        // Selection tracking independent of the dirty state — the cursor
        // can move without anything being typed.
        reporter.reportActiveBlock();

        if (dirtyElements.size === 0 && dirtyLeaves.size === 0) return;
        reporter.updateEmptyMarker();
        // Reconcile the character list IMMEDIATELY (not only after save
        // debounce) so the tint stays on character / dialog as soon as
        // the user presses Enter after the name — even when typing
        // without a pause.
        charReconcile.reconcileLiveCharactersSync();
        persistence?.scheduleSave();
      },
    );

    onCleanup(() => {
      persistence?.teardown();
      teardownCanvasFocus();
      teardownUpdate();
      highlight.teardown();
      teardownCharDD();
      colorPicker.teardown();
      teardownBlockDD();
      teardownBlockHK();
      teardownInlineFmt();
      teardownParen();
      teardownAllCaps();
      teardownSmartEnter();
      teardownHistory();
      teardownRichText();
      editor.setRootElement(null);
    });
  });

  createEffect(() => {
    if (!rootRef) return;
    rootRef.setAttribute("data-highlighting", props.highlighting ? "on" : "off");
  });

  return (
    <div ref={hostRef} class="editor-host">
      <div
        ref={rootRef}
        class="editor-root"
        contentEditable={!props.readOnly}
        spellcheck={!props.readOnly}
        data-highlighting={props.highlighting ? "on" : "off"}
      />
      {/* Hotkey hint: only visible when the editor root carries
          data-empty="1". Lives outside the contenteditable so the
          Lexical selection doesn't get stuck on a ::before
          pseudo-caret target. Pointless when nothing can be typed. */}
      <Show when={!props.readOnly}>
        <div class="editor-empty-hint" aria-hidden="true">
          {(() => {
            // Slots {tab}, {first}, {last} get replaced by <kbd> chips so
            // the platform-correct hotkey label (⌘ vs Ctrl) is rendered.
            const re = /\{(tab|first|last)\}/g;
            const raw = t("editor.empty.hint");
            const out: (string | { slot: string })[] = [];
            let last = 0;
            let m: RegExpExecArray | null;
            while ((m = re.exec(raw)) !== null) {
              if (m.index > last) out.push(raw.slice(last, m.index));
              out.push({ slot: m[1] });
              last = m.index + m[0].length;
            }
            if (last < raw.length) out.push(raw.slice(last));
            return out.map((p) => {
              if (typeof p === "string") return p;
              if (p.slot === "tab") return <span class="kbd kbd-inline">{t("shortcut.key.tab")}</span>;
              if (p.slot === "first") return <span class="kbd kbd-inline">{K("Mod+1")}</span>;
              return <span class="kbd kbd-inline">{K("Mod+4")}</span>;
            });
          })()}
        </div>
      </Show>
    </div>
  );
}

export default Editor;
