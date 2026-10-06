# AgentZ Suite website

Static Astro site: German at `/`, English at `/en/`, German legal pages at
`/impressum/` and `/datenschutz/`. No tracking, cookies, storage or external
requests. Fonts, colors and buttons come from `@agentz/design`; Kit and product
modules are never imported.

The landing page shows a rebuilt, animated ScriptZ window
(`src/components/ScriptzWindow.astro`), feature tiles with small looping demos
(`Features.astro`) and real screenshots (`public/img/shots/<lang>-<view>-<width>.webp`).
`src/scripts/site.ts` is the only script: reveal on scroll, the typing demo,
the copy button and the platform-specific download button. Without JavaScript
every section shows its final state; reduced motion stops the demo. The demo
paper uses iA Writer Quattro (SIL OFL, `src/assets/fonts/`).

The footer carries the official EU icon for labelling AI-generated content
(`src/components/AiLabel.astro`, paths taken unchanged from the European
Commission's download, free to use without attribution), with a plain-language
note in German and English.

## Local

From the repository root: `pnpm dev:site`, `pnpm build:site` (output
`apps/site/dist`), `pnpm --filter @agentz/site typecheck`, `pnpm check:astro`.

## Apps and downloads

`src/apps.ts` is the only app list: id, name, German and English tagline,
status `soon` or `available`. `soon` shows no download links. Switch to
`available` only after both installers of a release are published. The
generator adds entries between the `@new-app:entries` markers; keep them.

Icons are `/img/<id>.png`, written by
`node packages/design/scripts/build-logo.mjs --app <id>`. Download links are
built from the id and the app's pointer release:

- `https://github.com/AgentZ-Media/AgentZ-Suite/releases/download/<id>-latest/<id>-macos-arm64.dmg`
- `https://github.com/AgentZ-Media/AgentZ-Suite/releases/download/<id>-latest/<id>-windows-x64-setup.exe`

The build calls no GitHub API and shows no version number.

## Deployment

Planned address: `https://agentz-suite.com` (`astro.config.mjs`). Domain,
Vercel project and DNS are set up manually. With `apps/site` as the Vercel root
directory, `vercel.json` skips builds unless the site, `packages/design`, the
root `package.json`, `pnpm-workspace.yaml` or `pnpm-lock.yaml` changed.

Before going live, verify the provider details in the legal pages and match
the privacy policy against the actual hosting setup (processing agreement,
log retention, any extra services). The policy describes Vercel hosting; it
does not claim a deployment exists. Never add analytics.

- [EU icons for labelling AI-generated content](https://digital-strategy.ec.europa.eu/en/policies/eu-icons-labelling-ai-generated-content) The EU online
dispute resolution platform was shut down on 20 July 2025, so its link is
intentionally missing.

- [Vercel privacy notice](https://vercel.com/legal/privacy-notice)
- [Vercel DPA](https://vercel.com/legal/dpa)
- [EU ODR platform shutdown](https://consumer-redress.ec.europa.eu/site-relocation_en)
