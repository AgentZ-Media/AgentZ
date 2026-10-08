import { createSignal } from "solid-js";

/** Where the floating "Report a problem" pill goes on the current screen:
 *  distances from the window's bottom right in px, or hidden. */
export interface ReportPillPlacement {
  right?: number;
  bottom?: number;
  hidden?: boolean;
}

/** Session controls; creation and reset never perform persistence or I/O. */
export function createShellUi() {
  const [sidebarOpen, setSidebar] = createSignal(true);
  const [focused, setFocused] = createSignal(false);
  const [settingsOpen, setSettingsOpen] = createSignal(false);
  const [settingsSection, setSettingsSection] = createSignal("appearance");
  const [paletteOpen, setPaletteOpen] = createSignal(false);
  const [onboardingOpen, setOnboardingOpen] = createSignal(false);
  const [reportOpen, setReportOpen] = createSignal(false);
  const [reportPillPlacement, setReportPillPlacement] = createSignal<ReportPillPlacement | null>(null, {
    equals: (a, b) => a?.right === b?.right && a?.bottom === b?.bottom && a?.hidden === b?.hidden,
  });
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
    reportOpen,
    openReport: () => { setReportOpen(true); },
    closeReport: () => { setReportOpen(false); },
    reportPillPlacement,
    setReportPillPlacement: (placement: ReportPillPlacement | null) => { setReportPillPlacement(placement); },
    anyDialogOpen: () => settingsOpen() || paletteOpen() || onboardingOpen() || reportOpen(),
    reset() {
      persistSidebar = undefined;
      setSidebar(true); setFocused(false); setSettingsOpen(false);
      setSettingsSection("appearance"); setPaletteOpen(false); setOnboardingOpen(false);
      setReportOpen(false); setReportPillPlacement(null);
    },
  };
}

/** A desktop window hosts one active application shell. */
export const shellUi = createShellUi();
