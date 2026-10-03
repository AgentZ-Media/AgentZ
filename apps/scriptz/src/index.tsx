/* @refresh reload */
import { createSqlKvStore, getPlatformAdapter, setKvStore } from "@agentz/kit/platform";
import { render } from "solid-js/web";

import { registerDesktopPlatform } from "./lib/platform";
import { registerDesktopUpdates } from "./stores/updates";
import { registerSqlStorageAdapter } from "@agentz/scriptz/storage";

// Styles: design system first (fonts -> tokens -> legacy aliases ->
// component primitives), then core's global.css, which pulls in the
// ScriptZ tokens (paper geometry, character palette) and the paper font.
import "@agentz/design/fonts.css";
import "@agentz/design/tokens.css";
import "@agentz/design/legacy.css";
import "@agentz/design/components.css";
import "@agentz/kit/styles.css";
import "@agentz/scriptz/styles.css";
import App from "./App";

const root = document.getElementById("root");
if (!root) throw new Error("#root not found");

// Imports are inert. Host services are ready before the module boots.
registerDesktopPlatform();
setKvStore(createSqlKvStore(() => getPlatformAdapter().getDb()));
registerSqlStorageAdapter();
registerDesktopUpdates();

const dispose = render(() => <App />, root);
if (import.meta.hot) import.meta.hot.dispose(dispose);
