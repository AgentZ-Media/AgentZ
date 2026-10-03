# AgentZ suite placeholder icons

This bundled set uses the existing AgentZ dot-matrix Z and yellow accent tile,
which ScriptZ also uses. It is deliberately shared suite branding, not a
claim that a newly generated product already has its own raster icon.

Source: `LOGOS.suite` in `packages/design/logo.ts`. These binaries
are generated ScriptZ exports of that same suite geometry and yellow tile. `icon.png`
is the 512 px Tauri export; the 32, 128 and 256 px PNGs, ICNS and ICO are real
platform icon formats. The set covers the generated desktop Tauri config.

When Chrome is unavailable, `build-logo.mjs --app <id>` copies this set and
writes `PLACEHOLDER.md` into the target icon directory. Once Chrome is
available, rerunning that command generates the product's registered glyph
and removes the marker. `--fallback` forces this path for deterministic
checks. Raster or Tauri failures with an available Chrome fail visibly.
