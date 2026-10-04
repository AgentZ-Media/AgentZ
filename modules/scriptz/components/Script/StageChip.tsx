import { uiStore } from "../../stores/ui";
import { For, Show, createSignal, onCleanup, createEffect } from "solid-js";
import { Icon } from "@agentz/kit/ui";
import { StageGlyph } from "../Common/StageGlyph";
import { scriptStages, stageIndex } from "../../lib/stages";
import type { ScriptStatus } from "../../lib/types";
import { K } from "@agentz/kit/platform";
import { t } from "../../i18n";
import { setStageWithUndo, stageLabel } from "./stageActions";
import { dismissOnDialog, focusWithin } from "@agentz/kit/ui";

export interface StageChipProps {
  scriptId: string;
  status: ScriptStatus;
}

/**
 * Stage chip in the script top bar. Opens a menu with the configured
 * stages; digits 1-9 pick directly, arrows + Enter work too. The footer reminds of
 * ⌘⌥→ (handled by the shell via `stepStage`).
 */
export function StageChip(props: StageChipProps) {
  const [open, setOpen] = createSignal(false);
  const [active, setActive] = createSignal(0);
  let wrapRef: HTMLDivElement | undefined;
  let chipRef: HTMLButtonElement | undefined;
  let menuRef: HTMLDivElement | undefined;

  // Where the keyboard was before the menu took focus (usually the editor).
  let returnFocus: HTMLElement | null = null;
  /** "back": where the keyboard was before; "chip": the chip itself;
   *  "none": leave focus alone (a dialog took over). */
  const close = (refocus: "back" | "chip" | "none" = "back") => {
    setOpen(false);
    const target = refocus === "chip" ? chipRef : refocus === "back" ? returnFocus : null;
    returnFocus = null;
    if (target && target.isConnected) target.focus();
  };

  // A dialog opening on top (⌘I, ⌘K, a confirm ...) closes the menu, so
  // its key handler can never act on keys typed into the dialog.
  dismissOnDialog({
    dialogOpen: uiStore.anyDialogOpen,
    open,
    inside: (node) => !!wrapRef?.contains(node),
    dismiss: () => close("none"),
  });

  const pick = (status: ScriptStatus) => {
    close();
    void setStageWithUndo(props.scriptId, status);
  };

  const toggle = () => {
    if (open()) {
      close();
      return;
    }
    setActive(stageIndex(props.status));
    const active = document.activeElement;
    returnFocus = active instanceof HTMLElement && active !== document.body ? active : null;
    setOpen(true);
    queueMicrotask(() => menuRef?.focus());
  };

  createEffect(() => {
    if (!open()) return;
    const onDown = (ev: MouseEvent) => {
      if (wrapRef && ev.target instanceof Node && wrapRef.contains(ev.target)) return;
      close();
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
      // Only while the keyboard is in the menu (it takes focus on open).
      if (!focusWithin(wrapRef)) return;
      const stages = scriptStages();
      const n = stages.length;
      const digit = /^[1-9]$/.test(ev.key) ? Number(ev.key) : 0;
      if (digit >= 1 && digit <= n) {
        ev.preventDefault();
        ev.stopPropagation();
        pick(stages[digit - 1].id);
      } else if (ev.key === "ArrowDown") {
        ev.preventDefault();
        ev.stopPropagation();
        setActive((i) => (i + 1) % n);
      } else if (ev.key === "ArrowUp") {
        ev.preventDefault();
        ev.stopPropagation();
        setActive((i) => (i - 1 + n) % n);
      } else if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        ev.stopPropagation();
        const target = stages[active()];
        if (target) pick(target.id);
      } else if (ev.key === "Escape" || ev.key === "Tab") {
        ev.preventDefault();
        ev.stopPropagation();
        close("chip");
      }
    };
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    onCleanup(() => {
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
    });
  });

  const footParts = () => t("script.stage.menuFoot").split("{hotkey}");

  return (
    <div class="ss-stage" ref={wrapRef}>
      <button
        ref={chipRef}
        type="button"
        class="chip"
        classList={{ "is-open": open() }}
        aria-haspopup="menu"
        aria-expanded={open()}
        title={t("script.stage.chipTitle")}
        onMouseDown={(e) => e.preventDefault()}
        onClick={toggle}
      >
        <StageGlyph stage={props.status} />
        {stageLabel(props.status)}
        <Icon name="down" size={12} />
      </button>
      <Show when={open()}>
        <div
          ref={menuRef}
          class="menu ss-stage-menu"
          role="menu"
          tabIndex={-1}
          aria-label={t("script.stage.menuAria")}
        >
          <For each={scriptStages().map((st) => st.id)}>
            {(status, i) => (
              <button
                type="button"
                class="menu-it"
                role="menuitemradio"
                aria-checked={status === props.status}
                classList={{ on: i() === active() }}
                onMouseEnter={() => setActive(i())}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(status)}
              >
                <StageGlyph stage={status} />
                <span class="lbl">{stageLabel(status)}</span>
                <Show when={status === props.status} fallback={i() < 9 ? <kbd>{i() + 1}</kbd> : null}>
                  <Icon name="check" size={14} class="ck" />
                </Show>
              </button>
            )}
          </For>
          <div class="menu-sep" />
          <div class="menu-foot">
            {footParts()[0]}
            <kbd>{K("Mod+Alt+ArrowRight")}</kbd>
            {footParts()[1] ?? ""}
          </div>
        </div>
      </Show>
    </div>
  );
}

export default StageChip;
