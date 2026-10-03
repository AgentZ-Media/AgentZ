import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { appMetadata, parseVersion, compareVersions, validateRelease } from './core.mjs';

export function bump(root, app, version, runCargo = (args) => execFileSync('cargo', args, { cwd: root, stdio: 'inherit' })) {
  parseVersion(version);
  const meta = appMetadata(root, app);
  validateRelease(root, app, meta.pkg.version, { notes: false });
  if (compareVersions(version, meta.pkg.version) <= 0) throw new Error('New version must be newer than the current version');
  const files = [join(meta.base, 'package.json'), join(meta.base, 'src-tauri/tauri.conf.json'), join(meta.base, 'src-tauri/Cargo.toml'), join(root, 'Cargo.lock')];
  const originals = files.map(file => readFileSync(file, 'utf8'));
  try {
    for (let i = 0; i < 2; i++) {
      const value = JSON.parse(originals[i]);
      value.version = version;
      writeFileSync(files[i], `${JSON.stringify(value, null, 2)}\n`);
    }
    let updated = false;
    writeFileSync(files[2], originals[2].replace(/(^\[package\]\s*\r?\n)([\s\S]*?)(?=^\[|$(?![\s\S]))/m, (_, header, body) => header + body.replace(/^version\s*=\s*"[^"]+"/m, () => { updated = true; return `version = "${version}"`; })));
    if (!updated) throw new Error('Could not update Cargo package version');
    runCargo(['update', '--offline', '-p', meta.cargo.name, '--precise', version]);
    validateRelease(root, app, version, { notes: false });
    const notes = join(root, 'docs/release-notes', app, `v${version}.md`);
    if (!existsSync(notes)) {
      mkdirSync(dirname(notes), { recursive: true });
      writeFileSync(notes, `${meta.product} v${version} — Release notes\n\n## What's new\n\n- Describe the changes users will notice.\n\n## Updating\n\nInstall the update from the app's update indicator, or download the installer below.\n`, { flag: 'wx' });
    }
    return { tag: `${app}-v${version}`, notes };
  } catch (error) {
    files.forEach((file, i) => writeFileSync(file, originals[i]));
    throw error;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [app, version, ...extra] = process.argv.slice(2);
  if (!app || !version || extra.length) throw new Error('Usage: pnpm release:bump <app> <version>');
  console.log(bump(process.cwd(), app, version));
}
