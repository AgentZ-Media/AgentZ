// The public script counter at build time: pages ship with the latest sum and
// the browser refreshes it (scripts/script-count.ts). Builds without a backend
// or without network render the counter hidden.

/** Below this many scripts the counter stays hidden. */
export const MIN_SCRIPTS = 50;

let pending: Promise<number | null> | undefined;

export function scriptCount(): Promise<number | null> {
  pending ??= (async () => {
    const base = import.meta.env.PUBLIC_CONVEX_SITE_URL;
    if (!base) return null;
    try {
      const response = await fetch(`${base}/stats`, { signal: AbortSignal.timeout(5000) });
      if (!response.ok) return null;
      const body = await response.json() as { apps?: { scriptz?: { scripts?: unknown } } };
      const scripts = body.apps?.scriptz?.scripts;
      return typeof scripts === "number" && scripts >= MIN_SCRIPTS ? scripts : null;
    } catch {
      return null;
    }
  })();
  return pending;
}
