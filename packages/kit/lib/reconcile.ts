// Identity-preserving list reloads.
//
// Solid's <For> keys rows by object identity. A reload that returns fresh
// objects for unchanged records therefore rebuilds every row's DOM, and
// every memo downstream recomputes. `keepUnchanged` hands the previous
// object back wherever the record did not change, and the previous array
// itself when nothing changed at all - then the signal holding it does not
// even notify.

/** Plain-data equality for records loaded from storage: primitives by
 *  value, arrays element-wise, plain objects key by key. */
export function sameData(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!sameData(a[i], b[i])) return false;
    return true;
  }
  if (Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (!Object.hasOwn(b, k)) return false;
    if (!sameData((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
  }
  return true;
}

/** `next`, with every record that equals its predecessor (same `id`)
 *  replaced by the previous object. Returns `prev` itself when both lists
 *  hold the same records in the same order. */
export function keepUnchanged<T extends { id: string }>(
  prev: readonly T[] | undefined,
  next: T[],
  same: (a: T, b: T) => boolean = sameData,
): T[] {
  if (!prev || prev.length === 0) return next;
  const byId = new Map<string, T>();
  for (const item of prev) byId.set(item.id, item);
  let identical = prev.length === next.length;
  const out = next.map((item, i) => {
    const old = byId.get(item.id);
    const kept = old !== undefined && same(old, item) ? old : item;
    if (kept !== prev[i]) identical = false;
    return kept;
  });
  return identical ? (prev as T[]) : out;
}
