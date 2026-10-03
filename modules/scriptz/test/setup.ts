// Tests explicitly install the SQL default; importing application code stays inert.
import { registerSqlStorageAdapter } from "../lib/api";

registerSqlStorageAdapter();
