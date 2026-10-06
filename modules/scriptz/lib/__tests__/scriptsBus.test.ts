import { describe, expect, it } from "vitest";
import { withSavedContent } from "../scriptsBus";
import type { ScriptSummary } from "../types";

const row: ScriptSummary = {
  id: "s1",
  title: "Renamed",
  highlighting_enabled: null,
  created_at: 1,
  updated_at: 300,
  archived_at: null,
  page_count: 1,
  word_count: 10,
  dialog_word_count: 4,
  direction_block_count: 1,
  characters: [],
  folder_id: "f-new",
  status: "draft",
  status_changed_at: 250,
};

describe("withSavedContent", () => {
  it("takes the content fields from a save read before a rename or move", () => {
    const saved: ScriptSummary = {
      ...row,
      title: "Old title",
      folder_id: "f-old",
      status: "idea",
      status_changed_at: null,
      updated_at: 200,
      page_count: 2,
      word_count: 42,
      dialog_word_count: 20,
      direction_block_count: 3,
      characters: [{ name: "ANNA", color: "#e5484d" }],
    };
    const merged = withSavedContent(row, saved);
    expect(merged).toMatchObject({
      title: "Renamed",
      folder_id: "f-new",
      status: "draft",
      status_changed_at: 250,
      updated_at: 300,
      page_count: 2,
      word_count: 42,
      dialog_word_count: 20,
      direction_block_count: 3,
    });
    expect(merged.characters).toBe(saved.characters);
  });

  it("moves updated_at forward for a newer save", () => {
    expect(withSavedContent(row, { ...row, updated_at: 400 }).updated_at).toBe(400);
  });
});
