import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { newApp, removeApp, nextPort, validateId, lockDrift } from "./index.mjs";
import { templates } from "./templates.mjs";
import { findTokenViolations } from "../checks/tokens.mjs";
import { validateAppId } from "../release/core.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "agentz-generator-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (path, value) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), value); };
  write("package.json", JSON.stringify({ name: "agentz", scripts: { "dev:scriptz": "unchanged" } }));
  write("apps/scriptz/src-tauri/tauri.conf.json", JSON.stringify({ build: { devUrl: "http://localhost:1420" }, plugins: { updater: { pubkey: "public-test-key" } } }));
  write("packages/design/logo.ts", "export const LOGOS = {\n  scriptz: {},\n  // new-app:logos\n};\n");
  write("apps/site/src/apps.ts", 'export const apps = [\n  { id: "scriptz" },\n  /* @new-app:entries:end */\n];\n');
  write("crates/agentz-desktop/src/baseline.sql", "CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);\n");
  const calls = [];
  const run = (command, args) => calls.push([command, args]);
  return { root, write, calls, run, read: (path) => readFileSync(join(root, path), "utf8") };
}

test("rejects reserved, unsafe and ambiguous IDs", () => {
  for (const id of ["scriptz", "site", "kit", "latest", "../other", "Camel", "", "foo/bar", "notes-", "notes--pro", "con", "crate", "a".repeat(51)]) assert.throws(() => validateId(id));
  for (const id of ["a", "my-tool2", "notes-pro-2"]) {
    assert.equal(validateId(id), id);
    assert.equal(validateAppId(validateId(id)), id);
  }
});

test("creates isolated module and complete native host, then removes owned entries only", (t) => {
  const f = fixture(t);
  const before = Object.fromEntries(["package.json", "packages/design/logo.ts", "apps/site/src/apps.ts", "apps/scriptz/src-tauri/tauri.conf.json"].map((path) => [path, f.read(path)]));
  const result = newApp(f.root, "sandbox", "Sandbox", { run: f.run });
  assert.equal(result.port, 1430);
  const conf = JSON.parse(f.read("apps/sandbox/src-tauri/tauri.conf.json"));
  assert.equal(conf.identifier, "de.agent-z.sandbox");
  assert.equal(conf.build.devUrl, "http://localhost:1430");
  assert.match(conf.plugins.updater.endpoints[0], /sandbox-latest\/latest.json$/);
  assert.match(f.read("apps/sandbox/src-tauri/Cargo.toml"), /tauri-plugin-single-instance = \{ workspace = true \}/);
  assert.doesNotMatch(f.read("apps/sandbox/src-tauri/Cargo.toml"), /global-shortcut/);
  assert.match(f.read("modules/sandbox/module.tsx"), /confirmDialog/);
  assert.match(f.read("modules/sandbox/module.test.tsx"), /Show notice/);
  assert.equal(JSON.parse(f.read("modules/sandbox/package.json")).exports["."], "./index.ts");
  assert.deepEqual(f.calls.map(([command]) => command), ["pnpm", "node", "cargo"]);
  removeApp(f.root, "sandbox", { run: f.run });
  for (const path of ["apps/sandbox", "modules/sandbox", "docs/release-notes/sandbox"]) assert.equal(existsSync(join(f.root, path)), false);
  assert.deepEqual(JSON.parse(f.read("package.json")), JSON.parse(before["package.json"]));
  for (const path of ["packages/design/logo.ts", "apps/site/src/apps.ts", "apps/scriptz/src-tauri/tauri.conf.json"]) assert.equal(f.read(path), before[path]);
});

test("skips colliding Vite/HMR pairs", (t) => {
  const f = fixture(t);
  f.write("apps/other/vite.config.ts", "const config = { port: 1431 };");
  assert.equal(nextPort(f.root), 1440);
});

test("all collisions are rejected before shared files change", (t) => {
  for (const collision of ["apps/sandbox/x", "modules/sandbox/x", "docs/release-notes/sandbox/x", "apps/site/public/img/sandbox.png", "packages/design/assets/sandbox-app-icon.png"]) {
    const f = fixture(t);
    f.write(collision, "existing");
    const original = f.read("package.json");
    assert.throws(() => newApp(f.root, "sandbox", "Sandbox", { run: f.run }), /überschrieben/);
    assert.equal(f.read("package.json"), original);
    assert.equal(f.read(collision), "existing");
    assert.equal(f.calls.length, 0);
  }
});

