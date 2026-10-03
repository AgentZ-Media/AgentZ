// Public barrel for @scriptz/core.
//
// Most consumers should prefer the per-module subpath imports (e.g.
// `@scriptz/core/lib/api`, `@scriptz/core/components/Browser/Browser`)
// for tree-shaking and clearer dependency edges. This barrel exists so
// the package has a default entry point and so platform-glue files
// (the host's adapter implementation) can grab the registration
// helpers and shared types from one place.

export {
  setPlatformAdapter,
  getPlatformAdapter,
  type PlatformAdapter,
  type DbConnection,
  type ExportPdfDeps,
  type SaveDialogOptions,
  type SaveDialogFilter,
  type SaveAsOptions,
  type SaveAsResult,
  type OpenFileResult,
} from "./lib/platform";

export {
  setUpdatesStore,
  getUpdatesStore,
  type UpdatesStore,
  type UpdateStage,
  type ManualCheckState,
  type AvailableUpdate,
} from "./lib/updates";
