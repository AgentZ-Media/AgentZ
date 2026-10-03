import { t } from "../i18n";
import { flushAll } from "./saveFlush";

export class FlushError extends Error {
  constructor(readonly failed: readonly string[]) {
    super(t("persistence.saveFailed"));
    this.name = "FlushError";
  }
}

/** Gate operations that must read the latest persisted data. */
export async function requireSuccessfulFlush(timeoutMs = 2000): Promise<void> {
  const result = await flushAll(timeoutMs);
  if (!result.ok) throw new FlushError(result.failed);
}
