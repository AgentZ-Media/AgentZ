const json = (value) => JSON.stringify(value, null, 2) + "\n";

export function templates({ id, name, port, pubkey, baseline }) {
  const q = JSON.stringify;
  const rustId = id.replaceAll("-", "_");
  const dependencies = { "@agentz/kit": "workspace:*", "@agentz/design": "workspace:*", "solid-js": "catalog:" };
  const compilerOptions = { jsx: "preserve", jsxImportSource: "solid-js", esModuleInterop: true, allowSyntheticDefaultImports: true, lib: ["ES2022", "DOM", "DOM.Iterable"], types: ["vite/client", "vitest/globals"] };
  const catalogs = {
    de: { "home.title": `Willkommen bei ${name}`, "home.description": "Dein eigener Arbeitsbereich ist bereit.", "home.nav": "Startseite", "home.toast": "Hinweis anzeigen", "home.confirm": "Bestätigung öffnen", "home.notice": "Alles bereit!", "home.question": "Beispielaktion bestätigen?", "home.confirmed": "Aktion bestätigt." },
    en: { "home.title": `Welcome to ${name}`, "home.description": "Your own workspace is ready.", "home.nav": "Home", "home.toast": "Show notice", "home.confirm": "Open confirmation", "home.notice": "All set!", "home.question": "Confirm this example action?", "home.confirmed": "Action confirmed." },
  };
  const module = `import { createModuleI18n } from "@agentz/kit/i18n";
import type { AppModule } from "@agentz/kit/shell";
import { pushToast } from "@agentz/kit/stores";
import { confirmDialog } from "@agentz/kit/ui";
import { catalogs } from "./i18n";

const { t } = createModuleI18n(catalogs);

export const appModule: AppModule = {
  id: ${q(id)},
  name: ${q(name)},
  logo: ${q(id)},
  i18n: catalogs,
  about: {
    description: () => t("home.description"),
    license: () => "MIT",
    releasesUrl: "https://github.com/AgentZ-Media/AgentZ-Suite/releases/tag/${id}-latest",
    links: [],
  },
  async setup(context) {
    return {
      sidebar: () => <>
        <button class="${id}-nav" onClick={() => context.shell.closeSettings()}>{t("home.nav")}</button>
        <button class="${id}-nav" onClick={() => context.shell.openSettings()}>{t("settings.title")}</button>
      </>,
      routes: [{ id: "home", matches: () => true, component: () => <section class="${id}-home">
        <h1>{t("home.title")}</h1>
        <p>{t("home.description")}</p>
        <div class="${id}-actions">
          <button class="btn" onClick={() => pushToast(t("home.notice"), "ok")}>{t("home.toast")}</button>
          <button class="btn" onClick={async () => {
            if (await confirmDialog({ title: t("home.question") })) pushToast(t("home.confirmed"), "ok");
          }}>{t("home.confirm")}</button>
        </div>
      </section> }],
    };
  },
};
`;
  const moduleTest = `import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { applyResolvedLanguage } from "@agentz/kit/i18n";
import type { ModuleContext } from "@agentz/kit/shell";
import { clearToasts, toastsSignal } from "@agentz/kit/stores";
import { appModule } from "./index";

afterEach(() => { cleanup(); clearToasts(); applyResolvedLanguage("de"); });
describe(${q(name)}, () => {
  it("switches home language and shows a shared toast", async () => {
    applyResolvedLanguage("de");
    const runtime = await appModule.setup({ shell: { closeSettings: vi.fn() } } as unknown as ModuleContext);
    const Home = runtime.routes[0].component;
    render(() => <Home />);
    expect(screen.getByRole("heading").textContent).toBe(${q(catalogs.de["home.title"])});
    applyResolvedLanguage("en");
    expect(screen.getByRole("heading").textContent).toBe(${q(catalogs.en["home.title"])});
    fireEvent.click(screen.getByRole("button", { name: "Show notice" }));
    expect(toastsSignal().at(-1)?.text).toBe("All set!");
  });
  it("opens settings from the visible sidebar in both languages", async () => {
    const openSettings = vi.fn();
    const runtime = await appModule.setup({ shell: { closeSettings: vi.fn(), openSettings } } as unknown as ModuleContext);
    const Sidebar = runtime.sidebar;
    applyResolvedLanguage("de");
    render(() => <Sidebar />);
    fireEvent.click(screen.getByRole("button", { name: "Einstellungen" }));
    applyResolvedLanguage("en");
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(openSettings).toHaveBeenCalledTimes(2);
  });
});
`;
  const plugins = ["os", "window-state", "single-instance", "deep-link", "updater", "process", "opener", "dialog", "fs", "sql"];
  const conf = {
    $schema: "https://schema.tauri.app/config/2", productName: name, version: "0.1.0", identifier: `de.agent-z.${id}`,
    build: { beforeDevCommand: "pnpm dev", devUrl: `http://localhost:${port}`, beforeBuildCommand: "pnpm build", frontendDist: "../dist" },
    app: { windows: [{ label: "main", title: name, width: 1100, height: 760, minWidth: 800, minHeight: 560, decorations: true, titleBarStyle: "Overlay", hiddenTitle: true, resizable: true, dragDropEnabled: false }], security: { csp: "default-src 'self'; img-src 'self' data: blob:; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; connect-src 'self' ipc: http://ipc.localhost https://*.convex.cloud wss://*.convex.cloud https://*.convex.site; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'none'; manifest-src 'self'" } },
    bundle: { active: true, targets: ["dmg", "app", "nsis"], icon: ["icons/32x32.png", "icons/128x128.png", "icons/128x128@2x.png", "icons/icon.icns", "icons/icon.ico"], category: "Productivity", shortDescription: `${name} – AgentZ Suite`, createUpdaterArtifacts: true, macOS: { signingIdentity: "-" }, windows: { nsis: { installMode: "currentUser", displayLanguageSelector: false, languages: ["English", "German"] }, webviewInstallMode: { type: "downloadBootstrapper" } } },
    plugins: { "deep-link": { desktop: { schemes: [`agentz-${id}`] } }, updater: { endpoints: [`https://github.com/AgentZ-Media/AgentZ-Suite/releases/download/${id}-latest/latest.json`], pubkey } },
  };
  return {
    [`modules/${id}/package.json`]: json({ name: `@agentz/${id}`, private: true, version: "0.0.0", type: "module", main: "./index.ts", types: "./index.ts", exports: { ".": "./index.ts", "./styles.css": "./styles.css" }, sideEffects: ["*.css"], scripts: { typecheck: "tsc --noEmit", test: "vitest run" }, dependencies, devDependencies: { "@agentz/vitest-preset": "workspace:*", "@solidjs/testing-library": "catalog:", typescript: "catalog:", vite: "catalog:", vitest: "catalog:" } }),
    [`modules/${id}/index.ts`]: 'export { appModule } from "./module";\n',
    [`modules/${id}/module.tsx`]: module,
    [`modules/${id}/i18n.ts`]: `export const catalogs = ${JSON.stringify(catalogs, null, 2)} as const;\n`,
    [`modules/${id}/module.test.tsx`]: moduleTest,
    [`modules/${id}/styles.css`]: `.${id}-home { padding: var(--sp-7); color: var(--fg); }\n.${id}-home p { color: var(--muted); }\n.${id}-actions { display: flex; flex-wrap: wrap; gap: var(--sp-3); margin-top: var(--sp-6); }\n.${id}-nav { width: 100%; padding: var(--sp-2) var(--sp-3); border: 0; border-radius: var(--r-ctl); background: var(--side-active); color: var(--side-fg); text-align: left; cursor: pointer; }\n`,
    [`modules/${id}/tsconfig.json`]: json({ extends: "../../tsconfig.base.json", compilerOptions, include: ["**/*.ts", "**/*.tsx"], exclude: ["node_modules", "vitest.config.ts"] }),
    [`modules/${id}/vitest.config.ts`]: 'import { definePackageTest } from "@agentz/vitest-preset";\nexport default definePackageTest();\n',
    [`apps/${id}/package.json`]: json({ name: `@agentz/${id}-app`, private: true, version: "0.1.0", type: "module", scripts: { dev: "vite", build: "vite build", preview: "vite preview", tauri: "tauri", "tauri:dev": "tauri dev", "tauri:build": "tauri build", typecheck: "tsc --noEmit" }, dependencies: { "@agentz/desktop": "workspace:*", [`@agentz/${id}`]: "workspace:*" }, devDependencies: { "@tauri-apps/cli": "catalog:", "@types/node": "catalog:", typescript: "catalog:", vite: "catalog:" } }),
    [`apps/${id}/index.html`]: `<!doctype html>\n<html lang="de"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/><title>${name.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</title></head><body><div id="root"></div><script type="module" src="/src/index.tsx"></script></body></html>\n`,
    [`apps/${id}/src/index.tsx`]: `import { bootDesktopApp } from "@agentz/desktop";\n\nconst app = bootDesktopApp({\n  id: ${q(id)},\n  loadModule: async () => {\n    // The chunks load side by side; none of them does I/O on import.\n    const [, { appModule }] = await Promise.all([\n      import("@agentz/${id}/styles.css"),\n      import("@agentz/${id}"),\n    ]);\n    return appModule;\n  },\n});\nif (import.meta.hot) import.meta.hot.dispose(() => { void app.dispose(); });\n`,
    [`apps/${id}/vite.config.ts`]: `import { defineDesktopViteConfig } from "@agentz/desktop/vite";\nexport default defineDesktopViteConfig({ port: ${port} });\n`,
    [`apps/${id}/tsconfig.json`]: json({ extends: "../../tsconfig.base.json", compilerOptions: { ...compilerOptions, types: ["node", "vite/client"] }, include: ["src", "vite.config.ts"] }),
    [`apps/${id}/src-tauri/tauri.conf.json`]: json(conf),
    [`apps/${id}/src-tauri/Cargo.toml`]: `[package]\nname = ${q(id)}\nversion = "0.1.0"\ndescription = ${q(`${name} – AgentZ Suite`)}\nauthors = ["AgentZ Media"]\nedition = "2021"\n\n[lib]\nname = "${rustId}_lib"\ncrate-type = ["staticlib", "cdylib", "rlib"]\n\n[build-dependencies]\ntauri-build = { workspace = true }\n\n[dependencies]\nagentz-desktop = { path = "../../../crates/agentz-desktop" }\ntauri = { workspace = true }\nserde_json = { workspace = true }\n${plugins.map((plugin) => `tauri-plugin-${plugin} = { workspace = true }`).join("\n")}\n`,
    [`apps/${id}/src-tauri/build.rs`]: "fn main() { tauri_build::build() }\n",
    [`apps/${id}/src-tauri/src/main.rs`]: `#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]\nfn main() { ${rustId}_lib::run() }\n`,
    [`apps/${id}/src-tauri/src/lib.rs`]: `#[cfg_attr(mobile, tauri::mobile_entry_point)]\npub fn run() {\n    agentz_desktop::builder(agentz_desktop::Config {\n        id: "${id}",\n        migrations: vec![tauri_plugin_sql::Migration {\n            version: 1,\n            description: "kit baseline",\n            sql: include_str!("../migrations/001_baseline.sql"),\n            kind: tauri_plugin_sql::MigrationKind::Up,\n        }],\n    })\n    .run(tauri::generate_context!())\n    .expect("error while running desktop application");\n}\n`,
    [`apps/${id}/src-tauri/migrations/001_baseline.sql`]: baseline,
    [`apps/${id}/src-tauri/capabilities/default.json`]: json({ $schema: "../gen/schemas/desktop-schema.json", identifier: "default", description: `Baseline permissions for ${name}`, windows: ["main"], permissions: ["core:default", "core:window:allow-start-dragging", "core:window:allow-destroy", "agentz-desktop:default", "agentz-desktop:account", "deep-link:default", "os:default", "updater:default", "process:default", "sql:default", "sql:allow-execute", "dialog:default", "opener:default"] }),
    [`apps/${id}/AGENTS.md`]: `# ${name}\n\nDesktop-Schale: \`apps/${id}\`, Produktlogik: \`modules/${id}\`. Gemeinsames Kit und semantische Design-Tokens nutzen, keine Importe aus anderen Produkten.\n\n- Ports: Vite ${port}, HMR ${port + 1}. Datenbank \`sqlite:${id}.db\`, Identifier \`de.agent-z.${id}\`.\n- Migrationen nur anhängen, eine veröffentlichte Migration nie ändern.\n- Release-Notes: \`docs/release-notes/${id}/vX.Y.Z.md\`, Tags \`${id}-vX.Y.Z\`, Update-Zeiger \`${id}-latest\`.\n\nSiehe \`docs/neue-app.md\` und \`.claude/rules/suite-architecture.md\`.\n`,
    [`docs/release-notes/${id}/.gitkeep`]: "",
  };
}
