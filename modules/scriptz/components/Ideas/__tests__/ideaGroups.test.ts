// Tests for the ideas page helpers (components/Ideas/ideaGroups.ts).

import { beforeAll, describe, expect, it } from "vitest";
import { applyResolvedLanguage } from "@agentz/kit/i18n";
import { INBOX_FOLDER_ID } from "../../../lib/folders";
import type { Idea } from "../../../lib/types";
import {
  countNewThisWeek,
  folderCounts,
  groupIdeas,
  groupLabel,
  ideaAge,
  inFolder,
  scopeIdeas,
  sortIdeas,
  startOfWeek,
} from "../ideaGroups";

// Saturday 2026-10-03, 12:00 local. ISO week starts Monday 2026-09-28.
const NOW = new Date(2026, 9, 3, 12, 0, 0);
const at = (y: number, m: number, d: number, h = 10) => new Date(y, m, d, h, 0, 0).getTime();

let seq = 0;
function idea(partial: Partial<Idea>): Idea {
  seq++;
  return {
    id: partial.id ?? `i${seq}`,
    title: partial.title ?? `Idea ${seq}`,
    notes: partial.notes ?? "",
    created_at: partial.created_at ?? NOW.getTime(),
    used_at: partial.used_at ?? null,
    script_id: partial.script_id ?? null,
    folder_id: partial.folder_id ?? null,
  };
}

const cmp = (a: string, b: string) => a.localeCompare(b, "de");

beforeAll(() => applyResolvedLanguage("de"));

describe("startOfWeek", () => {
  it("is Monday 00:00 of the current week", () => {
    expect(startOfWeek(NOW)).toBe(new Date(2026, 8, 28, 0, 0, 0).getTime());
  });
  it("treats Sunday as the end of the week", () => {
    expect(startOfWeek(new Date(2026, 9, 4, 23, 0))).toBe(new Date(2026, 8, 28).getTime());
  });
  it("treats Monday as the start", () => {
    expect(startOfWeek(new Date(2026, 9, 5, 0, 30))).toBe(new Date(2026, 9, 5).getTime());
  });
});

describe("scope / folder filters", () => {
  const list = [
    idea({ id: "a", title: "Urlaub bewilligt", folder_id: "f1" }),
    idea({ id: "b", title: "Kaffeemaschine", notes: "Krisensitzung im Büro", folder_id: "f2" }),
    idea({ id: "c", title: "Faxgerät", used_at: 1, folder_id: "f1" }),
    idea({ id: "d", title: "Ohne Ordner" }),
  ];

  it("hides used ideas unless asked", () => {
    expect(scopeIdeas(list, { query: "", showUsed: false }).map((i) => i.id)).toEqual(["a", "b", "d"]);
    expect(scopeIdeas(list, { query: "", showUsed: true })).toHaveLength(4);
  });

  it("matches the query in title and notes, case-insensitive", () => {
    expect(scopeIdeas(list, { query: "BÜRO", showUsed: false }).map((i) => i.id)).toEqual(["b"]);
    expect(scopeIdeas(list, { query: " urlaub ", showUsed: false }).map((i) => i.id)).toEqual(["a"]);
  });

  it("filters by folder, inbox and all", () => {
    expect(inFolder(list, null)).toHaveLength(4);
    expect(inFolder(list, "f1").map((i) => i.id)).toEqual(["a", "c"]);
    expect(inFolder(list, INBOX_FOLDER_ID).map((i) => i.id)).toEqual(["d"]);
  });

  it("counts per folder plus the inbox", () => {
    const c = folderCounts(list);
    expect(c.byFolder.get("f1")).toBe(2);
    expect(c.byFolder.get("f2")).toBe(1);
    expect(c.inbox).toBe(1);
  });
});

describe("sortIdeas", () => {
  const list = [
    idea({ id: "x", title: "Beta", created_at: 2 }),
    idea({ id: "y", title: "alpha", created_at: 3 }),
    idea({ id: "z", title: "Gamma", created_at: 1 }),
  ];
  it("sorts newest / oldest / title", () => {
    expect(sortIdeas(list, "newest", cmp).map((i) => i.id)).toEqual(["y", "x", "z"]);
    expect(sortIdeas(list, "oldest", cmp).map((i) => i.id)).toEqual(["z", "x", "y"]);
    expect(sortIdeas(list, "title", cmp).map((i) => i.id)).toEqual(["y", "x", "z"]);
  });
  it("does not mutate the input", () => {
    sortIdeas(list, "title", cmp);
    expect(list.map((i) => i.id)).toEqual(["x", "y", "z"]);
  });
});

