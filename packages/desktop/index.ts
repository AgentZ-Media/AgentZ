// Shared layers precede dynamically loaded product CSS.
import "@agentz/design/fonts.css";
import "@agentz/design/tokens.css";
import "@agentz/design/components.css";
import "@agentz/kit/styles.css";

export { bootDesktopApp } from "./boot";
export type { DesktopApp, DesktopAppOptions } from "./boot";
