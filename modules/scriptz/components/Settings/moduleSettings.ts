import type { AboutInfo, ModuleSettings } from "@agentz/kit/shell";
import { t } from "../../i18n";
import { SettingsWriting } from "./sections/SettingsWriting";
import { SettingsLibrary } from "./sections/SettingsLibrary";
import { SettingsFolders } from "./sections/SettingsFolders";
import { SettingsCharacters } from "./sections/SettingsCharacters";
import { SettingsStages } from "./sections/SettingsStages";
import { DarkPaperSetting } from "./sections/DarkPaperSetting";
import { AgentSettings } from "../Agent/AgentSettings";
import "./SettingsDialog.css";

const REPO_URL = "https://github.com/AgentZ-Media/AgentZ";
export const scriptzAbout: AboutInfo = {
  description: () => t("settings.about.sub"),
  license: () => t("settings.about.license"),
  releasesUrl: `${REPO_URL}/releases/latest`,
  nightlyReleasesUrl: `${REPO_URL}/releases/tag/scriptz-nightly`,
  links: [
    { id: "developer", label: () => t("settings.about.developer"), text: () => t("settings.about.developer.linkText"), url: "https://linktr.ee/deragentz" },
    { id: "repository", label: () => t("settings.about.repository"), text: () => t("settings.about.repository.linkText"), url: REPO_URL },
  ],
  onboardingHelp: () => t("settings.about.onboarding.help"),
};

export const scriptzModuleSettings: ModuleSettings = {
  sections: [
    { id: "writing", icon: "pen", label: () => t("prefs.writing.title"), component: SettingsWriting },
    { id: "library", icon: "stack", label: () => t("prefs.library.title"), component: SettingsLibrary },
    { id: "stages", icon: "check", label: () => t("prefs.stages.title"), component: SettingsStages },
    { id: "folders", icon: "folder", label: () => t("prefs.folders.title"), component: SettingsFolders },
    { id: "characters", icon: "users", label: () => t("prefs.characters.title"), component: SettingsCharacters },
    { id: "agent", icon: "spark", label: () => t("agent.prefs.title"), component: AgentSettings },
  ],
  extend: { appearance: [DarkPaperSetting] },
};
