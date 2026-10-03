import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const sourceExtension = /\.(?:css|scss|less|[cm]?[jt]sx?|html)$/;
const scriptExtension = /\.[cm]?[jt]sx?$/;
const ignoredDirectories = new Set(["node_modules", "dist", "target", "coverage", "src-tauri"]);
const defaultRoot = fileURLToPath(new URL("../../", import.meta.url));

const blankComment = (comment) => comment.replace(/[^\r\n]/g, " ");
const withoutComments = (contents) => contents.replace(/\/\*[\s\S]*?\*\/|<!--[\s\S]*?-->/g, blankComment);

export function readLegacyTokens(root = defaultRoot) {
  const css = withoutComments(fs.readFileSync(path.join(root, "packages/design/legacy.css"), "utf8"));
  return new Set([...css.matchAll(/(--[\w-]+)\s*:/g)].map((match) => match[1]));
}

function guarded(filename) {
  if (!/^(apps|modules|packages)\//.test(filename) || !sourceExtension.test(filename)) return false;
  // Only the existing product may keep its compatibility layer while it is
  // migrated. Kit fixtures and all future products have the same strict rules.
  return !/^(?:apps\/scriptz|modules\/scriptz|packages\/design)\//.test(filename);
}

function isLegacyStylesheet(specifier) {
  return /(?:^|\/)legacy\.css(?:[?#].*)?$/.test(specifier);
}

export function findTokenViolations(filename, contents, legacyTokens = readLegacyTokens()) {
  filename = filename.split(path.sep).join("/");
  if (!guarded(filename)) return [];
  const violations = [];
  const add = (offset, value, kind) => {
    const before = contents.slice(0, offset);
    violations.push({ file: filename, line: before.split("\n").length,
      column: offset - before.lastIndexOf("\n"), value, kind });
  };
  const uncommented = withoutComments(contents);
  // Scan complete identifiers, never prefixes: --fg-muted-extra is distinct
  // from --fg-muted. This covers var(), definitions and JS style APIs alike.
  const scanTokens = (text, offset = 0) => {
    for (const match of text.matchAll(/--[\w-]+/g)) {
      if (legacyTokens.has(match[0])) add(offset + match.index, match[0], "token");
    }
  };
  const checkScript = (text, offset = 0, includeTokens = true) => {
    const source = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = (node) => {
      if (includeTokens && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
        || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node))) {
        scanTokens(node.text, offset + node.getStart(source) + 1);
      }
      let specifier;
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) specifier = node.moduleSpecifier;
      else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword
        || (ts.isIdentifier(node.expression) && node.expression.text === "require"))) specifier = node.arguments[0];
      if (specifier && (ts.isStringLiteral(specifier) || ts.isNoSubstitutionTemplateLiteral(specifier))
        && isLegacyStylesheet(specifier.text)) add(offset + specifier.getStart(source), specifier.text, "import");
      ts.forEachChild(node, visit);
    };
    visit(source);
  };
  if (scriptExtension.test(filename)) checkScript(contents);
  else {
    scanTokens(uncommented);
    // CSS imports and HTML stylesheet links, including unquoted url()/href.
    const stylesheet = /@import\s+(?:url\(\s*)?["']?([^\s"'();]+)|<link\b[^>]*\bhref\s*=\s*["']?([^\s"'>]+)/gi;
    for (const match of uncommented.matchAll(stylesheet)) {
      const specifier = match[1] ?? match[2];
      if (isLegacyStylesheet(specifier)) add(match.index, specifier, "import");
    }
    if (filename.endsWith(".html")) {
      for (const match of uncommented.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)) {
        checkScript(match[1], match.index + match[0].indexOf(">") + 1, false);
      }
    }
  }
  return violations.sort((a, b) => a.line - b.line || a.column - b.column);
}

export function checkTokens(root) {
  const legacyTokens = readLegacyTokens(root);
  const violations = [];
  const walk = (directory) => {
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (ignoredDirectories.has(entry.name)) continue;
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(filename);
      else if (entry.isFile() && sourceExtension.test(entry.name)) {
        violations.push(...findTokenViolations(path.relative(root, filename), fs.readFileSync(filename, "utf8"), legacyTokens));
      }
    }
  };
  for (const group of ["apps", "modules", "packages"]) walk(path.join(root, group));
  return violations;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const violations = checkTokens(defaultRoot);
  for (const violation of violations) {
    console.error(`${violation.file}:${violation.line}:${violation.column}: ${violation.value} - use semantic design tokens; legacy compatibility is ScriptZ-only.`);
  }
  if (violations.length) process.exitCode = 1;
  else console.log("Token check passed (Kit and new products use no legacy stylesheet or aliases).");
}
