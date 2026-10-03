import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { templates } from "./templates.mjs";

export const RESERVED = new Set(["site", "design", "kit", "desktop", "core", "new-app", "remove-app", "latest", "scriptz", "suite", "agentz", "agentz-desktop", "test", "tests", "build", "target", "node-modules", "con", "prn", "aux", "nul", "self", "super", "crate", "mod", "type", "fn", "lib", "main", "async", "await", "as", "break", "const", "continue", "dyn", "else", "enum", "extern", "false", "for", "if", "impl", "in", "let", "loop", "match", "move", "mut", "pub", "ref", "return", "static", "struct", "trait", "true", "unsafe", "use", "where", "while", "abstract", "become", "box", "do", "final", "macro", "override", "priv", "typeof", "unsized", "virtual", "yield", "try", "gen", ...Array.from({ length: 9 }, (_, i) => `com${i + 1}`), ...Array.from({ length: 9 }, (_, i) => `lpt${i + 1}`)]);
const json = (value) => JSON.stringify(value, null, 2) + "\n";
const read = (root, path) => readFileSync(join(root, path), "utf8");
const parse = (root, path) => JSON.parse(read(root, path));
const marker = (id, side) => `// @new-app:${id}:${side}`;
const ownedAppPaths = (id) => [`apps/${id}`, `modules/${id}`, `docs/release-notes/${id}`, `apps/site/public/img/${id}.png`, ...["mark.svg", "mark-inverse.svg", "app-icon.svg", "app-icon.png"].map((suffix) => `packages/design/assets/${id}-${suffix}`)];
const lockPaths = ["pnpm-lock.yaml", "Cargo.lock"];
function snapshotFiles(root, paths) {
  return Object.fromEntries(paths.map((path) => { safePath(root, path); return [path, existsSync(join(root, path)) ? readFileSync(join(root, path)) : null]; }));
}
function restoreFiles(root, snapshot) {
  for (const [path, content] of Object.entries(snapshot)) {
    if (content === null) rmSync(join(root, path), { force: true });
    else writeFileSync(join(root, path), content);
  }
}
const registryPaths = { logo: "packages/design/logo.ts", site: "apps/site/src/apps.ts" };
export function validateId(id) {
  if (typeof id !== "string" || !/^[a-z][a-z0-9-]*$/.test(id) || id.length > 50 || RESERVED.has(id)) throw new Error(`Ungültige oder reservierte App-ID: ${id}`);
  return id;
}
function safePath(root, relative) {
  let current = root;
  for (const part of relative.split("/")) {
    current = join(current, part);
    if (lstatSync(current, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error(`Symlink wird nicht verändert: ${relative}`);
  }
  return current;
}
function insertEntry(source, sentinel, entry, id) {
  if (source.split(sentinel).length !== 2 || source.includes(marker(id, "start"))) throw new Error(`Registry-Marker fehlt oder ist nicht eindeutig: ${sentinel}`);
  return source.replace(sentinel, `${marker(id, "start")}\n${entry}\n  ${marker(id, "end")}\n  ${sentinel}`);
}
function removeEntry(source, id) {
  const start = marker(id, "start"), end = marker(id, "end");
  if (source.split(start).length !== 2 || source.split(end).length !== 2) throw new Error(`Generierter Registry-Eintrag fehlt oder ist doppelt: ${id}`);
  const from = source.indexOf(start), to = source.indexOf(end);
  if (from >= to) throw new Error(`Beschädigter Registry-Eintrag: ${id}`);
  return source.slice(0, from) + source.slice(to + end.length).replace(/^\r?\n  /, "");
}
export function nextPort(root) {
  const occupied = new Set();
  for (const name of readdirSync(join(root, "apps"))) {
    const conf = join(root, "apps", name, "src-tauri/tauri.conf.json");
    if (existsSync(conf)) {
      const devUrl = JSON.parse(readFileSync(conf, "utf8")).build?.devUrl;
      if (devUrl) { const port = Number(new URL(devUrl).port); occupied.add(port); occupied.add(port + 1); }
    }
    const vite = join(root, "apps", name, "vite.config.ts");
    if (existsSync(vite)) for (const match of readFileSync(vite, "utf8").matchAll(/\bport\s*:\s*(\d+)/g)) occupied.add(Number(match[1]));
  }
  for (let port = 1420; port <= 65000; port += 10) if (!occupied.has(port) && !occupied.has(port + 1)) return port;
  throw new Error("Kein freies Port-Paar verfügbar");
}
export function runCommand(command, args, root) {
  let executable = command;
  let commandArgs = args;
  if (command === "node") executable = process.execPath;
  if (command === "pnpm" && process.env.npm_execpath) {
    executable = process.execPath;
    commandArgs = [process.env.npm_execpath, ...args];
  } else if (command === "pnpm" && process.platform === "win32") {
    throw new Error("Generator unter Windows bitte über pnpm new-app/remove-app starten.");
  }
  const result = spawnSync(executable, commandArgs, { cwd: root, stdio: "inherit", shell: false });
  if (result.error || result.status !== 0) throw new Error(`${command} ${args.join(" ")} fehlgeschlagen; Repository-Dateien werden zurückgesetzt. ${result.error?.message ?? ""}`);
}
function updateLocks(root, run) {
  run("pnpm", ["install", "--no-frozen-lockfile"], root);
  run("cargo", ["check", "--workspace"], root);
}

export function newApp(root, id, name, { run = runCommand } = {}) {
  root = resolve(root);
  validateId(id);
  if (typeof name !== "string" || !name.trim() || name.length > 80 || /[\x00-\x1f\x7f/\\]/.test(name)) throw new Error("App-Name muss 1–80 Zeichen enthalten und darf keine Steuerzeichen oder Pfadtrenner enthalten.");
  name = name.trim();
  for (const prefix of ["packages", "tooling", "crates"]) {
    if (existsSync(safePath(root, `${prefix}/${id}`))) throw new Error(`ID gehört bereits zur Infrastruktur: ${id}`);
  }
  const ownedPaths = ownedAppPaths(id);
  for (const path of ownedPaths) if (existsSync(safePath(root, path))) throw new Error(`Wird niemals überschrieben: ${path}`);
  safePath(root, "package.json");
  const pkg = parse(root, "package.json");
  const scripts = { [`dev:${id}`]: `pnpm --filter @agentz/${id}-app tauri:dev`, [`build:${id}`]: `pnpm --filter @agentz/${id}-app tauri:build` };
  for (const key of Object.keys(scripts)) if (Object.hasOwn(pkg.scripts ?? {}, key)) throw new Error(`Root-Skript existiert bereits: ${key}`);
  const port = nextPort(root);
  const pubkey = parse(root, "apps/scriptz/src-tauri/tauri.conf.json").plugins.updater.pubkey;
  if (!pubkey) throw new Error("Gemeinsamer Updater-Public-Key fehlt");
  const baseline = read(root, "crates/agentz-desktop/src/baseline.sql");
  const lockSnapshot = snapshotFiles(root, lockPaths);
  const originals = { "package.json": read(root, "package.json") };
  const replacements = {};
  for (const path of Object.values(registryPaths)) { safePath(root, path); originals[path] = read(root, path); }
  if (new RegExp(`(?:^|[\\n{,])\\s*["\']?${id}["\']?\\s*:`).test(originals[registryPaths.logo]) || new RegExp(`["\']?\\bid["\']?\\s*:\\s*["\']${id}["\']`).test(originals[registryPaths.site])) throw new Error(`App-ID ist bereits in einer Registry enthalten: ${id}`);
  replacements[registryPaths.logo] = insertEntry(originals[registryPaths.logo], "// new-app:logos", `  ${JSON.stringify(id)}: createLogo(${JSON.stringify([...name][0].toUpperCase())}),`, id);
  replacements[registryPaths.site] = insertEntry(originals[registryPaths.site], "/* @new-app:entries:end */", `  { id: ${JSON.stringify(id)}, name: ${JSON.stringify(name)}, tagline: { de: "Dein neuer Arbeitsbereich.", en: "Your new workspace." }, status: "soon" },`, id);
  replacements["package.json"] = json({ ...pkg, scripts: { ...pkg.scripts, ...scripts } });
  const files = templates({ id, name, port, pubkey, baseline });
  files[`apps/${id}/.agentz-generated.json`] = json({ generator: "agentz-new-app", version: 1, id, scripts, paths: ownedPaths });
  // All collisions and shared registry formats are checked before the first write.
  const created = [];
  try {
    for (const path of ownedPaths.slice(0, 3)) { mkdirSync(safePath(root, dirname(path)), { recursive: true }); mkdirSync(safePath(root, path)); created.push(path); }
    for (const [path, content] of Object.entries(files)) { mkdirSync(dirname(safePath(root, path)), { recursive: true }); writeFileSync(safePath(root, path), content, { flag: "wx" }); }
    for (const [path, content] of Object.entries(replacements)) writeFileSync(safePath(root, path), content);
    run("pnpm", ["install", "--no-frozen-lockfile"], root);
    created.push(...ownedPaths.slice(3));
    run("node", ["packages/design/scripts/build-logo.mjs", "--app", id], root);
    run("cargo", ["check", "--workspace"], root);
  } catch (error) {
    restoreFiles(root, { ...originals, ...lockSnapshot });
    for (const path of created) rmSync(join(root, path), { recursive: true, force: true });
    throw error;
  }
  return { id, name, port, paths: ownedPaths };
}

export function removeApp(root, id, { run = runCommand } = {}) {
  root = resolve(root);
  validateId(id);
  const manifestPath = `apps/${id}/.agentz-generated.json`;
  safePath(root, manifestPath);
  if (!existsSync(join(root, manifestPath))) throw new Error("Entfernen verweigert: kein Generator-Eigentumsnachweis vorhanden.");
  const manifest = parse(root, manifestPath);
  const expectedPaths = ownedAppPaths(id);
  if (manifest.generator !== "agentz-new-app" || manifest.version !== 1 || manifest.id !== id || JSON.stringify(manifest.paths) !== JSON.stringify(expectedPaths)) throw new Error("Ungültiger Generator-Eigentumsnachweis");
  for (const path of expectedPaths) safePath(root, path);
  const pkg = parse(root, "package.json");
  const expectedScripts = { [`dev:${id}`]: `pnpm --filter @agentz/${id}-app tauri:dev`, [`build:${id}`]: `pnpm --filter @agentz/${id}-app tauri:build` };
  for (const [key, value] of Object.entries(expectedScripts)) {
    if (pkg.scripts?.[key] !== value) throw new Error(`Root-Skript wurde verändert; zuerst prüfen: ${key}`);
    delete pkg.scripts[key];
  }
  const replacements = { "package.json": json(pkg) };
  for (const path of Object.values(registryPaths)) { safePath(root, path); replacements[path] = removeEntry(read(root, path), id); }
  const snapshot = snapshotFiles(root, [...Object.keys(replacements), ...lockPaths]);
  // Stage on the same filesystem outside workspace globs, so a failed install/check can restore everything.
  const staging = mkdtempSync(join(root, ".agentz-remove-"));
  const moved = [];
  let stagingCanBeRemoved = false;
  try {
    for (const path of expectedPaths) {
      if (!existsSync(join(root, path))) continue;
      const backup = join(staging, String(moved.length));
      renameSync(safePath(root, path), backup);
      moved.push([path, backup]);
    }
    for (const [path, content] of Object.entries(replacements)) writeFileSync(safePath(root, path), content);
    updateLocks(root, run);
    stagingCanBeRemoved = true;
  } catch (error) {
    try {
      restoreFiles(root, snapshot);
      for (const [path, backup] of moved.reverse()) renameSync(backup, join(root, path));
      stagingCanBeRemoved = true;
    } catch (restoreError) {
      throw new AggregateError([error, restoreError], `Wiederherstellung unvollständig. Sicherung unbedingt erhalten und manuell prüfen: ${staging}`);
    }
    throw error;
  } finally {
    if (stagingCanBeRemoved) rmSync(staging, { recursive: true, force: true });
  }
  return { id };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, id, name, ...extra] = process.argv.slice(2);
  try {
    if (extra.length || (command === "remove" && name) || !["create", "remove"].includes(command)) throw new Error('Aufruf: pnpm new-app <id> "<Name>" | pnpm remove-app <id>');
    const root = fileURLToPath(new URL("../../", import.meta.url));
    const result = command === "create" ? newApp(root, id, name) : removeApp(root, id);
    console.log(command === "create" ? `${result.name} erstellt. Start: pnpm dev:${id} (Port ${result.port})` : `${id} entfernt. Lokale App-Daten und veröffentlichte Releases bleiben erhalten.`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
