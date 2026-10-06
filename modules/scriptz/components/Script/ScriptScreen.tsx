import { kvStore } from "@agentz/kit/platform";
import {
  Show,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  on,
  onCleanup,
  onMount,
  Suspense,
} from "solid-js";
import { $getNodeByKey, $isElementNode, type LexicalEditor } from "lexical";
import { Editor } from "../Editor/Editor";
import { SnapshotsDialog } from "../Editor/SnapshotsDialog";
import { api } from "../../lib/api";
import { scriptSavedBus, scriptsBus } from "../../lib/scriptsBus";
import { isModKey } from "@agentz/kit/platform";
import { requireSuccessfulFlush } from "@agentz/kit/lib";
import { computeTimeline, type TimelineSegment } from "../../lib/timing";
import { folderHasLengthRange, resolveLengthRange } from "../../lib/lengthGoal";
import { captureCursor, scriptViewCache, type CursorAddress } from "../../lib/scriptViewCache";
import type { Folder, Script, ScriptCharacter, ScriptSummary } from "../../lib/types";
import { navStore } from "../../stores/nav";
import { settingsStore } from "../../stores/settings";
import { defaultLengthRange, library } from "../Shell/libraryData";
import { uiStore } from "../../stores/ui";
import { createStatePersistence, pushToast } from "@agentz/kit/stores";
import { t } from "../../i18n";
import { TopBar } from "./TopBar";
import { Inspector } from "./Inspector";
import { Timeline, type RangeSource } from "./Timeline";
import { GutterLabel } from "./GutterLabel";
import { HookMarks } from "./HookMarks";
import { ClaimMarks } from "../Agent/ClaimMarks";
import { agentSettings } from "../../stores/agentSettings";
import type { AgentJobId } from "../../lib/agent/jobs";
import { JOB_LABEL } from "../Agent/jobLabels";
import { RecoveryPanel } from "./RecoveryPanel";
import { FocusPill } from "./FocusChrome";
import { TitleInput } from "./TitleInput";
import { StageUndoToast } from "./StageToast";
import { createLiveEditorModel } from "./liveEditor";
import { ChatPanel } from "../Agent/ChatPanel";
import { AgentContextMenu } from "../Agent/AgentContextMenu";
import { registerAgentEditor } from "../Agent/editorBridge";
import { agentUi } from "../../stores/agentUi";
import { agentStore } from "../../stores/agent";
import { liveStats, playheadSec, speechGroupKeys } from "./timelineMath";
import { prefersReducedMotion } from "../Common/motion";
import "../Editor/PaperLayout.css";
import "./ScriptScreen.css";

export interface ScriptScreenProps {
  scriptId: string;
  /** Rendered in the side panel of a list: no inspector and no focus
   *  mode; the top bar offers "open full view" and "close". */
  peek?: { onExpand(): void; onClose(): void };
}

const QUICK_MODE_KEY = (id: string) => `script.${id}.quick_mode`;
/** Below this window width the inspector becomes an overlay from the right. */
const NARROW_PX = 1200;

const EMPTY_DOC = JSON.stringify({
  root: {
    type: "root",
    version: 1,
    direction: null,
    format: "",
    indent: 0,
    children: [
      {
        type: "scriptz-character",
        version: 1,
        characterName: "",
        direction: null,
        format: "",
        indent: 0,
        children: [],
      },
    ],
  },
});

/** Titles that count as "not named yet" - the app default in either
 *  language, or empty. Comparison only, never displayed. */
function isUntitled(title: string): boolean {
  const v = title.trim();
  return v === "" || v === t("common.untitled") || v === "Unbenannt" || v === "Untitled";
}

function errMessage(err: unknown): string {
  return (err as Error)?.message ?? String(err);
}

/**
 * The script screen: top bar, endless paper, timeline
 * and the inspector to the right. The shell mounts it for `route.kind ===
 * "script"`; it may stay mounted across script switches (props change).
 * The list pages mount it as side panel (`peek`); only one of the two
 * exists at a time, opening the full view closes the panel.
 */
