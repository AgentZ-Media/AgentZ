import { createSignal, onMount } from "solid-js";
import { getPlatformAdapter } from "../../../lib/platform";
import { t } from "../../../i18n";
import { AppMark } from "../../Common/AppMark";
import { Row, SectionHead } from "./parts";

const REPO_URL = "https://github.com/AgentZ-Media/ScriptZ";
const DEVELOPER_URL = "https://linktr.ee/deragentz";

export function SettingsAbout(props: { onClose(): void; onShowOnboarding(): void }) {
  const [version, setVersion] = createSignal<string | null>(null);
  onMount(async () => {
    try {
      setVersion(await getPlatformAdapter().getVersion());
    } catch {
      /* dev mode without a host version */
    }
  });
  const open = (url: string) => void getPlatformAdapter().openUrl(url).catch(() => {});

  return (
    <>
      <SectionHead title={t("prefs.about.title")} sub={t("settings.about.sub")} onClose={props.onClose} />
      <div class="set-brand">
        <AppMark size={48} />
        <div>
          <b>ScriptZ</b>
          <small>
            {version() ? t("prefs.about.version", { version: version()! }) : ""}
            {version() ? " · " : ""}
            {t("settings.about.license")}
          </small>
        </div>
      </div>
      <Row label={t("settings.about.developer")}>
        <button type="button" class="btn ghost" onClick={() => open(DEVELOPER_URL)}>
          {t("settings.about.developer.linkText")}
        </button>
      </Row>
      <Row label={t("settings.about.repository")}>
        <button type="button" class="btn ghost set-mono" onClick={() => open(REPO_URL)}>
          {t("settings.about.repository.linkText")}
        </button>
      </Row>
      <Row label={t("prefs.about.onboarding.label")} help={t("settings.about.onboarding.help")}>
        <button type="button" class="btn" onClick={() => props.onShowOnboarding()}>
          {t("settings.about.onboarding.button")}
        </button>
      </Row>
    </>
  );
}
