// Pure helpers for the ideas page: filtering, sorting, time grouping and
// the compact age label. Kept free of Solid so they are unit-testable.

import { INBOX_FOLDER_ID } from "../../lib/folders";
import { formatDate } from "@agentz/kit/i18n";
import { t } from "../../i18n";
import type { Idea } from "../../lib/types";

export type IdeaSort = "newest" | "oldest" | "title";

export interface IdeaFilter {
  /** Free-text filter over title + notes (case-insensitive). */
  query: string;
  /** null = every folder, INBOX_FOLDER_ID = ideas without folder, else id. */
  folderId: string | null;
  /** Include converted ("used") ideas. Open ideas are always included. */
  showUsed: boolean;
}

type IdeaLike = Pick<Idea, "title" | "notes" | "created_at" | "used_at" | "folder_id">;

/** Local Monday 00:00 of the week containing `now` (ISO week, like the
 *  writing stats). */
export function startOfWeek(now: Date): number {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dow = (d.getDay() + 6) % 7; // Mon = 0 ... Sun = 6
  d.setDate(d.getDate() - dow);
  return d.getTime();
}

/** Applies query + used filter, but NOT the folder filter. This is the
 *  scope the folder chips count over, so a chip's number matches what
 *  selecting it would show. */
export function scopeIdeas<T extends IdeaLike>(items: T[], filter: Omit<IdeaFilter, "folderId">): T[] {
  const q = filter.query.trim().toLowerCase();
  return items.filter((i) => {
    if (!filter.showUsed && i.used_at) return false;
    if (q && !`${i.title}\n${i.notes}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

/** Folder filter on top of `scopeIdeas`. */
export function inFolder<T extends IdeaLike>(items: T[], folderId: string | null): T[] {
  if (folderId === null) return items;
  if (folderId === INBOX_FOLDER_ID) return items.filter((i) => !i.folder_id);
  return items.filter((i) => i.folder_id === folderId);
}

/** Idea counts per folder id plus the ungrouped ("inbox") count. */
export function folderCounts<T extends IdeaLike>(items: T[]): { byFolder: Map<string, number>; inbox: number } {
  const byFolder = new Map<string, number>();
  let inbox = 0;
  for (const i of items) {
    if (i.folder_id) byFolder.set(i.folder_id, (byFolder.get(i.folder_id) ?? 0) + 1);
    else inbox++;
  }
  return { byFolder, inbox };
}

export function sortIdeas<T extends IdeaLike>(
  items: T[],
  sort: IdeaSort,
  compare: (a: string, b: string) => number,
): T[] {
  const list = items.slice();
  list.sort((a, b) => {
    if (sort === "title") return compare(a.title, b.title) || b.created_at - a.created_at;
    if (sort === "oldest") return a.created_at - b.created_at;
    return b.created_at - a.created_at;
  });
  return list;
}

export interface IdeaGroup<T> {
  /** Stable key, e.g. "week", "m-2026-8", "older", "all". */
  id: string;
  kind: "week" | "month" | "older" | "all";
  /** Calendar year/month (0-based) for kind "month"; -1 otherwise. */
  year: number;
  month: number;
  items: T[];
}

/** Groups an already sorted list by creation time: "this week", then one
 *  group per calendar month for the current month and `monthsBack` months
 *  before it, everything earlier in "older". Group order follows the list
 *  order (oldest-first sorting yields "older" first). Title sorting has no
 *  time groups - one "all" group. */
export function groupIdeas<T extends IdeaLike>(
  sorted: T[],
  sort: IdeaSort,
  now: Date,
  monthsBack = 2,
): IdeaGroup<T>[] {
  if (sorted.length === 0) return [];
  if (sort === "title") {
    return [{ id: "all", kind: "all", year: -1, month: -1, items: sorted.slice() }];
  }
  const weekStart = startOfWeek(now);
  const firstMonth = new Date(now.getFullYear(), now.getMonth() - monthsBack, 1).getTime();
  const groups: IdeaGroup<T>[] = [];
  const byId = new Map<string, IdeaGroup<T>>();
  for (const idea of sorted) {
    let key: string;
    let kind: IdeaGroup<T>["kind"];
    let year = -1;
    let month = -1;
    if (idea.created_at >= weekStart) {
      key = "week";
      kind = "week";
    } else if (idea.created_at >= firstMonth) {
      const d = new Date(idea.created_at);
      year = d.getFullYear();
      month = d.getMonth();
      key = `m-${year}-${month}`;
      kind = "month";
    } else {
      key = "older";
      kind = "older";
    }
    let g = byId.get(key);
    if (!g) {
      g = { id: key, kind, year, month, items: [] };
      byId.set(key, g);
      groups.push(g);
    }
    g.items.push(idea);
  }
  return groups;
}

/** Number of open (unconverted) ideas created this week. */
export function countNewThisWeek(items: IdeaLike[], now: Date): number {
  const ws = startOfWeek(now);
  return items.filter((i) => !i.used_at && i.created_at >= ws).length;
}

/** Compact age for the 36 px rows: "vor 2 Min.", "vor 15 Std.", "Gestern",
 *  "Mo", "28. Sep" (year added when it differs). */
export function ideaAge(ms: number, now: number): string {
  const diff = Math.max(0, now - ms);
  const min = diff / 60_000;
  if (min < 1) return t("time.justNow");
  if (min < 60) return t("time.minutesAgo", { n: Math.floor(min) });
  const hours = min / 60;
  if (hours < 24) return t("time.hoursAgo", { n: Math.floor(hours) });
  const startToday = new Date(now);
  startToday.setHours(0, 0, 0, 0);
  const startYesterday = new Date(startToday);
  startYesterday.setDate(startYesterday.getDate() - 1);
  if (ms >= startYesterday.getTime()) return t("time.yesterday");
  const date = new Date(ms);
  if (now - ms < 6 * 86_400_000) {
    return t(`weekday.short.${date.getDay()}` as
      | "weekday.short.0" | "weekday.short.1" | "weekday.short.2" | "weekday.short.3"
      | "weekday.short.4" | "weekday.short.5" | "weekday.short.6");
  }
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return formatDate(date, {
    day: "numeric",
    month: "short",
    year: sameYear ? undefined : "numeric",
  });
}

/** Group heading label. Month groups use the locale's month name (plus the
 *  year when it isn't the current one). */
export function groupLabel(g: Pick<IdeaGroup<unknown>, "kind" | "year" | "month">, now: Date): string {
  if (g.kind === "week") return t("ideasPage.group.week");
  if (g.kind === "older") return t("ideasPage.group.older");
  if (g.kind === "all") return t("ideasPage.group.all");
  const d = new Date(g.year, g.month, 1);
  return formatDate(d, {
    month: "long",
    year: g.year === now.getFullYear() ? undefined : "numeric",
  });
}
