import { K } from "@agentz/kit/platform";
import { t } from "../../../i18n";

const keyHint = (k: string, text: string) => (
  <>
    <kbd>{k}</kbd> {text}
  </>
);

/** Keyboard legend below the ideas list (hidden in the selection mode). */
export function IdeasKeyHints(props: { hidden: boolean }) {
  return (
    <div class="i-keys" classList={{ "is-hidden": props.hidden }}>
      {keyHint("↑ ↓", t("ideasPage.keys.select"))} ·{" "}
      {keyHint("⏎", t("ideasPage.keys.open"))} ·{" "}
      {keyHint("esc", t("ideasPage.keys.close"))} ·{" "}
      {keyHint(K("Mod+Enter"), t("ideasPage.keys.convert"))} ·{" "}
      {keyHint("⌫", t("ideasPage.keys.delete"))} ·{" "}
      <kbd>{K("Shift")}</kbd>
      {t("ideasPage.keys.multi")}
    </div>
  );
}
