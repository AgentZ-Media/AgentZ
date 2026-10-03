# @agentz/design

The design system of the AgentZ suite (all apps and the website).
Plain CSS + a few typed data modules - no framework code, so any app
(Solid, Astro, React, static HTML) can use it.

Visual reference: `docs/redesign/concept.html` (the "Werkbank" concept).

## Layers

1. **Primitives + semantic tokens** - `tokens.css`
   Type scale, spacing, radii, motion (theme-independent) and the semantic
   colour roles (`--bg`, `--surface`, `--fill`, `--fg`, `--muted`, `--faint`,
   `--line`, `--paper`, `--accent`, `--warn`, `--side-*`, `--shadow-*`, ...).
   Components only ever read these names.
2. **Theme** - also `tokens.css`
   `:root` / `[data-theme="light"]` and `[data-theme="dark"]` swap values,
   never selectors. The writing surface stays light in the dark theme unless
   `[data-paper="dark"]` is set as well. A sibling app re-themes by
   overriding `--accent` (and maybe `--side-bg`), nothing else.
3. **Components** - `components.css`
   `.btn` (`.primary`, `.ghost`, `.icon`, `.danger`, `.accent`, `.sm`, `.lg`,
   `.wide`), `.chip`, `.fchip`, `kbd`, `.menu` / `.menu-it` / `.menu-sep`,
   `.scrim`, `.dlg`, `.toast` / `.toast-host`, `.sw-t` (switch), `.seg`,
   `.field` / `.field-box`, `.num-f`, `.rng-f`, `.srow`, `.app-mark`,
   `svg.i` / `svg.st`.

`legacy.css` is a temporary alias layer that maps pre-redesign token names
(`--fg-muted`, `--bg-elev-1`, `--brand-500`, ...) onto the semantic tokens,
so old components get the new look without being touched. New code must not
use those names; delete aliases once nothing references them.

## Usage

Import in this order, before any app CSS:

```ts
import "@agentz/design/fonts.css";      // Schibsted Grotesk, bundled offline
import "@agentz/design/tokens.css";
// legacy.css: only ScriptZ still loads it; never in new apps or the Kit.
import "@agentz/design/components.css";
```

TypeScript data:

```ts
import { ICONS, type IconName, STAGE_GLYPHS } from "@agentz/design/icons";
import { LOGOS, createLogo, type LogoId } from "@agentz/design/logo";
```

`ICONS[name]` is the inner markup for a `viewBox="0 0 24 24"` stroke icon;
`STAGE_GLYPHS[stage]` is the inner markup for a `viewBox="0 0 14 14"` glyph.

## Logo and app icon

`logo.ts` is the registry of product marks (`LOGOS[id]`), including the
independent `suite` entry for AgentZ and `scriptz` with its unchanged
original dot geometry. New apps receive `createLogo(initial, accent?)`,
a letter in the same dot-matrix family. The shared Kit `AppMark` selects a
registry entry and exposes the supplied app name as its accessible label.

Standalone assets live in `assets/`:

| File | Use |
|---|---|
| `<id>-app-icon.svg` / `.png` | Accent-yellow app tile and dark dot glyph, matching the in-app mark; PNG is 1024 px when generated with Chrome. |
| `<id>-mark.svg` | Bare glyph for light backgrounds. |
| `<id>-mark-inverse.svg` | Bare glyph for dark backgrounds, using the registry accent. |
| `placeholder/` | Bundled AgentZ suite icon set for machines without Chrome. |

```bash
pnpm --filter @agentz/design build:logo --app scriptz
pnpm --filter @agentz/design build:logo --app suite
node packages/design/scripts/build-logo.mjs --app <id> --svg-only
```

The builder needs Node >= 22.18. Google Chrome or Chromium renders the PNG;
set `CHROME=/absolute/path/to/chrome` when auto-discovery does not find it.
Run `pnpm install` first so the target app's Tauri CLI is available. For an
app, the builder writes `apps/<id>/src-tauri/icons/` (ICNS, ICO, PNGs and
mobile variants through `tauri icon`) plus `apps/site/public/img/<id>.png`.
The `suite` entry only exports design assets and the website image.

Without Chrome, it copies the bundled suite placeholder set instead. The
set contains every format referenced by a generated desktop Tauri config,
so the app can still build. `PLACEHOLDER.md` in the icon directory makes
that provenance visible; rerunning with Chrome replaces it with the real
glyph and removes the marker. `--fallback` forces this path for checks.
An available browser or Tauri CLI that fails is reported as an error.

Change product geometry/accent in `LOGOS`, then rerun the builder. The
`new-app:logos` marker is maintained by the app generator. Never edit
raster exports by hand.

## The one rule

**No hex (or rgb) colour values outside this package.** Apps reference
`var(--token)` only. That is what makes the system portable: to start a new
app of the suite, add `@agentz/design` as a dependency, import `fonts.css`,
`tokens.css` and `components.css` (never `legacy.css` in new apps), set
`data-theme` on `<html>`, override `--accent` if the app needs its own
highlighter colour - done. Exceptions are content colours that are data,
not UI (e.g. a user's character palette) and OS chrome replicas (macOS
traffic lights).
