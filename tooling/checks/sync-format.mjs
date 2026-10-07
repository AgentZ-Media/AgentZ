import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Order of sync format changes (docs/cloud-sync.md, "Versionen und
// Kompatibilität"). Nightlies are built from main and share the account with
// stable installations, so main may only write a format the latest stable
// release can already read, and must read what that release writes.
// Otherwise a nightly would pause every stable device of the same account.

const STABLE_TAG = /^([a-z][a-z0-9-]*)-v(\d+)\.(\d+)\.(\d+)$/;

const newer = (a, b) => {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
};

/** Newest stable release tag of an app (`<app>-vX.Y.Z`, pre-releases excluded). */
export function latestStableTag(tags, app) {
  let best = null;
  for (const raw of tags) {
    const tag = raw.trim();
    const match = STABLE_TAG.exec(tag);
    if (!match || match[1] !== app) continue;
    const version = match.slice(2, 5).map(Number);
    if (!best || newer(version, best.version)) best = { tag, version };
  }
  return best?.tag ?? null;
}

const isFormat = (value) => Number.isInteger(value) && value >= 1;

/** Problems of the current format against the released one; empty if fine. */
export function formatProblems({ app, current, released, tag }) {
  const problems = [];
  if (!isFormat(current.writes) || !isFormat(current.reads) || current.reads < current.writes) {
    problems.push(`${app}: format.json needs integers with 1 <= writes <= reads (writes ${current.writes}, reads ${current.reads}).`);
    return problems;
  }
  if (!released) return problems;
  if (current.writes > released.reads) {
    problems.push(`${app}: main writes sync format ${current.writes}, but ${tag} reads only up to ${released.reads}. `
      + `Release a version that reads format ${current.writes} first, then raise "writes".`);
  }
  if (current.reads < released.writes) {
    problems.push(`${app}: main reads sync formats up to ${current.reads}, but ${tag} already writes ${released.writes}.`);
  }
  return problems;
}

/**
 * Format of a released version: its format.json; format 1 if it synced
 * before format files existed; null if it has no sync at all, so nothing on
 * its devices can be paused.
 */
export function releasedFormat({ formatText, hasSync }) {
  if (formatText) return JSON.parse(formatText);
  return hasSync ? { reads: 1, writes: 1 } : null;
}

function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
}

export function checkSyncFormats(root, { requireTags = false } = {}) {
  const problems = [];
  const notes = [];
  const allTags = git(root, ["tag", "-l"]).split("\n").filter(Boolean);
  if (requireTags && allTags.length === 0) {
    return { problems: ["No git tags found. Check out with tags (fetch-depth: 0) to compare against the latest release."], notes };
  }
  const modules = path.join(root, "modules");
  for (const app of fs.readdirSync(modules).sort()) {
    const file = path.join(modules, app, "lib/sync/format.json");
    if (!fs.existsSync(file)) continue;
    const current = JSON.parse(fs.readFileSync(file, "utf8"));
    const tag = latestStableTag(allTags, app);
    let released = null;
    if (tag) {
      let formatText = null;
      try {
        formatText = git(root, ["show", `${tag}:modules/${app}/lib/sync/format.json`]);
      } catch {
        // Older releases synced format 1 data (compat.ts reads accounts
        // without a mark as format 1) or nothing at all.
      }
      const hasSync = formatText !== null || git(root, ["ls-tree", "--name-only", tag, `modules/${app}/lib/sync/`]).trim() !== "";
      released = releasedFormat({ formatText, hasSync });
      if (!formatText) {
        notes.push(released
          ? `${app}: ${tag} has no sync format file, compared as format 1.`
          : `${app}: ${tag} does not sync yet, nothing to compare.`);
      }
    } else {
      notes.push(`${app}: no stable release yet, nothing to compare.`);
    }
    problems.push(...formatProblems({ app, current, released, tag }));
    if (released) notes.push(`${app}: writes ${current.writes}, reads ${current.reads}; ${tag} writes ${released.writes}, reads ${released.reads}.`);
  }
  return { problems, notes };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const { problems, notes } = checkSyncFormats(root, { requireTags: process.env.CI === "true" });
  for (const note of notes) console.log(note);
  for (const problem of problems) console.error(problem);
  if (problems.length) process.exitCode = 1;
  else console.log("Sync format check passed.");
}
