import { Show } from "solid-js";
import { formatClock, formatRange, lengthStatus, type LengthRange } from "../../lib/lengthGoal";
import { K } from "../../lib/keys";
import { getCurrentLocale, t, tPlural } from "../../i18n";

export interface FocusPillProps {
  runtimeSec: number;
  range: LengthRange | null;
  /** Words written since the script was opened (never negative). */
  sessionWords: number;
}

/** Bottom pill in focus mode: "Länge 1:15 / 0:45-1:05 · Diese Sitzung
 *  +214 Wörter · ⌘⇧F beenden". */
export function FocusPill(props: FocusPillProps) {
  const over = () => lengthStatus(props.runtimeSec, props.range).state === "over";
  const rangeText = () => formatRange(props.range);
  return (
    <div class="ss-focus-pill" role="status">
      <span>
        {t("script.focus.length")} <b classList={{ over: over() }}>{formatClock(props.runtimeSec)}</b>
        <Show when={rangeText()}> / {rangeText()}</Show>
      </span>
      <span class="div" aria-hidden="true" />
      <span>
        {t("script.focus.session")} <b>+{props.sessionWords.toLocaleString(getCurrentLocale())}</b>{" "}
        {tPlural("units.word", props.sessionWords)}
      </span>
      <span class="div" aria-hidden="true" />
      <span>
        <kbd>{K("Mod+Shift+F")}</kbd> {t("script.focus.exit")}
      </span>
    </div>
  );
}

export default FocusPill;