test("missing registry marker leaves no partial app", (t) => {
  const f = fixture(t);
  f.write("apps/site/src/apps.ts", "export const apps = [];");
  assert.throws(() => newApp(f.root, "sandbox", "Sandbox", { run: f.run }), /Marker/);
  assert.equal(existsSync(join(f.root, "apps/sandbox")), false);
});

test("remove refuses unowned apps, altered scripts and forged path ownership", (t) => {
  const f = fixture(t);
  f.write("apps/other/package.json", "{}");
  assert.throws(() => removeApp(f.root, "other", { run: f.run }), /Eigentumsnachweis/);
  newApp(f.root, "sandbox", "Sandbox", { run: f.run });
  const manifest = JSON.parse(f.read("apps/sandbox/.agentz-generated.json"));
  manifest.paths.push("modules/scriptz");
  f.write("apps/sandbox/.agentz-generated.json", JSON.stringify(manifest));
  assert.throws(() => removeApp(f.root, "sandbox", { run: f.run }), /Eigentumsnachweis/);
  manifest.paths.pop();
  f.write("apps/sandbox/.agentz-generated.json", JSON.stringify(manifest));
  const pkg = JSON.parse(f.read("package.json")); pkg.scripts["dev:sandbox"] = "custom";
  f.write("package.json", JSON.stringify(pkg));
  assert.throws(() => removeApp(f.root, "sandbox", { run: f.run }), /verändert/);
  assert.equal(existsSync(join(f.root, "modules/sandbox")), true);
});

test("does not follow symlink app paths", (t) => {
  const f = fixture(t);
  symlinkSync(join(f.root, "apps/scriptz"), join(f.root, "apps/sandbox"));
  assert.throws(() => newApp(f.root, "sandbox", "Sandbox", { run: f.run }), /Symlink/);
  assert.equal(f.calls.length, 0);
});

test("failed creation restores metadata, both locks and removes every generated artifact", (t) => {
  const f = fixture(t);
  f.write("pnpm-lock.yaml", "old pnpm"); f.write("Cargo.lock", "old cargo");
  const originals = Object.fromEntries(["package.json", "packages/design/logo.ts", "apps/site/src/apps.ts", "pnpm-lock.yaml", "Cargo.lock"].map((path) => [path, f.read(path)]));
  assert.throws(() => newApp(f.root, "sandbox", "Sandbox", { run(command) {
    f.write("pnpm-lock.yaml", "new pnpm"); f.write("Cargo.lock", "new cargo");
    if (command === "node") f.write("packages/design/assets/sandbox-app-icon.png", "image");
    if (command === "cargo") throw new Error("offline");
  } }), /offline/);
  for (const [path, original] of Object.entries(originals)) assert.equal(f.read(path), original);
  for (const path of ["apps/sandbox", "modules/sandbox", "packages/design/assets/sandbox-app-icon.png"]) assert.equal(existsSync(join(f.root, path)), false);
});

test("failed removal restores sources, custom product work, artifacts and lockfiles", (t) => {
  const f = fixture(t);
  newApp(f.root, "sandbox", "Sandbox", { run: f.run });
  f.write("pnpm-lock.yaml", "old pnpm"); f.write("Cargo.lock", "old cargo");
  f.write("modules/sandbox/my-work.txt", "precious");
  f.write("packages/design/assets/sandbox-app-icon.png", "image");
  const originals = Object.fromEntries(["package.json", "packages/design/logo.ts", "apps/site/src/apps.ts", "pnpm-lock.yaml", "Cargo.lock", "modules/sandbox/my-work.txt", "packages/design/assets/sandbox-app-icon.png"].map((path) => [path, f.read(path)]));
  assert.throws(() => removeApp(f.root, "sandbox", { run(command) {
    f.write("pnpm-lock.yaml", "changed"); f.write("Cargo.lock", "changed");
    if (command === "cargo") throw new Error("check failed");
  } }), /check failed/);
  for (const [path, original] of Object.entries(originals)) assert.equal(f.read(path), original);
  removeApp(f.root, "sandbox", { run: f.run });
  assert.equal(existsSync(join(f.root, "packages/design/assets/sandbox-app-icon.png")), false);
});

