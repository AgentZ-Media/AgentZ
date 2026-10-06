// @vitest-environment node
// Search queries against a real FTS5 table with the tokenizer from the
// baseline migration.
import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { sanitizeFtsQuery } from "../fts";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");

function index(text: string) {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE VIRTUAL TABLE scripts_fts USING fts5(script_id UNINDEXED, title, content_text, tokenize='unicode61 remove_diacritics 2')");
  db.prepare("INSERT INTO scripts_fts (script_id, title, content_text) VALUES ('s1', '', ?)").run(text);
  return (query: string) => {
    const match = sanitizeFtsQuery(query);
    return (db.prepare("SELECT count(*) AS n FROM scripts_fts WHERE scripts_fts MATCH ?").get(match) as { n: number }).n;
  };
}

describe("sanitizeFtsQuery", () => {
  it("quotes words and makes the last one a prefix", () => {
    expect(sanitizeFtsQuery("  Hallo Welt ")).toBe('"hallo" "welt"*');
    expect(sanitizeFtsQuery('sag "hi"')).toBe('"sag" "hi"*');
    expect(sanitizeFtsQuery(" ,.; ")).toBe("");
  });

  it("finds German words with and without diacritics", () => {
    const hits = index("Müller sagt hallo zur Straße");
    expect(hits("müller")).toBe(1);
    expect(hits("muller sagt")).toBe(1);
    expect(hits("stra")).toBe(1);
    expect(hits("hallo welt")).toBe(0);
  });

  it("keeps a CJK run together like the index does", () => {
    const hits = index("我喜欢中文 und abc中文");
    expect(sanitizeFtsQuery("我喜欢")).toBe('"我喜欢"*');
    expect(hits("我喜欢")).toBe(1);
    expect(hits("我喜欢中文")).toBe(1);
    expect(hits("abc中")).toBe(1);
  });
});
