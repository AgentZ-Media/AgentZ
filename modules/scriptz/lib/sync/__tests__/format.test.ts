// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { SYNC_ENTITIES, SYNC_FIELDS, SYNC_FORMAT, SYNCED_SETTINGS } from "../adapter";
import format from "../format.json";

// format.json records what ScriptZ syncs. Any change to synced fields, entities
// or settings fails here until it is recorded, so nobody changes the sync
// format by accident. See docs/cloud-sync.md, "Versionen und Kompatibilität".
const HOW_TO = `
Synced data changed. Decide which kind of change it is (docs/cloud-sync.md):
- Additive (new field, entity or setting): record it in modules/scriptz/lib/sync/format.json,
  keep "reads" and "writes". Older versions keep the new data and pass it on.
- Breaking (rename, removal older versions would miss, changed meaning or type):
  first a release that raises "reads" and can read both forms, then a later
  release that raises "writes". \`pnpm check:sync-format\` enforces the order.`;

describe("sync format", () => {
  it("records every synced entity, field and setting", () => {
    const current = { entities: SYNC_FIELDS, settings: [...SYNCED_SETTINGS] };
    const recorded = { entities: format.entities, settings: format.settings };
    expect(current, HOW_TO).toEqual(recorded);
    expect(Object.keys(format.entities), "entities are listed in dependency order").toEqual([...SYNC_ENTITIES]);
  });

  it("writes a format it can read", () => {
    expect(Number.isInteger(SYNC_FORMAT.writes) && SYNC_FORMAT.writes >= 1).toBe(true);
    expect(Number.isInteger(SYNC_FORMAT.reads) && SYNC_FORMAT.reads >= SYNC_FORMAT.writes).toBe(true);
  });
});
