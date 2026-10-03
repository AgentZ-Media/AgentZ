import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const slash = (value) => value.split(path.sep).join("/");

function ownerOf(root, filename) {
  const relative = slash(path.relative(root, filename));
  if (relative.split("/").includes("node_modules")) return null;
  const match = relative.match(/^(apps|modules|packages|tooling)\/([^/]+)(?:\/|$)/);
  return match ? `${match[1]}/${match[2]}` : null;
}

function packageOwners(root) {
  const names = new Map([
    ["@agentz/design", "packages/design"],
    ["@agentz/kit", "packages/kit"],
    ["@agentz/desktop", "packages/desktop"],
    ["@agentz/vitest-preset", "tooling/vitest-preset"],
  ]);
  for (const group of ["apps", "modules", "packages", "tooling"]) {
    const directory = path.join(root, group);
    if (!fs.existsSync(directory)) continue;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const owner = `${group}/${entry.name}`;
      const manifest = path.join(directory, entry.name, "package.json");
      const name = fs.existsSync(manifest)
        ? JSON.parse(fs.readFileSync(manifest, "utf8")).name
        : `@agentz/${entry.name}${group === "apps" ? "-app" : ""}`;
      if (name) names.set(name, owner);
    }
  }
  return names;
}

function allowed(source, target) {
  if (source === target) return true;
  if (source === "packages/design") return false;
  if (source === "packages/kit" || source === "apps/site") return target === "packages/design";
  if (source === "packages/desktop" || source.startsWith("modules/")) {
    return ["packages/kit", "packages/design"].includes(target);
  }
  if (source.startsWith("apps/")) {
    return ["packages/design", "packages/kit", "packages/desktop", `modules/${source.split("/")[1]}`].includes(target);
  }
  // New shared packages need an explicit architecture decision, not accidental access.
  return false;
}

export function createArchitectureRule(root) {
  root = path.resolve(root);
  const names = packageOwners(root);
  const configs = new Map();
  function compilerOptions(filename) {
    const configPath = ts.findConfigFile(path.dirname(filename), ts.sys.fileExists);
    if (!configPath) return {};
    if (!configs.has(configPath)) {
      const config = ts.readConfigFile(configPath, ts.sys.readFile);
      if (config.error) throw new Error(`Cannot read ${configPath}`);
      configs.set(configPath, ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(configPath)).options);
    }
    return configs.get(configPath);
  }
  return {
    meta: {
      type: "problem",
      schema: [],
      messages: {
        boundary: "{{source}} cannot import {{target}}. Follow the suite dependency direction.",
        relative: "Do not cross workspace boundaries with a relative or absolute path; use the package's public exports.",
        unknown: "Unknown internal package {{target}}; declare its workspace and architecture boundary first.",
        dynamic: "Use a static module specifier so workspace boundaries can be checked.",
        tauri: "Tauri belongs in an app host or @agentz/desktop, not in {{source}}.",
      },
    },
    create(context) {
      const filename = context.filename;
      const source = ownerOf(root, filename);
      if (!source || source.startsWith("tooling/")) return {};

      function check(node) {
        if (!node) return;
        const specifier = typeof node.value === "string" ? node.value
          : node.type === "TemplateLiteral" && node.expressions.length === 0 ? node.quasis[0].value.cooked
          : null;
        if (specifier === null) {
          context.report({ node, messageId: "dynamic" });
          return;
        }
        const clean = specifier.split(/[?#]/)[0];
        const physical = clean.startsWith(".") || path.isAbsolute(clean);
        let resolved = physical ? path.resolve(path.dirname(filename), clean) : null;
        // Resolve aliases as well as direct workspace names. A TS path must not hide a forbidden dependency.
        const result = ts.resolveModuleName(clean, filename, compilerOptions(filename), ts.sys).resolvedModule;
        if (result) resolved = result.resolvedFileName;
        const tauri = clean.startsWith("@tauri-apps/") || /(?:^|\/)@tauri-apps\//.test(slash(resolved ?? ""));
        if (tauri && (source === "apps/site" || (!source.startsWith("apps/") && source !== "packages/desktop"))) {
          context.report({ node, messageId: "tauri", data: { source } });
          return;
        }
        let target = resolved ? ownerOf(root, resolved) : null;
        // node_modules paths are not workspace ownership; package manifests identify bare imports.
        const packageName = clean.startsWith("@") ? clean.split("/").slice(0, 2).join("/") : clean.split("/")[0];
        target ??= names.get(packageName);
        if (physical && target !== source) {
          context.report({ node, messageId: "relative" });
          return;
        }
        if (!target) {
          if (clean.startsWith("@agentz/")) context.report({ node, messageId: "unknown", data: { target: clean } });
          return;
        }
        const configException = /^\w+\/[^/]+\/vitest\.config\.[cm]?[jt]s$/.test(slash(path.relative(root, filename)))
          && clean === "@agentz/vitest-preset";
        if (!configException && !allowed(source, target)) {
          context.report({ node, messageId: "boundary", data: { source, target } });
        }
      }
      return {
        ImportDeclaration: (node) => check(node.source),
        ExportNamedDeclaration: (node) => check(node.source),
        ExportAllDeclaration: (node) => check(node.source),
        ImportExpression: (node) => check(node.source),
        TSImportType: (node) => check(node.argument.type === "TSLiteralType" ? node.argument.literal : node.argument),
        TSExternalModuleReference: (node) => check(node.expression),
        CallExpression(node) {
          if (node.callee.type === "Identifier" && node.callee.name === "require") check(node.arguments[0]);
        },
      };
    },
  };
}
