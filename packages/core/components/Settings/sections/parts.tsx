import { JSX, Show, createEffect, createSignal } from "solid-js";
import { t } from "../../../i18n";
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
 *  keeps the typed text so it can be fixed. Empty = bound unset. */
export function RangeFields(props: RangeFieldsProps) {
  const [minText, setMinText] = createSignal(boundText(props.minSec));
  const [maxText, setMaxText] = createSignal(boundText(props.maxSec));
  const [error, setError] = createSignal<string | null>(null);
  const [errField, setErrField] = createSignal<"min" | "max" | null>(null);
  let focused = false;

  // Follow external changes (e.g. reload) while the user isn't typing.
  createEffect(() => {
    const min = props.minSec;
    const max = props.maxSec;
    if (focused) return;
    setMinText(boundText(min));
    setMaxText(boundText(max));
  });

  async function commit() {
    const res = parseRangeInput(minText(), maxText());
    if (!res.ok) {
      setErrField(res.field);
      setError(res.reason === "format" ? t("prefs.range.errorFormat") : t("prefs.range.errorOrder"));
      return;
    }
    setError(null);
    setErrField(null);
    if (res.minSec === props.minSec && res.maxSec === props.maxSec) {
      setMinText(boundText(res.minSec));
      setMaxText(boundText(res.maxSec));
      return;
    }
    try {
      await props.onCommit(res.minSec, res.maxSec);
      setMinText(boundText(res.minSec));
      setMaxText(boundText(res.maxSec));
    } catch (err) {
      setError((err as Error)?.message ?? String(err));
    }
  }

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
