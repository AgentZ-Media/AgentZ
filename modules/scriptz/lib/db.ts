// Database access for @scriptz/core.
//
// Until Phase 11 of the Rust → TS migration this file held the
// @tauri-apps/plugin-sql connection directly. With the core/ extraction
// in Phase 2A, the actual DB driver moved into the host app and is
// injected via the PlatformAdapter (see ./platform.ts). The host calls
// setPlatformAdapter() at startup; core code keeps calling getDb() and
// getting back a connection that satisfies the DbConnection interface.
//
// The Tauri @tauri-apps/plugin-sql `Database` class satisfies
// `DbConnection` structurally - no wrapper needed. A future web build
// supplies an IndexedDB or sql.js-backed implementation.

import { getPlatformAdapter, type DbConnection } from "./platform";

export type { DbConnection };

/** Live database connection. Delegates to the registered platform adapter. */
export function getDb(): Promise<DbConnection> {
  return getPlatformAdapter().getDb();
}

// ===== settings =====
//
// Free-form string key-value store backing user preferences (theme,
// highlighting default, update-check flags, etc.).

export async function getSetting(key: string): Promise<string | null> {
  const db = await getDb();
  const rows = await db.select<{ value: string }[]>(
    "SELECT value FROM settings WHERE key = $1",
    [key],
  );
  return rows.length > 0 ? rows[0].value : null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    "INSERT INTO settings (key, value) VALUES ($1, $2) " +
      "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [key, value],
  );
}

// ===== app_state =====
//
// Same shape as settings but reserved for runtime state the user does
// not directly configure: open tabs, last-active folder, per-script
// quick-mode flags, welcome-script seed marker.

export async function getAppState(key: string): Promise<string | null> {
  const db = await getDb();
  const rows = await db.select<{ value: string }[]>(
    "SELECT value FROM app_state WHERE key = $1",
    [key],
  );
  return rows.length > 0 ? rows[0].value : null;
}

export async function setAppState(key: string, value: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    "INSERT INTO app_state (key, value) VALUES ($1, $2) " +
      "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [key, value],
  );
}
