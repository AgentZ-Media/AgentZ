import { createEffect, createRoot, createSignal } from "solid-js";
import { getBuildInfo, getKvStore, type KvStore, type UpdateChannel } from "../platform";
import { applyResolvedLanguage, detectSystemLanguage, resolveLanguage, type LanguagePref } from "../i18n";
import { createSettingsWriter } from "./settingsWriter";

export type Theme = "dark" | "light" | "auto";
const [theme, setTheme] = createSignal<Theme>("light");
const [resolvedTheme, setResolvedTheme] = createSignal<"dark" | "light">("light");
const [language, setLanguage] = createSignal<LanguagePref>("auto");
const [updateCheckEnabled, setUpdateCheckEnabled] = createSignal(true);
const [hourlyUpdateCheck, setHourlyUpdateCheck] = createSignal(true);
const [updateChannel, setUpdateChannel] = createSignal<UpdateChannel>("stable");
const [loaded, setLoaded] = createSignal(false);
let generation = 0;
let runtime: { kv: KvStore; writer: ReturnType<typeof createSettingsWriter>; stop: () => void } | undefined;

function active() {
  if (!runtime) throw new Error("Base settings runtime has not started.");
  return runtime;
}
const applyLanguage = () => applyResolvedLanguage(resolveLanguage(language()));

export const baseSettingsStore = {
  theme, resolvedTheme, language, updateCheckEnabled, hourlyUpdateCheck, updateChannel, loaded,
  async setTheme(value: Theme) { setTheme(value); await active().writer.write("theme", value); },
  async setLanguage(value: LanguagePref) { setLanguage(value); applyLanguage(); await active().writer.write("language", value); },
  async setUpdateCheckEnabled(value: boolean) { setUpdateCheckEnabled(value); await active().writer.write("update_check_enabled", value ? "1" : "0"); },
  async setHourlyUpdateCheck(value: boolean) { setHourlyUpdateCheck(value); await active().writer.write("hourly_update_check", value ? "1" : "0"); },
  async setUpdateChannel(value: UpdateChannel) { setUpdateChannel(value); await active().writer.write("update_channel", value); },
  async load() {
    const current = active();
    const boot = generation;
    const [storedTheme, storedLanguage, updates, hourly, channel] = await Promise.all([
      current.kv.getSetting("theme"), current.kv.getSetting("language"),
      current.kv.getSetting("update_check_enabled"), current.kv.getSetting("hourly_update_check"),
      current.kv.getSetting("update_channel"),
    ]);
    if (boot !== generation || runtime !== current) return;
    setTheme(storedTheme === "dark" || storedTheme === "auto" ? storedTheme : "light");
    setLanguage(storedLanguage === "de" || storedLanguage === "en" ? storedLanguage : "auto");
    setUpdateCheckEnabled(updates === null ? true : updates === "1");
    setHourlyUpdateCheck(hourly === null ? true : hourly === "1");
    // A directly installed nightly build keeps receiving nightlies until the
    // user chooses a channel; every stored choice wins.
    setUpdateChannel(channel === "nightly" || (channel === null && getBuildInfo().channel === "nightly") ? "nightly" : "stable");
    applyLanguage();
    setLoaded(true);
  },
};

/** Explicit lifetime: importing settings never touches host APIs or the DOM. */
export function startBaseSettingsRuntime(kv: KvStore = getKvStore()): () => void {
  if (runtime) return runtime.stop;
  generation += 1;
  setLoaded(false);
  const media = typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  const applyTheme = () => {
    const resolved = theme() === "auto" ? (media?.matches ? "dark" : "light") : theme() as "dark" | "light";
    setResolvedTheme(resolved);
    if (typeof document !== "undefined") document.documentElement.dataset.theme = resolved;
  };
  applyResolvedLanguage(detectSystemLanguage());
  const writer = createSettingsWriter(kv, "base-settings");
  const disposeRoot = createRoot((dispose) => {
    createEffect(() => { if (loaded()) applyTheme(); });
    return dispose;
  });
  const onThemeChange = () => { if (loaded() && theme() === "auto") applyTheme(); };
  const onLanguageChange = () => { if (loaded() && language() === "auto") applyLanguage(); };
  media?.addEventListener("change", onThemeChange);
  if (typeof window !== "undefined") window.addEventListener("languagechange", onLanguageChange);
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    generation += 1;
    disposeRoot();
    media?.removeEventListener("change", onThemeChange);
    if (typeof window !== "undefined") window.removeEventListener("languagechange", onLanguageChange);
    writer.dispose();
    setLoaded(false);
    runtime = undefined;
  };
  runtime = { kv, writer, stop };
  return stop;
}
