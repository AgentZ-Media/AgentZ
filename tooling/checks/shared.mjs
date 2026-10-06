import fs from "node:fs";
import path from "node:path";

/** Directory and file names no source check descends into or reads. */
export const IGNORED_NAMES = new Set(["node_modules", "dist", "target", "coverage", "src-tauri"]);

/** Hex colors with 3, 4, 6 or 8 digits and `rgb(`/`rgba(` calls. */
export const COLOR_LITERAL = /#[\da-f]{3}(?:[\da-f]{1}|[\da-f]{3}|[\da-f]{5})?\b|\brgba?\s*\(/i;

/**
 * Absolute paths of all files below `root/<directory>` whose name matches
 * `include`, depth-first in directory order. Missing directories are skipped.
 */
export function sourceFiles(root, directories, include, ignored = IGNORED_NAMES) {
  const files = [];
  const walk = (directory) => {
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (ignored.has(entry.name)) continue;
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(filename);
      else if (entry.isFile() && include.test(entry.name)) files.push(filename);
    }
  };
  for (const directory of directories) walk(path.join(root, directory));
  return files;
}

/** 1-based line and column of a string offset. */
export function lineColumn(contents, offset) {
  const before = contents.slice(0, offset);
  return { line: before.split("\n").length, column: offset - before.lastIndexOf("\n") };
}
