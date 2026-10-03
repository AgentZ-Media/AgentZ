/* @refresh reload */
import { render } from "solid-js/web";

// Register the Tauri-backed PlatformAdapter and the auto-updater store
// before anything from @agentz/scriptz gets imported transitively - these
// modules call setPlatformAdapter() / setUpdatesStore() at import time
// and core code crashes if the adapter is missing on first use.
import "./lib/platform";
import "./stores/updates";

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

render(() => <App />, root);
