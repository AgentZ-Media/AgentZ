import { fileURLToPath } from "node:url";
import tseslint from "typescript-eslint";
import { createArchitectureRule } from "./tooling/checks/architecture.mjs";

const root = fileURLToPath(new URL(".", import.meta.url));

export default [
  {
    ignores: ["**/node_modules/**", "**/dist/**", "**/target/**", "**/coverage/**", "**/src-tauri/gen/**"],
  },
  {
    files: ["**/*.{js,mjs,cjs,ts,tsx,mts,cts}"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { agentz: { rules: { architecture: createArchitectureRule(root) } } },
    rules: {
      "agentz/architecture": "error",
      "constructor-super": "error",
      "for-direction": "error",
      "no-async-promise-executor": "error",
      "no-constant-binary-expression": "error",
      "no-debugger": "error",
      "no-dupe-args": "error",
      "no-dupe-else-if": "error",
      "no-duplicate-case": "error",
      "no-func-assign": "error",
      "no-import-assign": "error",
      "no-sparse-arrays": "error",
      "no-unsafe-finally": "error",
      "no-unsafe-negation": "error",
      "use-isnan": "error",
      "valid-typeof": "error",
    },
  },
];