describe("groupIdeas", () => {
  const list = sortIdeas(
    [
      idea({ id: "w1", created_at: at(2026, 9, 2) }), // this week (Fri)
      idea({ id: "w2", created_at: at(2026, 8, 28, 0) }), // Monday 00:00 - this week
      idea({ id: "s1", created_at: at(2026, 8, 27, 23) }), // Sunday before - September
      idea({ id: "s2", created_at: at(2026, 8, 4) }),
      idea({ id: "a1", created_at: at(2026, 7, 15) }), // August
      idea({ id: "o1", created_at: at(2026, 6, 31) }), // July -> older (monthsBack 2)
      idea({ id: "o2", created_at: at(2025, 11, 1) }),
    ],
    "newest",
    cmp,
  );

  it("groups by week, month and older", () => {
    const groups = groupIdeas(list, "newest", NOW);
    expect(groups.map((g) => g.id)).toEqual(["week", "m-2026-8", "m-2026-7", "older"]);
    expect(groups[0].items.map((i) => i.id)).toEqual(["w1", "w2"]);
    expect(groups[1].items.map((i) => i.id)).toEqual(["s1", "s2"]);
    expect(groups[3].items.map((i) => i.id)).toEqual(["o1", "o2"]);
  });

  it("follows the sort order (oldest first starts with older)", () => {
    const oldest = sortIdeas(list, "oldest", cmp);
    expect(groupIdeas(oldest, "oldest", NOW).map((g) => g.id)).toEqual([
      "older",
      "m-2026-7",
      "m-2026-8",
      "week",
    ]);
  });

  it("uses one flat group for title sorting", () => {
    const groups = groupIdeas(list, "title", NOW);
    expect(groups).toHaveLength(1);
    expect(groups[0].kind).toBe("all");
    expect(groups[0].items).toHaveLength(list.length);
  });

  it("returns nothing for an empty list", () => {
    expect(groupIdeas([], "newest", NOW)).toEqual([]);
  });

  it("labels groups in the UI language", () => {
    const groups = groupIdeas(list, "newest", NOW);
    expect(groupLabel(groups[0], NOW)).toBe("Diese Woche");
    expect(groupLabel(groups[1], NOW)).toBe("September");
    expect(groupLabel(groups[3], NOW)).toBe("Älter");
    expect(groupLabel({ kind: "month", year: 2025, month: 11 }, NOW)).toBe("Dezember 2025");
  });
});

describe("countNewThisWeek", () => {
  it("counts open ideas created since Monday", () => {
    const list = [
      idea({ created_at: at(2026, 9, 1) }),
      idea({ created_at: at(2026, 9, 1), used_at: 5 }),
      idea({ created_at: at(2026, 8, 20) }),
    ];
    expect(countNewThisWeek(list, NOW)).toBe(1);
  });
});

describe("ideaAge", () => {
  const now = NOW.getTime();
  it("uses minutes, hours, yesterday, weekday, date", () => {
    expect(ideaAge(now - 20_000, now)).toBe("Gerade eben");
    expect(ideaAge(now - 2 * 60_000, now)).toBe("vor 2 Min.");
    expect(ideaAge(now - 15 * 3_600_000, now)).toBe("vor 15 Std.");
    expect(ideaAge(at(2026, 9, 1, 20), now)).toBe("Do");
    expect(ideaAge(at(2026, 8, 28), now)).toBe("Mo");
    expect(ideaAge(at(2026, 8, 12), now)).toMatch(/12\. Sept?\.?/);
    expect(ideaAge(at(2025, 8, 12), now)).toMatch(/2025/);
  });
  it("says yesterday for the previous calendar day beyond 24 h", () => {
    const late = new Date(2026, 9, 3, 23, 30).getTime();
    expect(ideaAge(at(2026, 9, 2, 8), late)).toBe("Gestern");
  });
});
