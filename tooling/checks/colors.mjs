import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { COLOR_LITERAL, sourceFiles } from "./shared.mjs";

// Content colors are document data, not interface tokens. Keep exceptions at
// declaration level so adding a UI literal to the same file still fails.
const contentExceptions = [
  {
    file: "modules/scriptz/styles/tokens.css",
    line: /^\s*--char-[1-5]:\s*#[\da-f]{6};\s*$/i,
    reason: "Persisted character palette, mirrored by the content model.",
  },
  {
    file: "modules/scriptz/components/Editor/plugins/colorPicker.tsx",
    line: /^const NEUTRAL_PLACEHOLDER = "#9aa0a6";$/,
    reason: "Character color before a document character has been assigned a palette color.",
  },
];

export function findColorViolations(filename, contents) {
  filename = filename.split(path.sep).join("/");
  if (filename.startsWith("packages/design/") || /(?:^|\/)__tests__\//.test(filename) || /\.(test|spec)\.tsx$/.test(filename)) return [];
  if (!/^(apps|modules|packages)\/.+\.(css|tsx)$/.test(filename)) return [];
  // Preserve line numbers while ignoring explanatory comments. This remains a
  // deliberately small textual guard, not a CSS or JSX semantics validator.
  const uncommented = contents.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "));
  const violations = [];
  for (const [index, line] of uncommented.split("\n").entries()) {
    const color = COLOR_LITERAL.exec(line);
    if (!color || contentExceptions.some((exception) => exception.file === filename && exception.line.test(line))) continue;
    violations.push({ file: filename, line: index + 1, column: color.index + 1, value: color[0] });
  }
  return violations;
}

export function checkColors(root) {
  return sourceFiles(root, ["apps", "modules", "packages"], /\.(css|tsx)$/)
    .flatMap((filename) => findColorViolations(path.relative(root, filename), fs.readFileSync(filename, "utf8")));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const violations = checkColors(root);
  for (const violation of violations) {
    console.error(`${violation.file}:${violation.line}:${violation.column}: ${violation.value} - use a design token.`);
  }
  if (violations.length) process.exitCode = 1;
  else console.log("Color check passed (CSS/TSX UI; document palettes and test fixtures excepted).");
}
