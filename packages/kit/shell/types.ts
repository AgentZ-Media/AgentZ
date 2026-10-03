import type { Accessor, Component, JSX } from "solid-js";
import type { LogoId } from "@agentz/design/logo";
import type { PlatformAdapter, KvStore } from "../platform";
import type { FlushResult } from "../lib";
import type { IconName } from "../ui";
import type { Catalog } from "../i18n";

export type KitSectionId = "appearance" | "shortcuts" | "updates" | "about";
export interface SettingsSectionProps { onClose(): void }
export interface SettingsSection {
  id: string;
  label: Accessor<string>;
  icon: IconName;
  component: Component<SettingsSectionProps>;
}
export interface ModuleSettings {
  /** Insert after Appearance and before Shortcuts. IDs must not shadow Kit IDs. */
  sections?: SettingsSection[];
  extend?: Partial<Record<KitSectionId, Component[]>>;
}
export interface AboutInfo {
  description: Accessor<string>;
  releasesUrl?: string;
  license: Accessor<string>;
  links: Array<{ id: string; label: Accessor<string>; text: Accessor<string>; url: string }>;
  /** Product description below the generic replay-onboarding row. */
  onboardingHelp?: Accessor<string>;
}

/** A runtime supplies predicates instead of exposing its product Route union. */
export interface RouteDef {
  id: string;
  matches: Accessor<boolean>;
  component: Component;
}
export type ShortcutContext = "shell" | "editor" | "list" | "dialog";
export interface ShortcutDef {
  id: string;
  label: Accessor<string>;
  /** Human-facing display groups; can differ from dispatch context. */
  group: { id: string; label: Accessor<string> };
  /** Canonical strings passed through K(); literal special labels can use displayKeys. */
  keys: string[];
  displayKeys?: Accessor<string[]>;
  contexts: readonly ShortcutContext[];
  enabled?: Accessor<boolean>;
  /** Optional: local Lexical/list handlers stay local, but remain documented here. */
  matches?: (event: KeyboardEvent) => boolean;
  run?: (event: KeyboardEvent) => void;
}

export interface Command {
  id: string;
  label: string;
  sub?: string;
  /** Product-owned renderer for escaped search snippets, never raw HTML interpreted by Kit. */
  description?: Component;
  icon?: Component;
  hint?: string;
  keywords?: string;
  group?: { id: string; label: string };
  run(): void | Promise<void>;
}
/** Kit owns debounce/cancellation/loading, provider owns result ranking and SQL search. */
export interface CommandProvider {
  (query: string, signal: AbortSignal): Command[] | Promise<Command[]>;
  immediate?(query: string): Command[];
}

export interface ShellControls {
  sidebarOpen: Accessor<boolean>;
  setSidebarOpen(open: boolean): void;
  toggleSidebar(): void;
  /** Presentation-only; does not overwrite persisted sidebar preference. */
  setFocused(focused: boolean): void;
  settingsOpen: Accessor<boolean>;
  settingsSection: Accessor<string>;
  openSettings(section?: string): void;
  closeSettings(): void;
  setSettingsSection(section: string): void;
  paletteOpen: Accessor<boolean>;
  openPalette(): void;
  closePalette(): void;
  onboardingOpen: Accessor<boolean>;
  openOnboarding(): void;
  closeOnboarding(): void;
}
export interface OnboardingProps {
  open: boolean;
  /** Persists configured once flag. Caller may navigate after awaiting it. */
  complete(): Promise<void>;
}
export interface OnboardingDefinition {
  /** Required to preserve each product's existing marker verbatim. */
  key: string;
  component: Component<OnboardingProps>;
}
export interface ModuleContext {
  platform: PlatformAdapter;
  kv: KvStore;
  shell: ShellControls;
  services: Readonly<Record<string, unknown>>;
  signal: AbortSignal;
  /** Registers idempotent cleanup before setup resolves; runs immediately if already aborted. */
  onDispose(cleanup: () => void): void;
  /** Executes synchronous Solid setup in the shell-owned lifetime, even after an await.
   * Throws AbortError after disposal; callers check signal after each await first.
   * Async callbacks are not supported: ownership never crosses await. */
  runOwned<T>(setup: () => T): T;
}
export interface ModuleRuntime {
  routes: RouteDef[];
  /** Content directly under the common app brand, may return a fragment. */
  sidebar: Component;
  /** Product footer, after the optional host/update footer slot. */
  sidebarFooter?: Component;
  overlays?: Component[];
  settings?: ModuleSettings;
  commands?: CommandProvider;
  commandPlaceholder?: Accessor<string>;
  shortcuts?: ShortcutDef[];
  /** Defaults to shell. Dialog detection always overrides this. */
  shortcutContext?: Accessor<Exclude<ShortcutContext, "dialog">>;
  onboarding?: OnboardingDefinition;
  flushPending?(timeoutMs: number): Promise<FlushResult>;
  /** Called once, including when setup resolves after the shell was disposed. */
  dispose?(): void;
}
export interface AppModule {
  id: string;
  name: string;
  logo: LogoId;
  about: AboutInfo;
  boot?: { title: Accessor<string>; description: Accessor<string> };
  i18n: { de: Catalog; en: Catalog };
  setup(context: ModuleContext): Promise<ModuleRuntime>;
}
export interface SuiteShellProps {
  module: AppModule;
  /** Defaults to the registered host adapter and Kit KV slot. */
  platform?: PlatformAdapter;
  kv?: KvStore;
  services?: Readonly<Record<string, unknown>>;
  footer?: JSX.Element;
}
