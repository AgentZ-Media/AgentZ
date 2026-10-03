import { createSignal } from "solid-js";

/** Session controls; creation and reset never perform persistence or I/O. */
export function createShellUi() {
  const [sidebarOpen, setSidebar] = createSignal(true);
  const [focused, setFocused] = createSignal(false);
  const [settingsOpen, setSettingsOpen] = createSignal(false);
  const [settingsSection, setSettingsSection] = createSignal("appearance");
  const [paletteOpen, setPaletteOpen] = createSignal(false);
  const [onboardingOpen, setOnboardingOpen] = createSignal(false);
  let persistSidebar: ((open: boolean) => void) | undefined;
  const setSidebarOpen = (open: boolean) => { setSidebar(open); persistSidebar?.(open); };
  return {
    sidebarOpen, focused, setFocused,
    setSidebarOpen,
    setSidebarOpenSilently: (open: boolean) => { setSidebar(open); },
    toggleSidebar: () => setSidebarOpen(!sidebarOpen()),
    setSidebarPersistence(callback: (open: boolean) => void) {
      persistSidebar = callback;
      return () => { if (persistSidebar === callback) persistSidebar = undefined; };
    },
    settingsOpen, settingsSection, setSettingsSection,
    openSettings(section?: string) { if (section) setSettingsSection(section); setSettingsOpen(true); },
    closeSettings: () => { setSettingsOpen(false); },
    paletteOpen,
    openPalette: () => { setPaletteOpen(true); },
    closePalette: () => { setPaletteOpen(false); },
    onboardingOpen,
    openOnboarding: () => { setOnboardingOpen(true); },
    closeOnboarding: () => { setOnboardingOpen(false); },
    anyDialogOpen: () => settingsOpen() || paletteOpen() || onboardingOpen(),
    reset() {
      persistSidebar = undefined;
      setSidebar(true); setFocused(false); setSettingsOpen(false);
      setSettingsSection("appearance"); setPaletteOpen(false); setOnboardingOpen(false);
    },
  };
}

/** A desktop window hosts one active application shell. */
export const shellUi = createShellUi();
