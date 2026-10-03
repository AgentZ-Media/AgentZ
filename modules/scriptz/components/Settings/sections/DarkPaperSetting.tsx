import { baseSettingsStore } from "@agentz/kit/stores";
import { Row, Switch } from "@agentz/kit/ui";
import { settingsStore } from "../../../stores/settings";
import { t } from "../../../i18n";

export function DarkPaperSetting() {
  return (
      <Row
        label={t("prefs.darkPaper.label")}
        help={
          baseSettingsStore.resolvedTheme() === "dark" ? t("prefs.darkPaper.help") : t("prefs.darkPaper.helpLight")
        }
      >
        <Switch
          checked={settingsStore.darkPaper()}
          onChange={(v) => void settingsStore.setDarkPaper(v)}
          disabled={baseSettingsStore.resolvedTheme() !== "dark"}
          label={t("prefs.darkPaper.label")}
        />
      </Row>
  );
}
