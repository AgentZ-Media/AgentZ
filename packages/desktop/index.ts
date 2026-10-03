// Shared layers precede dynamically loaded product CSS. This entry is marked
// side-effectful in package.json so Rollup cannot skip these imports while
// resolving the boot re-export below. Native initialization stays explicit.
import "@agentz/design/fonts.css";
import "@agentz/design/tokens.css";
import "@agentz/design/components.css";
import "@agentz/kit/styles.css";

export { bootDesktopApp } from "./boot";
export type { DesktopApp, DesktopAppOptions } from "./boot";
