---
paths:
  - "apps/*/package.json"
  - "apps/*/src-tauri/**"
  - "Cargo.toml"
  - "Cargo.lock"
  - "package.json"
  - "docs/release-notes/**"
  - "tooling/release/**"
  - ".github/workflows/release.yml"
---

# Desktop releases for the AgentZ Suite

Each desktop app has its own `<app-id>-v<semver>` tags and update channel.
Historical `v0.x.y` tags stay untouched. No app release becomes GitHub's
repository-wide “Latest”. The existing updater signing key is shared; never
print it or commit it. Back up the private key independently of this repository.

## Checklist

1. Back up the app database with SQLite's backup API, and export important
   documents before storage migrations. Verify restore and migration locally.
2. `pnpm release:bump <app> <version>` updates the app's `package.json`,
   `src-tauri/tauri.conf.json`, `[package].version` in `Cargo.toml`, and the
   workspace-root `Cargo.lock`. It runs a targeted offline Cargo update and
   restores all four originals on failure. Dependencies must already be cached;
   populate the Cargo cache first if needed, then retry. Inspect the diff.
3. Complete `docs/release-notes/<app>/v<version>.md` in English. Explain what
   users notice, fixes, and updating. Do not copy the installation footer: the
   workflow appends it and replaces `{{PRODUCT_NAME}}` from Tauri metadata.
4. Run required CI checks and desktop QA, review and merge the version/notes PR.
5. Tag that merged commit, for example:
   `git tag -a scriptz-v0.9.0 -m 'ScriptZ v0.9.0'`, then push that tag.
6. Verify both platform builds, updater signatures, versioned release assets,
   and all three unauthenticated URLs on the app pointer. Test a real update.

`pnpm install --frozen-lockfile` protects only the JavaScript lockfile. Release
Cargo builds use `--locked`. All apps share root `target/`; explicit targets
produce `target/<target>/release/bundle/`. Do not look under app `src-tauri/target`.
Tauri JS and Rust versions must be updated together.

## Workflow and recovery

`prepare` validates the app ID, strict SemVer, all four versions and nonempty
release notes. It creates a published release with `--latest=false` and passes
the numeric REST `releaseId` to `tauri-action@v0`. Sandbox and SemVer prerelease
tags create published prereleases. Existing releases are reused on rerun.

macOS (`macos-26`, `aarch64-apple-darwin`) builds first; Windows
(`windows-latest`, `x86_64-pc-windows-msvc`, NSIS) follows. The sequence is
required because tauri-action merges `latest.json`. Each platform job checks
its existing manifest entry and assets **immediately before building**, even
on “rerun failed jobs”. Complete platforms are skipped: rebuilding and replacing
signed binaries would invalidate the signatures already referenced by users.

The serialized `pointer-<app-id>` job publishes `<app-id>-latest`, always a
published prerelease, never “Latest”. It checks both platform signatures and
version-bound download URLs, then copies installers under stable names:

- `<app-id>-macos-arm64.dmg`
- `<app-id>-windows-x64-setup.exe`
- `latest.json`, retaining URLs into the immutable versioned release

The pointer advances only to newer SemVer versions. An identical manifest at
the same version may be retried to repair uploads; a different manifest at the
same version is rejected. A version marker in the pointer body is reserved
before replacing assets, preventing rollback even when a failed `--clobber`
upload has temporarily deleted `latest.json`. Never remove this marker.

Installers upload first, manifest last. GitHub asset replacement is not atomic:
a failed upload can leave an asset missing. Rerun failed jobs to recover. The
version marker may then be ahead of the manifest until recovery completes;
rerun that newest version, not an older release. Do not delete/recreate tags,
rewrite published version assets, or enable GitHub release immutability (the
pointer releases must remain mutable). Investigate a same-version manifest
mismatch instead of bypassing the check.

For permission failures, inspect workflow `contents: write`, repository Actions
settings and organization restrictions. Fix the actual permission, then rerun;
never delete a published tag merely to retry. Versioned releases can temporarily
contain only one platform while builds run; the pointer remains unchanged.

## Build-only rehearsal

Run `gh workflow run release.yml --ref main -f app=scriptz` (or Actions →
Release → Run workflow). **Every workflow_dispatch is a dry run.** It validates
versions and builds macOS and Windows installers with updater artifacts disabled.
It uses no signing secrets, creates no tags/releases, publishes no manifests,
and does not alter version files. Bundles are retained as workflow artifacts for
seven days. This checks packaging, not signing or the live updater cycle.

## Installation and updating

The updater endpoint is
`https://github.com/AgentZ-Media/AgentZ/releases/download/<app-id>-latest/latest.json`.
The desktop host checks, flushes pending saves, installs and relaunches through
Tauri plugins. Runtime version comes from Tauri `getVersion()`, not a second
frontend constant. The public verification key is in each app's Tauri config;
`TAURI_SIGNING_PRIVATE_KEY` and optional `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
exist only as GitHub secrets/local protected signing material.

The first unsigned macOS installation needs the documented Gatekeeper step
`xattr -cr "/Applications/<Product>.app"`. Windows users may see SmartScreen;
the installation footer explains “More info” → “Run anyway”. These apps are
updater-signed, but not Apple-notarized or Windows code-signed.

ScriptZ 0.8.4 still uses the legacy repository-wide channel. Install 0.9.0
manually from `scriptz-latest` once, then verify the 0.9.0 → 0.9.1 updater cycle.
Do not change the ScriptZ bundle identifier, database name or updater public key.

On a fresh Windows machine use Node 24, pnpm matching root `packageManager`,
Rust stable MSVC, Visual Studio Build Tools with Desktop C++ and Windows SDK,
and WebView2. Run installation in the user's normal terminal. The NSIS package
includes the WebView2 download-bootstrapper fallback.
