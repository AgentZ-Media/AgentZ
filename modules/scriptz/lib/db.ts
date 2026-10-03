// Database access for @agentz/scriptz.
//
// The DB driver lives in the host and is injected via the PlatformAdapter
// (see @agentz/kit/platform). The Tauri plugin-sql `Database` class
// satisfies `DbConnection` structurally - no wrapper needed. A future web
// host would supply its own implementation of the same interface.

import { getPlatformAdapter, type DbConnection } from "@agentz/kit/platform";

export type { DbConnection };

/** Live database connection. Delegates to the registered platform adapter. */
export function getDb(): Promise<DbConnection> {
  return getPlatformAdapter().getDb();
}
