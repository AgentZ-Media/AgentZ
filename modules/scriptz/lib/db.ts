// Database access for @agentz/scriptz.
//
// Until Phase 11 of the Rust → TS migration this file held the
// @tauri-apps/plugin-sql connection directly. With the core/ extraction
// in Phase 2A, the actual DB driver moved into the host app and is
// injected via the PlatformAdapter (see @agentz/kit/platform). The host calls
// setPlatformAdapter() at startup; core code keeps calling getDb() and
// getting back a connection that satisfies the DbConnection interface.
//
// The Tauri @tauri-apps/plugin-sql `Database` class satisfies
// `DbConnection` structurally - no wrapper needed. A future web build
// supplies an IndexedDB or sql.js-backed implementation.

import { getPlatformAdapter, type DbConnection } from "@agentz/kit/platform";

export type { DbConnection };

/** Live database connection. Delegates to the registered platform adapter. */
export function getDb(): Promise<DbConnection> {
  return getPlatformAdapter().getDb();
}
