import { For, Show, createResource, createSignal, onCleanup } from "solid-js";
import { Modal } from "../Common/Modal";
import { confirmDialog } from "../Common/ConfirmDialog";
import { api } from "../../lib/api";
import { scriptsBus } from "../../lib/scriptsBus";
import { flushAll } from "../../lib/saveFlush";
import { formatAbsolute } from "../../lib/format";
import type { ScriptCharacter, Snapshot, SnapshotMeta } from "../../lib/types";
import { pushToast } from "../../stores/toasts";
import { t } from "../../i18n";
import { Editor } from "./Editor";
import "./PaperLayout.css";
import "./SnapshotsDialog.css";

export interface SnapshotsDialogProps {
  scriptId: string;
  scriptTitle?: string;
  open: boolean;
  onClose(): void;
  onRestore?(snapshotId: string): void;
  /** Current character colours of the script, so the preview tints the
   *  cast exactly like the live editor does. */
  characters?: ScriptCharacter[];
  /** Whether character highlighting is on for this script. */
  highlighting?: boolean;
}

export function SnapshotsDialog(props: SnapshotsDialogProps) {
  const [reloadKey, setReloadKey] = createSignal(0);
  const [selectedId, setSelectedId] = createSignal<string | null>(null);

  const [snapshots] = createResource(
    () =>
      props.open ? { scriptId: props.scriptId, reload: reloadKey() } : null,
    async (q) => {
      if (!q) return [] as SnapshotMeta[];
      const list = await api.listSnapshots(q.scriptId);
      return [...list].sort((a, b) => b.created_at - a.created_at);
    },
  );

  const ensureSelection = () => {
    const list = snapshots.latest;
    if (!list || list.length === 0) {
      if (selectedId() !== null) setSelectedId(null);
      return;
    }
    const cur = selectedId();
    if (!cur || !list.find((s) => s.id === cur)) setSelectedId(list[0].id);
  };

  const [selectedSnap] = createResource(
    () => {
      ensureSelection();
      const id = selectedId();
      return id ? id : null;
    },
    async (id) => {
      try {
        return (await api.getSnapshot(id)) as Snapshot;
      } catch {
        return null;
      }
    },
  );

  // Snapshot ids whose content Lexical could not parse - shown as a note
  // instead of a sheet.
  const [broken, setBroken] = createSignal<ReadonlySet<string>>(new Set());
  const markBroken = (id: string) => setBroken((prev) => new Set(prev).add(id));

  const onCreateManual = async () => {
    try {
      // The snapshot copies the stored content: write buffered typing first.
      await flushAll();
      await api.createSnapshot(props.scriptId, "manual");
      pushToast(t("snapshots.toast.created"), "ok");
      setReloadKey(reloadKey() + 1);
    } catch (e) {
      pushToast(t("snapshots.toast.createFailed", { message: String(e) }), "error");
    }
  };

  const onDelete = async () => {
    const id = selectedId();
    if (!id) return;
    const ok = await confirmDialog({
      title: t("snapshots.confirm.delete.title"),
      body: t("snapshots.confirm.delete.body"),
      confirmLabel: t("common.delete"),
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteSnapshot(id);
      pushToast(t("snapshots.toast.deleted"), "ok");
      setSelectedId(null);
      setReloadKey(reloadKey() + 1);
    } catch (e) {
      pushToast(t("snapshots.toast.deleteFailed", { message: String(e) }), "error");
    }
  };

  const onRestore = async () => {
    const id = selectedId();
    if (!id) return;
    const ok = await confirmDialog({
      title: t("snapshots.confirm.restore.title"),
      body: t("snapshots.confirm.restore.body"),
      confirmLabel: t("snapshots.restore"),
    });
    if (!ok) return;
    try {
      // Write any buffered keystrokes first: the editor is remounted with
      // the restored content afterwards, and a save still pending in the
      // old instance would otherwise overwrite the restore on teardown.
      await flushAll();
      await api.restoreSnapshot(id);
      scriptsBus.bump();
      pushToast(t("snapshots.toast.restored"), "ok");
      props.onRestore?.(id);
      setReloadKey(reloadKey() + 1);
      props.onClose();
    } catch (e) {
      pushToast(t("snapshots.toast.restoreFailed", { message: String(e) }), "error");
    }
  };

  const title = () =>
    props.scriptTitle
      ? t("snapshots.titleWithScript", { title: props.scriptTitle })
      : t("snapshots.title");

  return (
    <Modal
      open={props.open}
      onClose={props.onClose}
      title={title()}
      // Wide enough for the list plus a full-size A4 sheet.
      maxWidth={1180}
      footer={
        <>
          <button class="btn btn-danger" onClick={onDelete} disabled={!selectedId()}>
            {t("snapshots.delete")}
          </button>
          <span class="snap-spacer" />
          <button class="btn" onClick={props.onClose}>
            {t("common.close")}
          </button>
          <button class="btn btn-primary" onClick={onRestore} disabled={!selectedId()}>
            {t("snapshots.restore")}
          </button>
        </>
      }
    >
      <div class="snap-toolbar">
        <button class="btn" onClick={onCreateManual}>
          {t("snapshots.createManual")}
        </button>
      </div>
      <div class="snap-grid">
        <div
          class="snap-list"
          tabIndex={0}
          onKeyDown={(e) => {
            const list = snapshots.latest ?? [];
            if (list.length === 0) return;
            const idx = list.findIndex((s) => s.id === selectedId());
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setSelectedId(list[Math.min(list.length - 1, idx + 1)].id);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setSelectedId(list[Math.max(0, idx - 1)].id);
            } else if (e.key === "Home") {
              e.preventDefault();
              setSelectedId(list[0].id);
            } else if (e.key === "End") {
              e.preventDefault();
              setSelectedId(list[list.length - 1].id);
            } else if (e.key === "Enter") {
              e.preventDefault();
              void onRestore();
            }
          }}
        >
          <Show
            when={(snapshots.latest?.length ?? 0) > 0}
            fallback={<div class="snap-empty">{t("snapshots.empty")}</div>}
          >
            <For each={snapshots.latest}>
              {(snap) => (
                <button
                  class={`snap-item${snap.id === selectedId() ? " is-active" : ""}`}
                  onClick={() => setSelectedId(snap.id)}
                  tabIndex={-1}
                >
                  <span class="snap-time">{formatAbsolute(snap.created_at)}</span>
                  <span class={`snap-badge snap-badge-${snap.trigger}`}>
                    {snap.trigger === "manual" ? t("snapshots.badge.manual") : t("snapshots.badge.auto")}
                  </span>
                </button>
              )}
            </For>
          </Show>
        </div>
        <div class="snap-preview">
          <Show
            when={selectedSnap.latest}
            fallback={<div class="snap-empty">{t("snapshots.noneSelected")}</div>}
          >
            {(snap) => (
              <Show
                when={!broken().has(snap().id)}
                fallback={<div class="snap-empty">{t("snapshots.previewBroken")}</div>}
              >
                <SnapshotPaper
                  snapshot={snap()}
                  characters={props.characters ?? []}
                  highlighting={!!props.highlighting}
                  onParseError={() => markBroken(snap().id)}
                />
              </Show>
            )}
          </Show>
        </div>
      </div>
    </Modal>
  );
}