test("rejects manual registry IDs and dangling symlinks before changes", (t) => {
  for (const path of ["packages/design/logo.ts", "apps/site/src/apps.ts"]) {
    const f = fixture(t);
    f.write(path, f.read(path) + (path.includes("logo") ? '\n  sandbox: {},\n' : '\n { id: "sandbox" },\n'));
    assert.throws(() => newApp(f.root, "sandbox", "Sandbox", { run: f.run }), /Registry/);
    assert.equal(existsSync(join(f.root, "apps/sandbox")), false);
  }
  const f = fixture(t);
  symlinkSync(join(f.root, "missing"), join(f.root, "apps/sandbox"));
  assert.throws(() => newApp(f.root, "sandbox", "Sandbox", { run: f.run }), /Symlink/);
});

test("generated app sources use semantic tokens without legacy compatibility", () => {
  const files = templates({ id: "sandbox", name: "Sandbox", port: 1430, pubkey: "test", baseline: "" });
  const violations = Object.entries(files).flatMap(([path, content]) => findTokenViolations(path, content));
  assert.deepEqual(violations, []);
});

test("rejects existing native Cargo package names before any mutation", (t) => {
  for (const id of ["image", "time"]) {
    const f = fixture(t);
    f.write("Cargo.lock", 'version = 4\n\n[[package]]\nname = "image"\nversion = "0.25.0"\nsource = "registry+https://github.com/rust-lang/crates.io-index"\n\n[[package]]\nname = "time"\nversion = "0.3.0"\n');
    const originals = Object.fromEntries(["package.json", "packages/design/logo.ts", "apps/site/src/apps.ts", "Cargo.lock"].map((path) => [path, f.read(path)]));
    assert.throws(() => newApp(f.root, id, "Native collision", { run: f.run }), /reservierter nativer Paketname in Cargo.lock/);
    for (const [path, original] of Object.entries(originals)) assert.equal(f.read(path), original);
    for (const path of [`apps/${id}`, `modules/${id}`, `docs/release-notes/${id}`]) assert.equal(existsSync(join(f.root, path)), false);
    assert.equal(f.calls.length, 0);
  }
});

test("reports lockfile packages and peer resolutions changed beyond the generated importer", () => {
  const lock = (packages, snapshots) => `lockfileVersion: '9.0'\n\nimporters:\n\n  .: {}\n\npackages:\n\n${packages.map((entry) => `  ${entry}:\n    resolution: {integrity: x}\n`).join("\n")}\nsnapshots:\n\n${snapshots.join("\n\n")}\n`;
  const pkgs = ["picomatch@4.0.4", "picomatch@4.0.7", "'@babel/parser@7.29.3'", "solid-js@1.9.12"];
  const snaps = ["  picomatch@4.0.4: {}", "  picomatch@4.0.7: {}", "  fdir@6.4.0(picomatch@4.0.4):\n    optionalDependencies:\n      picomatch: 4.0.4", "  '@solidjs/testing-library@0.8.10(solid-js@1.9.12)':\n    dependencies:\n      solid-js: 1.9.12"];
  const before = lock(pkgs, snaps);
  assert.deepEqual(lockDrift(before, before), { added: [], removed: [], changed: [] });
  // A new package version shows up as added/removed.
  const bumped = lock(["picomatch@4.0.7", "'@babel/parser@7.29.3'", "solid-js@1.9.12"], snaps.slice(1));
  assert.deepEqual(lockDrift(before, bumped).removed, ["picomatch@4.0.4"]);
  // A changed peer version changes the snapshot key.
  const peer = lock(pkgs, [...snaps.slice(0, 2), "  fdir@6.4.0(picomatch@4.0.7):\n    optionalDependencies:\n      picomatch: 4.0.7", snaps[3]]);
  assert.deepEqual(lockDrift(before, peer).changed.sort(), ["fdir@6.4.0(picomatch@4.0.4)", "fdir@6.4.0(picomatch@4.0.7)"]);
  // Same peer suffix, but a dependency inside the snapshot moved.
  const moved = lock(pkgs, [...snaps.slice(0, 3), "  '@solidjs/testing-library@0.8.10(solid-js@1.9.12)':\n    dependencies:\n      solid-js: 1.9.13"]);
  assert.deepEqual(lockDrift(before, moved), { added: [], removed: [], changed: ["@solidjs/testing-library@0.8.10(solid-js@1.9.12)"] });
});
