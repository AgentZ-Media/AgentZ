import { settingsStore } from "../../../stores/settings";
import { K } from "@agentz/kit/platform";
import { t } from "../../../i18n";
import { Row, SectionHead, Switch } from "@agentz/kit/ui";

/** How scripts open from lists and when they leave the "Open" list. */
export function SettingsLibrary(props: { onClose(): void }) {
  return (
    <>
      <SectionHead title={t("prefs.library.title")} sub={t("prefs.library.sub")} onClose={props.onClose} />
      <Row label={t("prefs.openInPanel.label")} help={t("prefs.openInPanel.help", { key: K("Alt") })}>
        <Switch
          checked={settingsStore.openInPanel()}
          onChange={(v) => void settingsStore.setOpenInPanel(v)}
          label={t("prefs.openInPanel.label")}
        />
      </Row>
      <Row label={t("prefs.closeFinished.label")} help={t("prefs.closeFinished.help")}>
        <Switch
          checked={settingsStore.closeFinishedScripts()}
          onChange={(v) => void settingsStore.setCloseFinishedScripts(v)}
          label={t("prefs.closeFinished.label")}
        />
      </Row>
    </>
  );
}
