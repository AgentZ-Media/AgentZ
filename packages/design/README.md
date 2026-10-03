# @agentz/design

The design system of the AgentZ suite (ScriptZ Desktop, future apps).
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
import "@agentz/design/legacy.css";     // only while old token names exist
import "@agentz/design/components.css";
```

TypeScript data:

```ts
import { ICONS, type IconName, STAGE_GLYPHS } from "@agentz/design/icons";
import { LOGO_DOTS, LOGO_VIEWBOX, LOGO_DOT_R } from "@agentz/design/logo";
```

`ICONS[name]` is the inner markup for a `viewBox="0 0 24 24"` stroke icon;
`STAGE_GLYPHS[stage]` is the inner markup for a `viewBox="0 0 14 14"` glyph.

## Logo and app icon

`logo.ts` is the single source of truth for the dot-matrix Z. In-app it is
drawn by `AppMark` (`packages/core/components/Common/AppMark.tsx`, styles
`.app-mark` in `components.css`). Standalone files live in `assets/`:

| File | Use |
|---|---|
| `scriptz-app-icon.svg` / `.png` (1024 px) | The app icon ("App-Icon hell" in the concept): white sheet with paper grid, ink + graphite dots, macOS icon grid (824 px tile, 100 px inset, 22.5 % corner radius). README, favicons, press. |
| `scriptz-mark.svg` | Bare Z for light backgrounds (ink + graphite). |
| `scriptz-mark-inverse.svg` | Bare Z for dark backgrounds (chalk + highlighter). |

All of them - plus every shipped raster copy - are generated, never edited
by hand:

```bash
pnpm --filter @agentz/design build:logo   # needs Node >= 22.18 + Google Chrome
```

The script writes `assets/` and the complete Tauri icon set
(`apps/desktop/src-tauri/icons/`, via `tauri icon`: icns, ico, Windows
Store tiles, iOS, Android). To change the icon, change
`logo.ts` or the palette at the top of `scripts/build-logo.mjs` (keep it in
sync with `.app-mark.is-light` / `.is-dark`) and rerun the script.

## The one rule

**No hex (or rgb) colour values outside this package.** Apps reference
`var(--token)` only. That is what makes the system portable: to start a new
app of the suite, add `@agentz/design` as a dependency, import the four CSS
files, set `data-theme` on `<html>`, override `--accent` if the app needs its
own highlighter colour - done. Exceptions are content colours that are data,
not UI (e.g. a user's character palette) and OS chrome replicas (macOS
traffic lights).
