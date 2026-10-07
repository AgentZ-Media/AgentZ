import { ConvexClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import type { CloudConfig } from "./types";

// The Convex client for keys and records. Function names mirror
// apps/site/convex (keys.ts, sync.ts, stats.ts). Loaded only once someone signs in.

export interface WireRecord {
  recordId: string;
  rev: number;
  deleted: boolean;
  data?: ArrayBuffer;
  blobUrl?: string;
  keyId: string;
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

export interface Head { rev: number; keyId: string | null; resetting: boolean }
export interface WrappedKey { keyId: string; wrapped: ArrayBuffer; resetting: boolean }

export interface CloudTransport {
  head(app: string): Promise<Head>;
  watchHead(app: string, onHead: (head: Head) => void, onError: (error: Error) => void): () => void;
  pull(app: string, afterRev: number): Promise<{ records: WireRecord[]; headRev: number; more: boolean }>;
  push(app: string, keyId: string, deviceId: string, changes: WireChange[]): Promise<{ results: PushResult[]; headRev: number }>;
  upload(bytes: Uint8Array): Promise<string>;
  report(app: string, counts: Record<string, number>): Promise<void>;
  download(url: string): Promise<Uint8Array>;
  getKey(): Promise<WrappedKey | null>;
  createKey(keyId: string, wrapped: ArrayBuffer): Promise<void>;
  rewrapKey(keyId: string, wrapped: ArrayBuffer): Promise<void>;
  resetKey(keyId: string, wrapped: ArrayBuffer): Promise<void>;
  connected(): boolean;
  close(): void;
}

const ref = {
  head: makeFunctionReference<"query", { app: string }, Head>("sync:head"),
  pull: makeFunctionReference<"query", { app: string; afterRev: number }, { records: WireRecord[]; headRev: number; more: boolean }>("sync:pull"),
  push: makeFunctionReference<"mutation", { app: string; keyId: string; deviceId: string; changes: WireChange[] }, { results: PushResult[]; headRev: number }>("sync:push"),
  report: makeFunctionReference<"mutation", { app: string; counts: Record<string, number> }, null>("stats:report"),
  uploadUrl: makeFunctionReference<"mutation", Record<string, never>, string>("sync:uploadUrl"),
  getKey: makeFunctionReference<"query", Record<string, never>, WrappedKey | null>("keys:get"),
  createKey: makeFunctionReference<"mutation", { keyId: string; wrapped: ArrayBuffer }, null>("keys:create"),
  rewrapKey: makeFunctionReference<"mutation", { keyId: string; wrapped: ArrayBuffer }, null>("keys:rewrap"),
  resetKey: makeFunctionReference<"mutation", { keyId: string; wrapped: ArrayBuffer }, null>("keys:reset"),
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
    push: (app, keyId, deviceId, changes) => client.mutation(ref.push, { app, keyId, deviceId, changes }),
    async upload(bytes) {
      const url = await client.mutation(ref.uploadUrl, {});
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: bytes.slice().buffer as ArrayBuffer });
      if (!response.ok) throw new Error(`upload failed (${response.status})`);
      const { storageId } = await response.json() as { storageId: string };
      return storageId;
    },
    report: async (app, counts) => { await client.mutation(ref.report, { app, counts }); },
    async download(url) {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`download failed (${response.status})`);
      return new Uint8Array(await response.arrayBuffer());
    },
    getKey: () => client.query(ref.getKey, {}),
    createKey: async (keyId, wrapped) => { await client.mutation(ref.createKey, { keyId, wrapped }); },
    rewrapKey: async (keyId, wrapped) => { await client.mutation(ref.rewrapKey, { keyId, wrapped }); },
    resetKey: async (keyId, wrapped) => { await client.mutation(ref.resetKey, { keyId, wrapped }); },
    connected: () => client.connectionState().isWebSocketConnected,
    close: () => { void client.close(); },
  };
}