interface SnapshotPaperProps {
  snapshot: Snapshot;
  characters: ScriptCharacter[];
  highlighting: boolean;
  onParseError(): void;
}

/**
 * Read-only rendering of a snapshot: the very same `Editor` (Lexical nodes,
 * Editor.css, highlight pass, legacy-block normalisation) on the very same
 * paper sheet as the script screen, just with `readOnly` set. If the dialog
 * is narrower than an A4 sheet, the sheet is zoomed down as a whole so line
 * breaks stay identical to the editor instead of re-wrapping.
 */
function SnapshotPaper(props: SnapshotPaperProps) {
  let canvasRef: HTMLDivElement | undefined;
  let sheetRef: HTMLDivElement | undefined;
  const [zoom, setZoom] = createSignal(1);

  const fit = () => {
    if (!canvasRef || !sheetRef) return;
    const cs = getComputedStyle(canvasRef);
    const avail =
      canvasRef.clientWidth - parseFloat(cs.paddingLeft || "0") - parseFloat(cs.paddingRight || "0");
    // The visual width divided by the current zoom is the natural A4 width,
    // independent of how the engine reports layout sizes of zoomed boxes.
    const sheetW = sheetRef.getBoundingClientRect().width / zoom();
    if (avail <= 0 || sheetW <= 0) return;
    setZoom(Math.min(1, avail / sheetW));
  };

  const attachCanvas = (el: HTMLDivElement) => {
    canvasRef = el;
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    onCleanup(() => ro.disconnect());
  };

  return (
    <div class="paper-canvas snap-canvas" ref={attachCanvas}>
      <div class="paper-sheet snap-sheet" ref={sheetRef} style={{ zoom: zoom() }}>
        {/* Keyed: every snapshot gets a fresh editor instance. */}
        <Show when={props.snapshot} keyed>
          {(snap) => (
            <Editor
              scriptId={snap.script_id}
              initialContentJson={snap.content_json}
              characters={props.characters}
              highlighting={props.highlighting}
              readOnly
              onParseError={props.onParseError}
            />
          )}
        </Show>
      </div>
    </div>
  );
}
