import { createVersionBus } from "./versionBus";

/** Version signal for the ideas list. Bumped as soon as any
 *  idea mutation (create / update / convert / delete) is done. */
export const ideasBus = createVersionBus();
