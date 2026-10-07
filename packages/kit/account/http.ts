import type { AccountUser, CloudConfig, SyncBlock } from "./types";

// Plain HTTP calls of the account: app sign-in and session (Better Auth routes
// on the deployment's site URL). No Convex client, so signed-out apps never
// load it (transport.ts is imported on demand).

/** Thrown for a missing or expired session; the user must sign in again. */
export class SessionExpiredError extends Error {
  constructor() { super("Session expired"); this.name = "SessionExpiredError"; }
}

/** Thrown while the backend does not let this version sync; an update helps. */
export class ClientOutdatedError extends Error {
  constructor(readonly block: SyncBlock) { super("App update required for sync"); this.name = "ClientOutdatedError"; }
}

/** Convex errors carry `data.code` (ConvexError on the server). */
export const errorCode = (error: unknown): string | undefined => {
  const data = (error as { data?: unknown } | null)?.data;
  return data && typeof data === "object" && typeof (data as { code?: unknown }).code === "string"
    ? (data as { code: string }).code
    : undefined;
};

/** The reason carried by a CLIENT_OUTDATED error (apps/site/convex/compat.ts). */
export function blockOf(error: unknown): SyncBlock {
  const block = ((error as { data?: { block?: unknown } } | null)?.data?.block ?? null) as Partial<SyncBlock> | null;
  if (block?.reason === "format" && typeof block.format === "number") {
    return { reason: "format", format: block.format, by: typeof block.by === "string" ? block.by : null };
  }
  const minVersion = block?.reason === "version" && typeof block.minVersion === "string" ? block.minVersion : null;
  return { reason: "version", minVersion };
}

async function postJson(url: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
}

/** Exchanges the code from the website for a session token (convex/appLink.ts). */
export async function claimSession(cloud: CloudConfig, code: string, verifier: string): Promise<string> {
  const response = await postJson(`${cloud.siteUrl}/app-link/claim`, { code, verifier });
  const body = await response.json().catch(() => ({})) as { token?: string; error?: string };
  if (!response.ok || !body.token) throw new Error(body.error ?? `claim failed (${response.status})`);
  return body.token;
}

/** The signed-in user, or throws SessionExpiredError. Network errors propagate. */
export async function fetchUser(cloud: CloudConfig, token: string): Promise<AccountUser> {
  const response = await fetch(`${cloud.siteUrl}/api/auth/get-session`, { headers: { Authorization: `Bearer ${token}` } });
  if (response.status === 401) throw new SessionExpiredError();
  if (!response.ok) throw new Error(`session request failed (${response.status})`);
  const body = await response.json() as { user?: { id: string; name: string; email: string } } | null;
  if (!body?.user) throw new SessionExpiredError();
  return { id: body.user.id, name: body.user.name, email: body.user.email };
}

export async function revokeSession(cloud: CloudConfig, token: string): Promise<void> {
  await postJson(`${cloud.siteUrl}/api/auth/sign-out`, {}, { Authorization: `Bearer ${token}` });
}
