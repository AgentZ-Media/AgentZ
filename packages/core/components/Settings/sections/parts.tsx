import { JSX, Show, createEffect, createSignal, onCleanup } from "solid-js";
import { t } from "../../../i18n";
import { registerFlusher } from "../../../lib/saveFlush";
import { createSerialSaver } from "../../../lib/serialSave";
import { boundText, parseRangeInput } from "../rangeInput";

// Building blocks shared by the settings sections: section head, the
// `.srow` row (label + one-sentence help + control), the switch and the
// "von / bis" range field.

export function SectionHead(props: { title: string; sub: string; onClose(): void }) {
  return (
    <div class="dlg-h set-head">
      <div>
        <b>{props.title}</b>
        <small>{props.sub}</small>
      </div>
      <button type="button" class="dlg-esc" onClick={() => props.onClose()} aria-label={t("common.close")}>
        <kbd>esc</kbd>
      </button>
    </div>
  );
}

export function Row(props: { label: string; help?: JSX.Element; children?: JSX.Element; class?: string }) {
  return (
    <div class={`srow${props.class ? ` ${props.class}` : ""}`}>
      <div>
        <b>{props.label}</b>
        <Show when={props.help}>
          <small>{props.help}</small>
        </Show>
      </div>
      <Show when={props.children}>
        <div class="srow-ctl">{props.children}</div>
      </Show>
    </div>
  );
}

export function Switch(props: { checked: boolean; onChange(v: boolean): void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      class="sw-t"
      role="switch"
      aria-checked={props.checked}
      aria-label={props.label}
      disabled={props.disabled}
      onClick={() => !props.disabled && props.onChange(!props.checked)}
    />
  );
}

export interface RangeFieldsProps {
  minSec: number | null;
  maxSec: number | null;
  /** Placeholders shown while a field is empty (e.g. the inherited default). */
  minPlaceholder?: string;
  maxPlaceholder?: string;
  /** Persists a validated pair; may throw (error is shown inline). */
  onCommit(minSec: number | null, maxSec: number | null): Promise<void> | void;
  label: string;
}

/** Two `m:ss` fields ("von" / "bis"). Commits on blur or Enter once both
 *  parse and min < max; otherwise shows the reason under the fields and
 *  keeps the typed text so it can be fixed. Empty = bound unset.
 *
 *  Commits are serialized (lib/serialSave.ts) and diffed against the last
 *  acknowledged pair, and after a commit a field is only rewritten to its
 *  canonical `m:ss` form if it still holds the text that commit used - so
 *  tabbing from "von" to "bis" and typing while the first save runs never
 *  loses the new input. Pending valid input is also committed on unmount
 *  (closing the dialog) and on window close. */
export function RangeFields(props: RangeFieldsProps) {
  const [minText, setMinText] = createSignal(boundText(props.minSec));
  const [maxText, setMaxText] = createSignal(boundText(props.maxSec));
  const [error, setError] = createSignal<string | null>(null);
  const [errField, setErrField] = createSignal<"min" | "max" | null>(null);
  let focused = false;
  let disposed = false;

  const saver = createSerialSaver<{ min: string; max: string }, { minSec: number | null; maxSec: number | null }>({
    initial: { minSec: props.minSec, maxSec: props.maxSec },
    read: () => ({ min: minText(), max: maxText() }),
    async write(d, base) {
      const res = parseRangeInput(d.min, d.max);
      if (!res.ok) {
        if (!disposed) {
          setErrField(res.field);
          setError(res.reason === "format" ? t("prefs.range.errorFormat") : t("prefs.range.errorOrder"));
        }
        return base;
      }
      setError(null);
      setErrField(null);
      const next = { minSec: res.minSec, maxSec: res.maxSec };
      if (next.minSec !== base.minSec || next.maxSec !== base.maxSec) {
        await props.onCommit(next.minSec, next.maxSec);
      }
      // Canonicalize only fields the user hasn't touched since.
      if (minText() === d.min) setMinText(boundText(next.minSec));
      if (maxText() === d.max) setMaxText(boundText(next.maxSec));
      return next;
    },
    onError: (err) => {
      if (!disposed) setError((err as Error)?.message ?? String(err));
    },
  });

  // Follow external changes (e.g. reload) while the user isn't typing and
  // none of our own commits is pending.
  createEffect(() => {
    const min = props.minSec;
    const max = props.maxSec;
    if (focused || !saver.idle()) return;
    saver.resetBaseline({ minSec: min, maxSec: max });
    setMinText(boundText(min));
    setMaxText(boundText(max));
  });

  const commit = () => saver.flush();
  const unregister = registerFlusher(commit);
  onCleanup(() => {
    disposed = true;
    void commit().finally(unregister);
  });

  const field = (which: "min" | "max") => (
    <label class="num-f" classList={{ "is-err": errField() === which }}>
      <input
        inputMode="numeric"
        value={which === "min" ? minText() : maxText()}
        placeholder={which === "min" ? props.minPlaceholder ?? "" : props.maxPlaceholder ?? ""}
        aria-label={`${props.label} ${which === "min" ? t("prefs.range.from") : t("prefs.range.to")}`}
        aria-invalid={errField() === which}
        spellcheck={false}
        onFocus={() => (focused = true)}
        onInput={(e) => {
          if (which === "min") setMinText(e.currentTarget.value);
          else setMaxText(e.currentTarget.value);
          saver.markDirty();
          if (error()) {
            setError(null);
            setErrField(null);
          }
        }}
        onBlur={() => {
          focused = false;
          void commit();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void commit();
          }
        }}
      />
    </label>
  );

  return (
    <div class="rng-wrap">
      <span class="rng-f">
        {field("min")}
        <span class="rng-lbl">{t("prefs.range.to")}</span>
        {field("max")}
      </span>
      <Show when={error()}>
        <span class="rng-err" role="alert">
          {error()}
        </span>
      </Show>
    </div>
  );
}
