export type Language = "de" | "en";

const de = {
  description: "Kleine Desktop-Apps für die Arbeit an deinen Inhalten. Die AgentZ Suite beginnt mit ScriptZ.",
  headline: "Für alles vor dem Upload.",
  intro: "Wir machen Inhalte. Und die Werkzeuge, die uns dabei helfen. In der AgentZ Suite bekommt jede Aufgabe ihre eigene App - mit einem gemeinsamen Gefühl für gutes Arbeiten.",
  appsHeading: "Unsere Apps",
  appsIntro: "Einzeln nutzen. Direkt auf deinem Rechner.",
  soon: "Bald verfügbar",
  available: "Jetzt verfügbar",
  macos: "Für macOS laden",
  windows: "Für Windows laden",
  platforms: "macOS (Apple Silicon) und Windows (64 Bit)",
  downloads: "Downloads über GitHub",
  footer: "Von AgentZ. Für die Arbeit hinter den Inhalten.",
  source: "Quellcode auf GitHub",
  legal: "Impressum",
  privacy: "Datenschutz",
  language: "Sprache",
  skip: "Zum Inhalt",
  home: "Zur Startseite",
};

const en: Record<keyof typeof de, string> = {
  description: "Small desktop apps for making your content. The AgentZ Suite starts with ScriptZ.",
  headline: "For everything before you publish.",
  intro: "We make content. And the tools that help us make it. In the AgentZ Suite, each task gets its own app - with a shared approach to getting things done.",
  appsHeading: "Our apps",
  appsIntro: "Use them individually. Right on your computer.",
  soon: "Coming soon",
  available: "Available now",
  macos: "Download for macOS",
  windows: "Download for Windows",
  platforms: "macOS (Apple Silicon) and Windows (64-bit)",
  downloads: "Downloads via GitHub",
  footer: "By AgentZ. For the work behind the content.",
  source: "Source code on GitHub",
  legal: "Legal notice (German)",
  privacy: "Privacy (German)",
  language: "Language",
  skip: "Skip to content",
  home: "Back to home",
};

export const catalogs = { de, en };
