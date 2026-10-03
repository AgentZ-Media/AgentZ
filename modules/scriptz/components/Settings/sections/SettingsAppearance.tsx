import { For } from "solid-js";
import { settingsStore, type Theme } from "../../../stores/settings";
import { type LanguagePref } from "@agentz/kit/i18n";
import { t } from "../../../i18n";
import { Row, SectionHead, Switch } from "@agentz/kit/ui";


export function SettingsAppearance(props: { onClose(): void }) {
  const themes = (): Array<{ id: Theme; label: string }> => [
    { id: "light", label: t("theme.light") },
    { id: "dark", label: t("theme.dark") },
    { id: "auto", label: t("theme.auto") },
  ];
  const languages = (): Array<{ id: LanguagePref; label: string }> => [
    { id: "de", label: t("lang.de") },
    { id: "en", label: t("lang.en") },
    { id: "auto", label: t("lang.auto") },
  ];
  return (
    <>
      <SectionHead title={t("prefs.appearance.title")} sub={t("prefs.appearance.sub")} onClose={props.onClose} />
      <Row label={t("prefs.theme.label")} help={t("prefs.theme.help")}>
        <div class="seg" role="radiogroup" aria-label={t("prefs.theme.label")}>
          <For each={themes()}>
            {(th) => (
              <button
                type="button"
                role="radio"
                aria-checked={settingsStore.theme() === th.id}
                onClick={() => void settingsStore.setTheme(th.id)}
              >
                {th.label}
              </button>
            )}
          </For>
        </div>
      </Row>
      <Row
        label={t("prefs.darkPaper.label")}
        help={
          settingsStore.resolvedTheme() === "dark" ? t("prefs.darkPaper.help") : t("prefs.darkPaper.helpLight")
        }
      >
        <Switch
          checked={settingsStore.darkPaper()}
          onChange={(v) => void settingsStore.setDarkPaper(v)}
          disabled={settingsStore.resolvedTheme() !== "dark"}
          label={t("prefs.darkPaper.label")}
        />
      </Row>
      <Row label={t("lang.label")} help={t("lang.help")}>
        <div class="seg" role="radiogroup" aria-label={t("lang.label")}>
          <For each={languages()}>
            {(l) => (
              <button
                type="button"
                role="radio"
                aria-checked={settingsStore.language() === l.id}
                onClick={() => void settingsStore.setLanguage(l.id)}
              >
                {l.label}
              </button>
            )}
          </For>
        </div>
      </Row>
    </>
  );
}
