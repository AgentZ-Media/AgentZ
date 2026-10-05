import { getDb } from "../db";
import { CONTENT_ENTITIES, type ContentEntity } from "./entities";
import type { LocalChange, LocalChangeStore } from "./types";

// Identifiers come exclusively from the static schema catalog, never user input.
const recordsSql = Object.entries(CONTENT_ENTITIES).map(([entity, config]) => {
  const key = entity === "character_colors" ? `upper(r.${config.key})` : `r.${config.key}`;
  const fields = config.columns.map((column) => `'${column}', r.${column}`).join(", ");
  return `WHEN '${entity}' THEN (SELECT json_object(${fields}) FROM ${entity} r WHERE ${key} = p.entity_id)`;
}).join("\n");

interface ChangeRow {
  replica_id: string;
  sequence: number | null;
  entity: ContentEntity;
  entity_id: string;
  operation: "upsert" | "delete";
  record_json: string | null;
}

export const sqlLocalChanges: LocalChangeStore = {
  async getReplicaId() {
    const db = await getDb();
    const rows = await db.select<{ replica_id: string }[]>(
      "SELECT replica_id FROM local_replica WHERE singleton = 1",
    );
    if (!rows[0]) throw new Error("Local change tracking migration is missing");
    return rows[0].replica_id;
  },

  async readChanges({ afterSequence = 0, limit = 100 } = {}) {
    if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) {
      throw new Error("Invalid local change cursor");
    }
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) {
      throw new Error("Local change page size must be between 1 and 1000");
    }
    const db = await getDb();
    // One SQLite statement reads metadata AND payloads from one snapshot.
    // Reading metadata first and content later could pair a revision with the
    // wrong content while the editor is saving. Limit before loading payloads.
    const rows = await db.select<ChangeRow[]>(
      `WITH page AS (
         SELECT sequence, entity, entity_id, operation FROM local_changes
         WHERE sequence > $1 ORDER BY sequence LIMIT $2
       )
       SELECT replica.replica_id, p.sequence, p.entity, p.entity_id, p.operation,
         CASE WHEN p.operation = 'upsert' THEN CASE p.entity
           ${recordsSql}
         END ELSE NULL END AS record_json
       FROM local_replica replica LEFT JOIN page p ON 1 = 1
       WHERE replica.singleton = 1 ORDER BY p.sequence`,
      [afterSequence, limit],
    );
    if (!rows[0]) throw new Error("Local change tracking migration is missing");
    const replicaId = rows[0].replica_id;
    const changes: LocalChange[] = [];
    for (const row of rows) {
      if (row.sequence === null) continue;
      if (!Number.isSafeInteger(row.sequence)) throw new Error("Local change sequence exceeds safe integer range");
      if (row.operation === "upsert" && row.record_json === null) {
        throw new Error(`Tracked content is missing: ${row.entity}/${row.entity_id}`);
      }
      changes.push({
        entity: row.entity,
        entityId: row.entity_id,
        sequence: row.sequence,
        changeId: `${replicaId}:${row.sequence}`,
        operation: row.operation,
        record: row.record_json === null ? null : JSON.parse(row.record_json),
      } as LocalChange);
    }
    return {
      formatVersion: 1,
      replicaId,
      changes,
      nextCursor: changes.at(-1)?.sequence ?? afterSequence,
    };
  },
};
