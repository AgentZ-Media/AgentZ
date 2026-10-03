import { createModuleI18n } from "@agentz/kit/i18n";
import type { AppModule } from "@agentz/kit/shell";
import { pushToast } from "@agentz/kit/stores";
import { confirmDialog } from "@agentz/kit/ui";
import { catalogs } from "./i18n";

const { t } = createModuleI18n(catalogs);

export const appModule: AppModule = {
  id: "sandbox",
  name: "Sandbox",
  logo: "sandbox",
  i18n: catalogs,
  about: {
    description: () => t("home.description"),
    license: () => "MIT",
    releasesUrl: "https://github.com/AgentZ-Media/AgentZ/releases/tag/sandbox-latest",
    links: [],
  },
  async setup(context) {
    return {
      sidebar: () => <button class="sandbox-nav" onClick={() => context.shell.closeSettings()}>{t("home.nav")}</button>,
      routes: [{ id: "home", matches: () => true, component: () => <section class="sandbox-home">
        <h1>{t("home.title")}</h1>
        <p>{t("home.description")}</p>
        <div class="sandbox-actions">
          <button class="btn" onClick={() => pushToast(t("home.notice"), "ok")}>{t("home.toast")}</button>
          <button class="btn" onClick={async () => {
            if (await confirmDialog({ title: t("home.question") })) pushToast(t("home.confirmed"), "ok");
          }}>{t("home.confirm")}</button>
        </div>
      </section> }],
    };
  },
};
