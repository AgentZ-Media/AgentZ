// Which app versions may sync. Pure functions without Convex imports: sync.ts
// applies them, tests/compat.test.mjs runs them without a deployment.
//
// Two independent gates (docs/cloud-sync.md, "Versionen und Kompatibilität"):
// - Format: every device reports the sync format it writes and the highest it
//   can read. The account remembers the highest format ever written; a device
//   that cannot read it pauses until it is updated. Raised by data, not by a
//   deploy, and only for the account that actually has newer data.
// - Policy: per app a minimum version and blocked versions, set by hand
//   (syncPolicy.ts) for emergencies such as a version that writes bad data.
// A third, fixed gate belongs to the deployment: formats the server no longer
// accepts at all (MIN_FORMAT in syncApps.ts).

/** What a device reports with every sync call. */
export interface ClientInfo {
  /** App version, SemVer (`0.10.0`, `0.10.1-nightly.202610071200`). */
  version: string;
  /** Highest sync format this version can read. */
  reads: number;
  /** Sync format this version writes. */
  writes: number;
  /** Build channel: "stable", "nightly" or "dev". */
  channel?: string;
}

export interface SyncPolicy {
  minVersion?: string;
  blockedVersions?: string[];
}

/** Highest format written for one account and app, and the version that wrote it. */
export interface FormatMark {
  format: number;
  by: string | null;
}

export type SyncBlock =
  | { reason: "format"; format: number; by: string | null }
  | { reason: "version"; minVersion: string | null };

/** Formats are small positive integers; anything else is a broken client. */
const MAX_FORMAT = 1000;

interface Parsed {
  core: [number, number, number];
  pre: (number | string)[];
}

const SEMVER = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z.-]+)?$/;

export function parseVersion(value: string): Parsed | null {
  const match = SEMVER.exec(value.trim());
  if (!match) return null;
  const core: [number, number, number] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (!core.every(Number.isSafeInteger)) return null;
  const pre = match[4] ? match[4].split(".").map((part) => (/^\d+$/.test(part) ? Number(part) : part)) : [];
  return { core, pre };
}

/** SemVer precedence: negative if a < b, 0 if equal, positive if a > b. Null if either is invalid. */
export function compareVersions(a: string, b: string): number | null {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return null;
  for (let i = 0; i < 3; i++) {
    if (left.core[i] !== right.core[i]) return left.core[i] - right.core[i];
  }
  // A pre-release (nightly, rc) is older than the release of the same version.
  if (left.pre.length === 0 || right.pre.length === 0) return right.pre.length - left.pre.length;
  for (let i = 0; i < Math.min(left.pre.length, right.pre.length); i++) {
    const x = left.pre[i];
    const y = right.pre[i];
    if (x === y) continue;
    if (typeof x === "number" && typeof y === "number") return x - y;
    if (typeof x === "number") return -1;
    if (typeof y === "number") return 1;
    return x < y ? -1 : 1;
  }
  return left.pre.length - right.pre.length;
}

const isFormat = (value: number) => Number.isInteger(value) && value >= 1 && value <= MAX_FORMAT;

/** A client that reports a parseable version and a consistent format pair. */
export function validClient(client: ClientInfo | undefined | null): client is ClientInfo {
  return !!client
    && typeof client.version === "string" && parseVersion(client.version) !== null
    && isFormat(client.reads) && isFormat(client.writes) && client.writes <= client.reads;
}

/**
 * Format mark of an account. Accounts that synced before format numbers
 * existed hold format 1 data: that is what those versions wrote.
 */
export function markOf(head: { rev: number; format?: number; formatBy?: string } | null): FormatMark {
  if (!head) return { format: 0, by: null };
  return { format: head.format ?? (head.rev > 0 ? 1 : 0), by: head.formatBy ?? null };
}

/**
 * Why this client may not sync, or null when it may. `minFormat` is the oldest
 * format the server accepts; a version writing an older one is outdated.
 */
export function blockFor(client: ClientInfo | undefined | null, mark: FormatMark, policy: SyncPolicy | null, minFormat = 1): SyncBlock | null {
  const minVersion = policy?.minVersion ?? null;
  // Versions from before the compatibility check report nothing at all.
  if (!validClient(client)) return { reason: "version", minVersion };
  const blocked = (policy?.blockedVersions ?? []).some((version) => compareVersions(version, client.version) === 0);
  if (blocked) return { reason: "version", minVersion };
  if (minVersion !== null) {
    const order = compareVersions(client.version, minVersion);
    if (order === null || order < 0) return { reason: "version", minVersion };
  }
  if (client.writes < minFormat) return { reason: "version", minVersion };
  if (mark.format > client.reads) return { reason: "format", format: mark.format, by: mark.by };
  return null;
}

/** The mark after this client wrote records, or null if it stays. */
export function raisedMark(client: ClientInfo, mark: FormatMark): FormatMark | null {
  return client.writes > mark.format ? { format: client.writes, by: client.version } : null;
}

/**
 * Development builds talk to production by default and share the developer's
 * real account. They may start a fresh account's format, but never move an
 * account with data to a newer format: that would pause every installed
 * version of the developer. The dev deployment allows it (ALLOW_DEV_FORMAT_RAISE).
 */
export function devRaiseDenied(client: ClientInfo, mark: FormatMark, allowDev: boolean): boolean {
  return client.channel === "dev" && !allowDev && mark.format > 0 && client.writes > mark.format;
}

/** Validates a policy before it is stored; returns an error text or null. */
export function policyError(policy: SyncPolicy): string | null {
  if (policy.minVersion !== undefined && !parseVersion(policy.minVersion)) return `invalid minVersion: ${policy.minVersion}`;
  for (const version of policy.blockedVersions ?? []) {
    if (!parseVersion(version)) return `invalid blocked version: ${version}`;
  }
  return null;
}
