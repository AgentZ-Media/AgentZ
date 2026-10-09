import { definePackageTest } from "@agentz/vitest-preset";

// Only for `pnpm bench:agent`: real model requests, never part of `pnpm test`.
export default definePackageTest({
  test: { include: ["bench/**/*.run.ts"], testTimeout: 2 * 60 * 60 * 1000 },
});
