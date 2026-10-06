// Pure helpers for the multi-selection of the list pages (scripts overview
// and ideas page): tri-state of a group / "select all" checkbox, adding or
// removing a batch of ids and shift-click ranges.

export type CheckState = "none" | "some" | "all";

/** How many of `ids` are selected: none, some or all. An empty list is
 *  "none" (nothing to select). */
export function checkState(ids: readonly string[], selected: ReadonlySet<string>): CheckState {
  if (ids.length === 0) return "none";
  let hit = 0;
  for (const id of ids) if (selected.has(id)) hit++;
  if (hit === 0) return "none";
  return hit === ids.length ? "all" : "some";
}

/** Adds (`on`) or removes all `ids`, returning a new set. */
export function withIds(selected: ReadonlySet<string>, ids: readonly string[], on: boolean): Set<string> {
  const next = new Set(selected);
  for (const id of ids) {
    if (on) next.add(id);
    else next.delete(id);
  }
  return next;
}

/** Checkbox click on a group: a fully selected group is cleared, anything
 *  else (none, some) selects the whole group - like a file manager. */
export function toggleIds(selected: ReadonlySet<string>, ids: readonly string[]): Set<string> {
  return withIds(selected, ids, checkState(ids, selected) !== "all");
}

/** The ids from `from` to `to` (both included) in display order, or null
 *  when one of them isn't in `order`. */
export function rangeBetween(order: readonly string[], from: string, to: string): string[] | null {
  const a = order.indexOf(from);
  const b = order.indexOf(to);
  if (a < 0 || b < 0) return null;
  return a <= b ? order.slice(a, b + 1) : order.slice(b, a + 1);
}
