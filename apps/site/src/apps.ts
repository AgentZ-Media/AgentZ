export interface SuiteApp {
  id: string;
  name: string;
  tagline: { de: string; en: string };
  status: "available" | "soon";
}

// Change to available only after a successful release publishes both installers.
export const apps: readonly SuiteApp[] = [
  /* @new-app:entries:start */
  {
    id: "scriptz",
    name: "ScriptZ",
    tagline: {
      de: "Skripte schreiben, Ideen sammeln und beim Dreh den Überblick behalten.",
      en: "Write scripts, collect ideas and keep track of everything when filming.",
    },
    status: "soon",
  },
  // @new-app:sandbox:start
  { id: "sandbox", name: "Sandbox", tagline: { de: "Dein neuer Arbeitsbereich.", en: "Your new workspace." }, status: "soon" },
  // @new-app:sandbox:end
  /* @new-app:entries:end */
];

export function appLinks(id: string) {
  const release = `https://github.com/AgentZ-Media/AgentZ/releases/download/${id}-latest`;
  return {
    icon: `/img/${id}.png`,
    macos: `${release}/${id}-macos-arm64.dmg`,
    windows: `${release}/${id}-windows-x64-setup.exe`,
  };
}
