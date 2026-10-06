import type { DbConnection } from "@agentz/kit/platform";
import { describe, expect, it } from "vitest";
import { assertFolderExists } from "../folders";

function fakeDb(folderIds: string[]): DbConnection & { queries: string[] } {
  const queries: string[] = [];
  return {
    queries,
    async select<T>(query: string, params: unknown[] = []): Promise<T> {
      queries.push(query);
      const n = folderIds.includes(params[0] as string) ? 1 : 0;
      return [{ n }] as T;
    },
    async execute() {
      throw new Error("unexpected execute");
    },
  } as DbConnection & { queries: string[] };
}

describe("assertFolderExists", () => {
  it("resolves for an existing folder", async () => {
    const db = fakeDb(["f1"]);
    await expect(assertFolderExists(db, "f1")).resolves.toBeUndefined();
    expect(db.queries).toEqual(["SELECT COUNT(*) AS n FROM folders WHERE id = $1"]);
  });

  it("throws the not-found error for a missing folder", async () => {
    await expect(assertFolderExists(fakeDb([]), "gone")).rejects.toThrow("not found: folder gone");
  });
});
