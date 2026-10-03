/* @refresh reload */
import { render } from "solid-js/web";

import { registerDesktopPlatform } from "./lib/platform";
import { registerDesktopUpdates } from "./stores/updates";
import { registerSqlStorageAdapter } from "@agentz/scriptz/lib/api";

// Styles: design system first (fonts -> tokens -> legacy aliases ->
// component primitives), then core's global.css, which pulls in the
// ScriptZ tokens (paper geometry, character palette) and the paper font.
import "@agentz/design/fonts.css";
import "@agentz/design/tokens.css";
import "@agentz/design/legacy.css";
import "@agentz/design/components.css";
import "@agentz/scriptz/styles/global.css";
import App from "./App";

const root = document.getElementById("root");
if (!root) throw new Error("#root not found");

// Imports are inert. Host services are ready before the module boots.
registerDesktopPlatform();
registerSqlStorageAdapter();
registerDesktopUpdates();

const dispose = render(() => <App />, root);
if (import.meta.hot) import.meta.hot.dispose(dispose);
