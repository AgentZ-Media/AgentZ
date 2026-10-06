import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://agentz-suite.com",
  output: "static",
  trailingSlash: "always",
  devToolbar: { enabled: false },
});
