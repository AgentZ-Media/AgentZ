import { ConvexClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import type { CloudConfig } from "./types";

// The Convex client for records. Function names mirror apps/site/convex/sync.ts.
// Loaded only once someone signs in.

export interface WireRecord {
  recordId: string;
  rev: number;
  deleted: boolean;
  data?: ArrayBuffer;
  blobUrl?: string;
  /** Set only on end-to-end encrypted records of older app versions; devices skip them. */
  keyId?: string;
  deviceId: string;
}

export interface WireChange {
  recordId: string;
  baseRev: number;
  deleted: boolean;
  data?: ArrayBuffer;
  blob?: string;
  size: number;
}

export type PushResult =
  | { recordId: string; status: "ok"; rev: number }
  | { recordId: string; status: "conflict"; rev: number; current: WireRecord | null };

export interface Head { rev: number }

export interface CloudTransport {
  head(app: string): Promise<Head>;
  watchHead(app: string, onHead: (head: Head) => void, onError: (error: Error) => void): () => void;
  pull(app: string, afterRev: number): Promise<{ records: WireRecord[]; headRev: number; more: boolean }>;
  push(app: string, deviceId: string, changes: WireChange[]): Promise<{ results: PushResult[]; headRev: number }>;
  upload(bytes: Uint8Array): Promise<string>;
  download(url: string): Promise<Uint8Array>;
  connected(): boolean;
  close(): void;
}

const ref = {
  head: makeFunctionReference<"query", { app: string }, Head>("sync:head"),
  pull: makeFunctionReference<"query", { app: string; afterRev: number }, { records: WireRecord[]; headRev: number; more: boolean }>("sync:pull"),
  push: makeFunctionReference<"mutation", { app: string; deviceId: string; changes: WireChange[] }, { results: PushResult[]; headRev: number }>("sync:push"),
  uploadUrl: makeFunctionReference<"mutation", Record<string, never>, string>("sync:uploadUrl"),
};

/** Short-lived JWT for Convex; null when the session is gone. */
async function fetchConvexToken(cloud: CloudConfig, token: string, onExpired: () => void): Promise<string | null> {
  try {
    const response = await fetch(`${cloud.siteUrl}/api/auth/convex/token`, { headers: { Authorization: `Bearer ${token}` } });
    if (response.status === 401) { onExpired(); return null; }
    if (!response.ok) return null;
    const body = await response.json() as { token?: string };
    return body.token ?? null;
  } catch {
    return null;
  }
}

export function createConvexTransport(cloud: CloudConfig, sessionToken: string, onExpired: () => void): CloudTransport {
  const client = new ConvexClient(cloud.convexUrl, { unsavedChangesWarning: false });
  client.setAuth(() => fetchConvexToken(cloud, sessionToken, onExpired));
  return {
    head: (app) => client.query(ref.head, { app }),
    watchHead(app, onHead, onError) {
      const unsubscribe = client.onUpdate(ref.head, { app }, onHead, onError);
      return () => unsubscribe();
    },
    pull: (app, afterRev) => client.query(ref.pull, { app, afterRev }),
    push: (app, deviceId, changes) => client.mutation(ref.push, { app, deviceId, changes }),
    async upload(bytes) {
      const url = await client.mutation(ref.uploadUrl, {});
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: bytes.slice().buffer as ArrayBuffer });
      if (!response.ok) throw new Error(`upload failed (${response.status})`);
      const { storageId } = await response.json() as { storageId: string };
      return storageId;
    },
    async download(url) {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`download failed (${response.status})`);
      return new Uint8Array(await response.arrayBuffer());
    },
    connected: () => client.connectionState().isWebSocketConnected,
    close: () => { void client.close(); },
  };
}
