import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateAppId } from './core.mjs';
import { isNightlyVersion } from './nightly.mjs';

// Writes the Tauri config merged into a nightly build: the nightly version
// and, when the app has them, the night-sky icons from `src-tauri/icons-nightly`.
// Usage: node tooling/release/nightly-config.mjs <app> <version> <out.json>
const [app, version, out] = process.argv.slice(2);
validateAppId(app);
if (!isNightlyVersion(version)) throw new Error(`Expected a nightly version: ${version}`);
if (!out) throw new Error('Missing output path');

const tauriDir = join(process.cwd(), 'apps', app, 'src-tauri');
const config = JSON.parse(readFileSync(join(tauriDir, 'tauri.conf.json'), 'utf8'));
const override = { version };
const icons = (config.bundle?.icon ?? []).map(icon => icon.replace(/^icons\//, 'icons-nightly/'));
if (icons.length && icons.every(icon => icon.startsWith('icons-nightly/') && existsSync(join(tauriDir, icon)))) {
  override.bundle = { icon: icons };
} else {
  console.warn(`${app}: no complete icons-nightly set; the nightly build uses the regular icons.`);
}
writeFileSync(out, JSON.stringify(override, null, 2));
console.log(JSON.stringify(override));
