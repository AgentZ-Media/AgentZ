import type { ContentEntity, ContentRow } from "./entities";

export type { ContentEntity, ContentRow, ContentValue } from "./entities";

/** Sequences belong to ONE local replica, never to a wall clock or cloud
 * revision. A future transport must namespace cursors by account + replica.
 * Repeating a read returns the same changeId until that record changes again. */
export type LocalChange = {
  [E in ContentEntity]: {
    entity: E;
    entityId: string;
    sequence: number;
    changeId: string;
  } & ({ operation: "upsert"; record: ContentRow<E> } | { operation: "delete"; record: null });
}[ContentEntity];

export interface LocalChangePage {
  formatVersion: 1;
  replicaId: string;
  changes: LocalChange[];
  /** Last returned sequence, or the supplied cursor when the page is empty.
   * Advance a future remote checkpoint only after that whole page is accepted. */
  nextCursor: number;
}

/** Local-only preparation. This is a coalesced feed of current records and
 * tombstones, NOT an audit log or a cross-device conflict resolver. No method
 * uploads data, marks it synchronized, removes tombstones or rewrites content.
 * Settings/UI state never enter this feed. */
export interface LocalChangeStore {
  getReplicaId(): Promise<string>;
  readChanges(options?: { afterSequence?: number; limit?: number }): Promise<LocalChangePage>;
}
