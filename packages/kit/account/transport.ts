import { ConvexClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import type { LatestReleases } from "../platform";
import type { CloudConfig, SyncBlock, SyncClient } from "./types";

// The Convex client for records. Function names mirror apps/site/convex
// (sync.ts, stats.ts, releases.ts). Loaded only once someone signs in.
// Every sync call carries the device's version and format (`client`); the
// backend answers CLIENT_OUTDATED when this device has to update first.

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

export interface Head {
  rev: number;
  /** Set while this device may not sync; null otherwise. */
  block: SyncBlock | null;
}

export interface CloudTransport {
  head(app: string, client: SyncClient): Promise<Head>;
  watchHead(app: string, client: SyncClient, onHead: (head: Head) => void, onError: (error: Error) => void): () => void;
  pull(app: string, client: SyncClient, afterRev: number): Promise<{ records: WireRecord[]; headRev: number; more: boolean }>;
  push(app: string, client: SyncClient, deviceId: string, changes: WireChange[]): Promise<{ results: PushResult[]; headRev: number }>;
  upload(app: string, client: SyncClient, bytes: Uint8Array): Promise<string>;
  /** Newest published versions of the app; optional for test transports. */
  watchReleases?(app: string, onReleases: (latest: LatestReleases) => void): () => void;
  report(app: string, client: SyncClient, counts: Record<string, number>): Promise<void>;
  download(url: string): Promise<Uint8Array>;
  connected(): boolean;
  close(): void;
}

type Client = { client: SyncClient };
const ref = {
  head: makeFunctionReference<"query", { app: string } & Client, Head>("sync:head"),
  pull: makeFunctionReference<"query", { app: string; afterRev: number } & Client, { records: WireRecord[]; headRev: number; more: boolean }>("sync:pull"),
  push: makeFunctionReference<"mutation", { app: string; deviceId: string; changes: WireChange[] } & Client, { results: PushResult[]; headRev: number }>("sync:push"),
  uploadUrl: makeFunctionReference<"mutation", { app: string } & Client, string>("sync:uploadUrl"),
  report: makeFunctionReference<"mutation", { app: string; counts: Record<string, number> } & Client, null>("stats:report"),
  releases: makeFunctionReference<"query", { app: string }, LatestReleases>("releases:latest"),
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

/** Exactly the validated fields: Convex rejects unknown ones. */
const wireClient = (device: SyncClient): SyncClient =>
  ({ version: device.version, channel: device.channel, reads: device.reads, writes: device.writes });

export function createConvexTransport(cloud: CloudConfig, sessionToken: string, onExpired: () => void): CloudTransport {
  const client = new ConvexClient(cloud.convexUrl, { unsavedChangesWarning: false });
  client.setAuth(() => fetchConvexToken(cloud, sessionToken, onExpired));
  return {
    head: (app, device) => client.query(ref.head, { app, client: wireClient(device) }),
    watchHead(app, device, onHead, onError) {
      const unsubscribe = client.onUpdate(ref.head, { app, client: wireClient(device) }, onHead, onError);
      return () => unsubscribe();
    },
    watchReleases(app, onReleases) {
      // Before the backend knows the query (older deployment) this simply errors once.
      const unsubscribe = client.onUpdate(ref.releases, { app }, onReleases, () => {});
      return () => unsubscribe();
    },
    pull: (app, device, afterRev) => client.query(ref.pull, { app, client: wireClient(device), afterRev }),
    push: (app, device, deviceId, changes) => client.mutation(ref.push, { app, client: wireClient(device), deviceId, changes }),
    async upload(app, device, bytes) {
      const url = await client.mutation(ref.uploadUrl, { app, client: wireClient(device) });
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: bytes.slice().buffer as ArrayBuffer });
      if (!response.ok) throw new Error(`upload failed (${response.status})`);
      const { storageId } = await response.json() as { storageId: string };
      return storageId;
    },
    report: async (app, device, counts) => { await client.mutation(ref.report, { app, client: wireClient(device), counts }); },
    async download(url) {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`download failed (${response.status})`);
      return new Uint8Array(await response.arrayBuffer());
    },
    connected: () => client.connectionState().isWebSocketConnected,
    close: () => { void client.close(); },
  };
}
