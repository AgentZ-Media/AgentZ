import { createVersionBus } from "./versionBus";

/** Version signal for the folder list (names, length ranges, script
 *  counts). Bumped after any change that affects one of them. */
export const foldersBus = createVersionBus();
