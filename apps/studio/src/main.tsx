/* @refresh reload */
import { render } from "solid-js/web";

// Boot order (mirrors apps/web):
// 1. PlatformAdapter (blob download, no SQL).
// 2. core/lib/api registers the SQL default StorageAdapter on import...
// 3. ...then our Convex adapter overrides it. From here every core api.* call
//    (the reused editor's load/save/colours) goes against Convex.
import "./lib/platform";
import "@scriptz/core/lib/api";
import "./adapters/convex";

// Styles: design system first (fonts -> tokens -> legacy aliases ->
// component primitives), then core's global.css, which pulls in the
// ScriptZ tokens (paper geometry, character palette) and the paper font.
import "@agentz/design/fonts.css";
import "@agentz/design/tokens.css";
import "@agentz/design/legacy.css";
import "@agentz/design/components.css";
import "@scriptz/core/styles/global.css";
import "./styles/studio.css";
import App from "./App";

const root = document.getElementById("root");
if (!root) throw new Error("#root not found");

render(() => <App />, root);
