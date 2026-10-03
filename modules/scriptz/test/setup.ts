import { createSqlKvStore, getPlatformAdapter, setKvStore } from "@agentz/kit/platform";
// Tests explicitly install the SQL default; importing application code stays inert.
import { registerSqlStorageAdapter } from "../lib/api";

setKvStore(createSqlKvStore(() => getPlatformAdapter().getDb()));
registerSqlStorageAdapter();
