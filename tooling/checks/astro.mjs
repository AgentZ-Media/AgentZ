import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "@astrojs/compiler-rs";
import { createArchitectureRule } from "./architecture.mjs";
import { COLOR_LITERAL, IGNORED_NAMES, lineColumn, sourceFiles } from "./shared.mjs";

const defaultRoot = fileURLToPath(new URL("../../", import.meta.url));
const ignored = new Set([...IGNORED_NAMES, ".astro"]);
const color = new RegExp(COLOR_LITERAL, "gi");
const blank = (value) => value.replace(/[^\r\n]/g, " ");

function walk(node, visit) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) { node.forEach((child) => walk(child, visit)); return; }
  if (typeof node.type === "string") visit(node);
  for (const [key, child] of Object.entries(node)) {
    if (key !== "comments" && child && typeof child === "object") walk(child, visit);
  }
}

// Use Astro's own parser, including JavaScript inside template expressions and
// attributes. A text-only frontmatter extractor would leave those imports open.
export function findAstroViolations(root, filename, contents) {
  filename = filename.split(path.sep).join("/");
  if (!/^apps\/site\/.+\.astro$/.test(filename)) return [];
  const violations = [];
  const add = (offset, kind, value, message) => violations.push({ file: filename, ...lineColumn(contents, offset), kind, value, message });
  const { ast, diagnostics } = parse(contents);
  for (const diagnostic of diagnostics) {
    if (diagnostic.severity === "error") add(diagnostic.labels?.[0]?.start ?? 0, "parse", "", diagnostic.text);
  }
  const rule = createArchitectureRule(root);
  const visitors = rule.create({
    filename: path.join(root, filename),
    report({ node, messageId, data = {} }) {
      const message = rule.meta.messages[messageId].replace(/{{(\w+)}}/g, (_, key) => data[key] ?? "");
      add(node.start, messageId, node.value ?? "", message);
    },
  });
  const checkSpecifier = (node) => {
    if (!node) return;
    visitors.ImportDeclaration({ source: node });
  };
  const checkColors = (text, offset) => {
    for (const match of text.matchAll(color)) add(offset + match.index, "color", match[0], "Use a semantic design color token.");
  };
  const checkCss = (text, offset) => {
    const uncommented = text.replace(/\/\*[\s\S]*?\*\//g, blank);
    // Inspect declaration values, not selectors (#face and #add are valid IDs).
    for (const declaration of uncommented.matchAll(/(?:^|[;{])\s*(?:--[\w-]+|[a-z-]+)\s*:\s*([^;{}]+)/gi)) {
      const value = declaration[1];
      const valueOffset = declaration.index + declaration[0].lastIndexOf(value);
      // Local fragment references and quoted content are not colors.
      const withoutStrings = value.replace(/url\([^)]*\)|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/gi, blank);
      checkColors(withoutStrings, offset + valueOffset);
    }
  };
  walk(ast, (node) => {
    if (node.type === "TSImportType") checkSpecifier(node.source);
    else if (["ImportDeclaration", "ExportNamedDeclaration", "ExportAllDeclaration", "ImportExpression"].includes(node.type)) checkSpecifier(node.source);
    else if (node.type === "TSExternalModuleReference") checkSpecifier(node.expression);
    else if (node.type === "CallExpression" && node.callee.type === "Identifier" && node.callee.name === "require") checkSpecifier(node.arguments[0]);
    if (node.type === "JSXElement" && node.openingElement.name.name === "style") {
      for (const child of node.children) if (child.type === "JSXText") checkCss(child.value, child.start);
    }
    if (node.type === "JSXAttribute" && node.name.name === "style") {
      if (node.value?.type === "Literal") checkCss(node.value.value, node.value.start + 1);
      else walk(node.value, (value) => {
        if (value.type === "Literal" && typeof value.value === "string") checkColors(value.value, value.start + 1);
        if (value.type === "TemplateElement") checkColors(value.value.raw, value.start);
      });
    }
    // <script src> resolves through the same architecture boundary as imports.
    if (node.type === "JSXElement" && node.openingElement.name.name === "script") {
      const src = node.openingElement.attributes.find((attribute) => attribute.name?.name === "src");
      if (src?.value?.type === "Literal") checkSpecifier(src.value);
      else if (src?.value?.type === "JSXExpressionContainer") checkSpecifier(src.value.expression);
    }
  });
  return violations.sort((a, b) => a.line - b.line || a.column - b.column);
}

export function checkAstro(root = defaultRoot) {
  return sourceFiles(root, ["apps/site"], /\.astro$/, ignored)
    .flatMap((filename) => findAstroViolations(root, path.relative(root, filename), fs.readFileSync(filename, "utf8")));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const violations = checkAstro();
  for (const violation of violations) console.error(`${violation.file}:${violation.line}:${violation.column}: ${violation.message} ${violation.value}`);
  if (violations.length) process.exitCode = 1;
  else console.log("Astro check passed (site architecture and style colors).");
}