export function ScriptScreen(props: ScriptScreenProps) {
  const isPeek = () => props.peek !== undefined;
  // ---------- data ----------
  // The newest autosave summary: a reload that read the row before that
  // save committed must not roll the screen back to the older values.
  let lastSaved: ScriptSummary | null = null;
  const [script, { mutate: setScript }] = createResource<Script | null, { id: string; v: number }>(
    () => ({ id: props.scriptId, v: scriptsBus.version() }),
    async ({ id }, info) => {
      try {
        const fresh = await api.getScript(id);
        const saved = lastSaved;
        return saved && saved.id === id && saved.updated_at > fresh.updated_at ? { ...fresh, ...saved } : fresh;
      } catch (err) {
        console.warn("[scriptz] script load failed", err);
        const prev = info.value;
        return prev && prev.id === id ? prev : null;
      }
    },
  );
  // Autosaves patch the loaded script with their summary instead of
  // re-reading it with its whole content (the editor owns the content).
  const offSaved = scriptSavedBus.listen((summary) => {
    lastSaved = summary;
    const prev = script.latest;
    if (prev && prev.id === summary.id) setScript({ ...summary, content_json: prev.content_json });
  });
  onCleanup(offSaved);

  const current = () => {
    const s = script.latest;
    return s ?? null;
  };
  const folder = createMemo<Folder | null>(() => {
    const fid = current()?.folder_id ?? null;
    if (!fid) return null;
    return library.folder(fid) ?? null;
  });
  const range = createMemo(() => resolveLengthRange(folder(), defaultLengthRange()));
  const rangeSource = createMemo<RangeSource | null>(() => {
    if (!range()) return null;
    const f = folder();
    return f && folderHasLengthRange(f) ? { kind: "folder", name: f.name } : { kind: "default" };
  });

  // ---------- editor + live model ----------
  const live = createLiveEditorModel();
  const [editor, setEditor] = createSignal<LexicalEditor | null>(null);
  // The agent reads and edits the mounted editor of this script.
  createEffect(() => {
    const ed = editor();
    const id = props.scriptId;
    if (!ed) return;
    onCleanup(registerAgentEditor(id, ed));
  });
  const [epoch, setEpoch] = createSignal(0);
  const [parseError, setParseError] = createSignal<string | null>(null);
  const [recovering, setRecovering] = createSignal(false);
  const [snapshotsOpen, setSnapshotsOpen] = createSignal(false);
  const [versionsKey, setVersionsKey] = createSignal(0);
  const bumpVersions = () => setVersionsKey((k) => k + 1);
  let openColorPicker: ((name: string, anchor: { x: number; y: number }) => void) | null = null;

  const [liveChars, setLiveChars] = createSignal<ScriptCharacter[]>([]);
  createEffect(() => {
    const s = current();
    if (s) setLiveChars(s.characters);
  });

  const wpm = () => settingsStore.dialogWpm();
  const stats = createMemo(() => liveStats(live.blocks(), wpm()));
  const segments = createMemo(() => computeTimeline(live.blocks(), wpm()));
  const playhead = createMemo<number>((prev) => {
    const key = live.caret()?.key ?? null;
    const blocks = live.blocks();
    // The caret updates immediately, the block list is debounced: a block
    // created a moment ago isn't known yet - keep the last position.
    if (key && !blocks.some((b) => b.key === key)) return prev;
    return playheadSec(blocks, segments(), key);
  }, 0);

  const colorOf = (name: string): string =>
    liveChars().find((c) => c.name.toUpperCase() === name)?.color ?? "var(--muted)";

  // Session words for the focus pill: words now minus words at open. The
  // baseline is taken from the first loaded state of the editor that
  // belongs to this script (not from a previous script's leftover blocks).
  const [attachedFor, setAttachedFor] = createSignal<string | null>(null);
  const [baseline, setBaseline] = createSignal<{ id: string; words: number } | null>(null);
  createEffect(() => {
    const id = attachedFor();
    if (!id || id !== props.scriptId || !live.loaded()) return;
    const b = baseline();
    if (!b || b.id !== id) setBaseline({ id, words: stats().words });
  });
  const sessionWords = () => {
    const b = baseline();
    if (!b || b.id !== props.scriptId) return 0;
    return Math.max(0, stats().words - b.words);
  };

  // ---------- highlighting + quick mode ----------
  const highlightingOn = () => {
    const s = current();
    if (!s) return false;
    if (s.highlighting_enabled === 1) return true;
    if (s.highlighting_enabled === 0) return false;
    return settingsStore.highlightingDefault();
  };
  const toggleHighlight = async () => {
    const s = current();
    if (!s) return;
    try {
      await api.updateScript({ id: s.id, highlightingEnabled: highlightingOn() ? 0 : 1 });
      scriptsBus.bump();
    } catch (err) {
      pushToast(t("editor.toast.highlightFailed", { message: errMessage(err) }), "error");
    }
  };

  const [quickOverride, setQuickOverride] = createSignal<"1" | "0" | null>(null);
  const quickAvailable = () => liveChars().length === 2;
  const quickMode = () => {
    if (!quickAvailable()) return false;
    const m = quickOverride();
    if (m !== null) return m === "1";
    return settingsStore.quickModeAutoEnable();
  };
  createEffect(() => {
    const id = props.scriptId;
    let cancelled = false;
    setQuickOverride(null);
    void kvStore
      .getAppState(QUICK_MODE_KEY(id))
      .then((raw) => {
        if (!cancelled) setQuickOverride(raw === "1" || raw === "0" ? raw : null);
      })
      .catch(() => {});
    onCleanup(() => {
      cancelled = true;
    });
  });
  // Buffered like the focus choice, so window close waits for the write.
  let quickWrite: { key: string; persistence: ReturnType<typeof createStatePersistence> } | undefined;
  onCleanup(() => quickWrite?.persistence.dispose());
  const toggleQuick = () => {
    if (!quickAvailable()) return;
    const next = quickMode() ? "0" : "1";
    setQuickOverride(next);
    const key = QUICK_MODE_KEY(props.scriptId);
    if (quickWrite?.key !== key) {
      quickWrite?.persistence.dispose();
      quickWrite = { key, persistence: createStatePersistence(kvStore, key) };
    }
    quickWrite.persistence.schedule(next);
  };

  // ---------- title ----------
  const [focusTitleFor, setFocusTitleFor] = createSignal<string | null>(null);
  let lastOpenedId: string | null = null;
  createEffect(() => {
    const s = current();
    if (!s || s.id !== props.scriptId) return;
    navStore.setScriptTitle(s.id, s.title);
    if (s.id !== lastOpenedId) {
      lastOpenedId = s.id;
      setFocusTitleFor(isUntitled(s.title) ? s.id : null);
    }
  });
  /** Renames `id` (passed by the title input, which may commit after the
   *  screen already switched to another script). Rejects after the toast
   *  so the input keeps its draft pending. */
  const rename = async (next: string, id: string): Promise<void> => {
    try {
      const updated = await api.renameScript(id, next);
      navStore.setScriptTitle(id, updated.title);
      scriptsBus.bump();
    } catch (err) {
      pushToast(t("editor.toast.renameFailed", { message: errMessage(err) }), "error");
      throw err;
    }
  };

  // ---------- layout: inspector, narrow overlay, focus ----------
  const [narrow, setNarrow] = createSignal(typeof window !== "undefined" && window.innerWidth < NARROW_PX);
  const [overlayArmed, setOverlayArmed] = createSignal(false);
  onMount(() => {
    const onResize = () => setNarrow(window.innerWidth < NARROW_PX);
    window.addEventListener("resize", onResize);
    onCleanup(() => window.removeEventListener("resize", onResize));
  });
  createEffect(on(narrow, (n) => n && setOverlayArmed(false)));
  // Any inspector toggle (also ⌘⇧\ from the shell) arms the overlay.
  createEffect(on(uiStore.inspectorOpen, () => setOverlayArmed(true), { defer: true }));

  const focus = () => !isPeek() && uiStore.focusMode();
  /** Typewriter focus (setting, default off): the caret line stays in the
   *  middle of the screen, every other speech run steps back. */
  const typewriter = () => focus() && settingsStore.focusTypewriter();
  /** Ida's jobs from the paper and the timeline: only in the full view and
   *  with the agent switched on and set up. */
  const agentReady = () => !isPeek() && agentStore.available() && agentSettings.enabled() && agentSettings.onboarded();
  const askJob = (job: AgentJobId) => agentUi.ask({ scriptId: props.scriptId, text: t(JOB_LABEL[job]), send: true, job });
  /** The agent chat takes the inspector's place while it is open. Never in
   *  the peek panel: the agent belongs to the full-size editor. */
  const agentVisible = () => !isPeek() && agentStore.available() && !focus() && agentUi.chatOpen(props.scriptId);
  const inspectorVisible = () =>
    !isPeek() && !focus() && !parseError() && !agentVisible() && uiStore.inspectorOpen() && (!narrow() || overlayArmed());
  const toggleInspector = () => {
    if (agentVisible()) {
      agentUi.setChatOpen(props.scriptId, false);
      if (!uiStore.inspectorOpen()) uiStore.toggleInspector();
      setOverlayArmed(true);
      return;
    }
    if (!narrow()) {
      uiStore.toggleInspector();
      return;
    }
    if (inspectorVisible()) {
      setOverlayArmed(false);
      return;
    }
    if (!uiStore.inspectorOpen()) uiStore.toggleInspector();
    setOverlayArmed(true);
  };

  let inspRef: HTMLDivElement | undefined;
  createEffect(() => {
    if (!narrow() || !inspectorVisible()) return;
    const onDown = (ev: MouseEvent) => {
      const target = ev.target as Element | null;
      if (!target || inspRef?.contains(target)) return;
      if (target.closest(".scriptz-color-popover, .ss-insp-toggle, .modal-backdrop, .scrim")) return;
      setOverlayArmed(false);
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape" && !uiStore.anyDialogOpen() && !snapshotsOpen()) setOverlayArmed(false);
    };
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onKey);
    onCleanup(() => {
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("keydown", onKey);
    });
  });

  // ---------- scroll + cursor per script (survives script switches) ----------
  let canvasRef: HTMLDivElement | undefined;
  const [sheetEl, setSheetEl] = createSignal<HTMLDivElement | undefined>();
  let lastScrollTop = 0;
  onMount(() => {
    if (!canvasRef) return;
    const onScroll = () => {
      if (canvasRef) lastScrollTop = canvasRef.scrollTop;
    };
    canvasRef.addEventListener("scroll", onScroll, { passive: true });
    onCleanup(() => canvasRef?.removeEventListener("scroll", onScroll));
  });

  // Stash the state of the script we're leaving (fires before the new id
  // takes effect, and on unmount).
  createEffect(() => {
    const id = props.scriptId;
    onCleanup(() => {
      let cursor: CursorAddress | null = null;
      const ed = editor();
      if (ed) {
        try {
          cursor = captureCursor(ed);
        } catch {
          /* ignore */
        }
      }
      scriptViewCache.set(id, { scrollTop: lastScrollTop, cursor });
    });
  });

  // Restore the cached scroll position once the new script is rendered.
  // Several frames, because the editor needs to lay out its full height
  // before the browser accepts the scrollTop.
  let appliedScrollFor: string | null = null;
  let scrollRun = 0;
  createEffect(() => {
    const id = current()?.id;
    if (!id || appliedScrollFor === id || !canvasRef) return;
    appliedScrollFor = id;
    const run = ++scrollRun;
    const target = scriptViewCache.get(id)?.scrollTop ?? 0;
    if (target <= 0) {
      canvasRef.scrollTop = 0;
      lastScrollTop = 0;
      return;
    }
    let attempts = 8;
    let raf = 0;
    const apply = () => {
      if (!canvasRef || run !== scrollRun) return;
      canvasRef.scrollTop = target;
      lastScrollTop = canvasRef.scrollTop;
      if (canvasRef.scrollTop < target - 1 && attempts-- > 0) raf = requestAnimationFrame(apply);
    };
    raf = requestAnimationFrame(apply);
    onCleanup(() => {
      scrollRun++;
      if (raf) cancelAnimationFrame(raf);
    });
  });

  createEffect(
    on(
      () => props.scriptId,
      () => {
        setParseError(null);
        setSnapshotsOpen(false);
        setEditor(null);
        openColorPicker = null;
      },
      { defer: true },
    ),
  );

  // ---------- recovery + snapshots ----------
  const resetToEmpty = async () => {
    if (recovering()) return;
    setRecovering(true);
    try {
      try {
        await api.createSnapshot(props.scriptId, "manual");
      } catch (err) {
        console.warn("[scriptz] pre-recovery snapshot failed", err);
      }
      const updated = await api.updateScript({ id: props.scriptId, contentJson: EMPTY_DOC });
      const fresh = await api.getScript(props.scriptId);
      setScript(fresh);
      setLiveChars(updated.characters ?? []);
      setParseError(null);
      bumpVersions();
      pushToast(t("editor.toast.resetDone"), "ok");
    } catch (err) {
      pushToast(t("editor.toast.resetFailed", { message: errMessage(err) }), "error");
    } finally {
      setRecovering(false);
    }
  };

  /** After a snapshot restore: reload the content and remount the editor,
   *  otherwise it would keep (and later save) the pre-restore state. */
  const onRestored = async () => {
    try {
      const fresh = await api.getScript(props.scriptId);
      setScript(fresh);
      setLiveChars(fresh.characters);
    } catch (err) {
      console.warn("[scriptz] reload after restore failed", err);
    }
    setParseError(null);
    setEpoch((e) => e + 1);
    bumpVersions();
  };

  const createManualSnapshot = async () => {
    try {
      // The snapshot copies the stored content: write buffered typing first.
      await requireSuccessfulFlush();
      await api.createSnapshot(props.scriptId, "manual");
      pushToast(t("editor.toast.snapshotSaved"), "ok");
      bumpVersions();
    } catch (err) {
      pushToast(t("editor.toast.snapshotError", { message: errMessage(err) }), "error");
    }
  };

  // ---------- keyboard ----------
  // ⌘⇧S / ⌘⇧H belong to this screen. ⌘E, ⌘J and ⌘⇧\ are global shell
  // shortcuts; they are handled here only as a fallback when nobody else
  // did (the shell calls preventDefault), so a toggle never fires twice.
  onMount(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.defaultPrevented || !isModKey(ev) || ev.altKey) return;
      if (uiStore.anyDialogOpen() || snapshotsOpen()) return;
      const key = ev.key.toLowerCase();
      if (ev.shiftKey && key === "s") {
        ev.preventDefault();
        void createManualSnapshot();
      } else if (ev.shiftKey && key === "h") {
        ev.preventDefault();
        setSnapshotsOpen(true);
      } else if (!isPeek() && (ev.key === "|" || (ev.shiftKey && ev.key === "\\"))) {
        ev.preventDefault();
        toggleInspector();
      } else if (!ev.shiftKey && key === "j") {
        ev.preventDefault();
        uiStore.toggleTimeline();
      } else if (!ev.shiftKey && key === "e") {
        ev.preventDefault();
        uiStore.openExport(props.scriptId);
      }
    };
    // Narrow windows: the inspector is an overlay that may be hidden while
    // `inspectorOpen` is still true. Claim ⌘⇧\ before the shell so the
    // first press shows it instead of silently flipping the stored flag.
    const onKeyCapture = (ev: KeyboardEvent) => {
      if (isPeek() || !narrow() || ev.defaultPrevented || !isModKey(ev) || ev.altKey) return;
      if (!(ev.key === "|" || (ev.shiftKey && ev.key === "\\"))) return;
      if (uiStore.anyDialogOpen() || snapshotsOpen()) return;
      ev.preventDefault();
      toggleInspector();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keydown", onKeyCapture, true);
    onCleanup(() => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keydown", onKeyCapture, true);
    });
  });

  // ---------- typewriter focus ----------
  // Marks the caret's speech run on the rendered elements (attribute only,
  // never editor state) and scrolls the caret line to the screen's middle.
  let twMarked: HTMLElement[] = [];
  const clearTypewriter = () => {
    for (const el of twMarked) el.removeAttribute("data-tw-current");
    twMarked = [];
  };
  onCleanup(clearTypewriter);
  createEffect(() => {
    if (!typewriter()) {
      clearTypewriter();
      return;
    }
    const ed = editor();
    const caret = live.caret();
    // Arrow keys move the caret line without changing content.
    live.cursorTick();
    const blocks = live.blocks();
    if (!ed || !caret) return;
    clearTypewriter();
    for (const key of speechGroupKeys(blocks, caret.key)) {
      const el = ed.getElementByKey(key);
      if (!el) continue;
      el.setAttribute("data-tw-current", "");
      twMarked.push(el);
    }
    const canvas = canvasRef;
    if (!canvas) return;
    requestAnimationFrame(() => {
      const selection = window.getSelection();
      let rect = selection && selection.rangeCount > 0 ? selection.getRangeAt(0).getBoundingClientRect() : null;
      if (!rect || rect.height === 0) rect = ed.getElementByKey(caret.key)?.getBoundingClientRect() ?? null;
      if (!rect) return;
      const box = canvas.getBoundingClientRect();
      const delta = rect.top + rect.height / 2 - (box.top + box.height * 0.45);
      if (Math.abs(delta) > 6) canvas.scrollBy({ top: delta, behavior: prefersReducedMotion() ? "auto" : "smooth" });
    });
  });

  // ---------- timeline <-> paper ----------
  let linked: HTMLElement | null = null;
  const unlink = () => {
    if (!linked) return;
    linked.removeAttribute("data-tl-link");
    linked.style.removeProperty("--tl-link");
    linked = null;
  };
  onCleanup(unlink);
  const onTimelineHover = (seg: TimelineSegment | null) => {
    unlink();
    const ed = editor();
    if (!seg?.key || !ed) return;
    const el = ed.getElementByKey(seg.key);
    if (!el) return;
    el.setAttribute("data-tl-link", seg.kind);
    if (seg.speaker) el.style.setProperty("--tl-link", colorOf(seg.speaker));
    linked = el;
  };
  const onTimelineJump = (seg: TimelineSegment) => {
    const ed = editor();
    const key = seg.key;
    if (!ed || !key) return;
    ed.update(() => {
      const node = $getNodeByKey(key);
      if ($isElementNode(node)) node.selectStart();
    });
    ed.focus();
    requestAnimationFrame(() => {
      ed.getElementByKey(key)?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  };

  return (
    <div
      class="ss"
      classList={{
        "is-focus": focus(),
        "is-typewriter": typewriter(),
        "is-peek": isPeek(),
        "is-narrow": narrow(),
        "has-insp": inspectorVisible() || agentVisible(),
      }}
    >
      <div class="ss-main">
        <Show
          when={current()}
          fallback={<div class="ss-loading">{t("editor.loading")}</div>}
        >
          {(s) => (
            <>
              <Show when={!focus()}>
                <TopBar
                  scriptId={s().id}
                  title={s().title}
                  folder={folder()}
                  status={s().status}
                  focusTitleFor={focusTitleFor()}
                  onTitleAutoFocused={() => setFocusTitleFor(null)}
                  onRename={rename}
                  quickAvailable={quickAvailable()}
                  quickOn={quickMode()}
                  onToggleQuick={toggleQuick}
                  colorsOn={highlightingOn()}
                  onToggleColors={() => void toggleHighlight()}
                  inspectorVisible={inspectorVisible()}
                  onToggleInspector={toggleInspector}
                  agentAvailable={agentStore.available()}
                  agentOn={agentVisible()}
                  onToggleAgent={() => agentUi.toggleChat(props.scriptId)}
                  onExport={() => uiStore.openExport(s().id)}
                  peek={props.peek}
                />
              </Show>
              <Show when={focus()}>
                <div class="ss-focus-title">
                  <TitleInput
                    scriptId={s().id}
                    title={s().title}
                    focusFor={focusTitleFor()}
                    onAutoFocused={() => setFocusTitleFor(null)}
                    onCommit={rename}
                  />
                </div>
              </Show>
            </>
          )}
        </Show>

        <div class="paper-canvas ss-canvas" ref={canvasRef}>
          <Show when={current()}>
            {(s) => (
              <div class="paper-sheet ss-sheet" ref={setSheetEl}>
                <Show
                  when={!parseError()}
                  fallback={
                    <RecoveryPanel
                      broken={parseError() ?? ""}
                      resetting={recovering()}
                      onOpenSnapshots={() => setSnapshotsOpen(true)}
                      onReset={() => void resetToEmpty()}
                    />
                  }
                >
                  <Show when={`${s().id}#${epoch()}`} keyed>
                    {(_key) => {
                      const id = s().id;
                      return (
                        <Editor
                          scriptId={id}
                          initialContentJson={s().content_json}
                          initialCursor={scriptViewCache.get(id)?.cursor ?? null}
                          characters={s().characters}
                          highlighting={highlightingOn()}
                          quickModeEnabled={() => quickMode()}
                          onCharactersChange={setLiveChars}
                          onParseError={(raw) => setParseError(raw)}
                          onEditorReady={(ed) => {
                            setEditor(ed);
                            live.attach(ed);
                            setAttachedFor(id);
                          }}
                          onColorPickerReady={(open) => {
                            openColorPicker = open;
                          }}
                        />
                      );
                    }}
                  </Show>
                  <GutterLabel
                    editor={editor}
                    caret={live.caret}
                    focused={live.focused}
                    tick={live.tick}
                    sheet={sheetEl}
                  />
                  <HookMarks
                    editor={editor}
                    blocks={live.blocks}
                    segments={segments}
                    tick={live.tick}
                    sheet={sheetEl}
                    onCheck={agentReady() ? () => askJob("hook") : null}
                  />
                  <Show when={!isPeek() && agentStore.available()}>
                    <ClaimMarks
                      scriptId={s().id}
                      editor={editor}
                      sheet={sheetEl}
                      tick={live.tick}
                      active={agentVisible}
                    />
                  </Show>
                </Show>
              </div>
            )}
          </Show>
        </div>

        <Show when={current() && !focus() && !parseError()}>
          <Timeline
            segments={segments()}
            runtimeSec={stats().runtimeSec}
            range={range()}
            rangeSource={rangeSource()}
            playhead={playhead()}
            wpm={wpm()}
            open={uiStore.timelineOpen()}
            colorOf={colorOf}
            onToggle={() => uiStore.toggleTimeline()}
            onHover={onTimelineHover}
            onJump={onTimelineJump}
            onJob={agentReady() ? (job) => askJob(job) : null}
          />
        </Show>

        <Show when={current() && focus()}>
          <FocusPill runtimeSec={stats().runtimeSec} range={range()} sessionWords={sessionWords()} />
        </Show>
      </div>

      <Show when={current() && inspectorVisible()}>
        <div class="ss-insp-wrap" ref={inspRef}>
          <Inspector
            scriptId={(current() as Script).id}
            status={(current() as Script).status}
            statusSince={(current() as Script).status_changed_at ?? (current() as Script).created_at}
            stats={stats()}
            range={range()}
            characters={liveChars()}
            versionsKey={versionsKey()}
            onOpenColorPicker={(name, anchor) => openColorPicker?.(name, anchor)}
            onOpenVersions={() => setSnapshotsOpen(true)}
          />
        </div>
      </Show>

      <Show when={current() && agentVisible()}>
        <div class="ss-agent-wrap">
          <ChatPanel
            scriptId={props.scriptId}
            colorOf={colorOf}
            onClose={() => agentUi.setChatOpen(props.scriptId, false)}
            range={range()}
            wpm={wpm()}
            tick={live.tick}
          />
        </div>
      </Show>

      <Show when={current() && !isPeek() && agentStore.available()}>
        <AgentContextMenu scriptId={props.scriptId} canvas={() => canvasRef} />
      </Show>

      {/* Own Suspense boundary: the dialog's resources must not suspend
          the shell's boundary around this screen (that would detach the
          editor while the version list loads). */}
      <Suspense>
        <Show when={current()}>
          {(s) => (
            <SnapshotsDialog
              open={snapshotsOpen()}
              onClose={() => {
                setSnapshotsOpen(false);
                bumpVersions();
              }}
              onRestore={() => void onRestored()}
              scriptId={s().id}
              scriptTitle={s().title}
              characters={liveChars()}
              highlighting={highlightingOn()}
            />
          )}
        </Show>
      </Suspense>

      <StageUndoToast />
    </div>
  );
}
