import { t } from "../i18n";
import { flushAll } from "./saveFlush";

export class FlushError extends Error {
  constructor(readonly failed: readonly string[]) {
    super(t("persistence.saveFailed"));
    this.name = "FlushError";
  }
}

/** Gate operations that must read the latest persisted content. Failed UI
 *  state (layout, navigation, settings) does not block them. */
export async function requireSuccessfulFlush(timeoutMs = 2000): Promise<void> {
  const result = await flushAll(timeoutMs, ["content"]);
  if (result.contentFailed.length) throw new FlushError(result.contentFailed);
}
