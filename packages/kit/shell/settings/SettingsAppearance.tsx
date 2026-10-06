import { For, type JSX } from "solid-js";
import { baseSettingsStore, type Theme } from "../../stores";
import { t, type LanguagePref } from "../../i18n";
import { Row, SectionHead } from "../../ui";

export function SettingsAppearance(props: { onClose(): void; appName: string; extension?: JSX.Element }) {
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
      <SectionHead title={t("prefs.appearance.title")} sub={t("prefs.appearance.description", { appName: props.appName })} onClose={props.onClose} />
      <Row label={t("prefs.theme.label")} help={t("prefs.theme.help")}>
        <div class="seg" role="radiogroup" aria-label={t("prefs.theme.label")}>
          <For each={themes()}>
            {(th) => (
              <button
                type="button"
                role="radio"
                aria-checked={baseSettingsStore.theme() === th.id}
                onClick={() => void baseSettingsStore.setTheme(th.id)}
              >
                {th.label}
              </button>
            )}
          </For>
        </div>
      </Row>
      {props.extension}
      <Row label={t("lang.label")} help={t("lang.help")}>
        <div class="seg" role="radiogroup" aria-label={t("lang.label")}>
          <For each={languages()}>
            {(l) => (
              <button
                type="button"
                role="radio"
                aria-checked={baseSettingsStore.language() === l.id}
                onClick={() => void baseSettingsStore.setLanguage(l.id)}
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
