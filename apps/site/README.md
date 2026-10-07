# AgentZ Suite website

Static Astro site: German at `/`, English at `/en/`, the ScriptZ page at
`/scriptz/` and `/en/scriptz/`, German legal pages at `/impressum/` and
`/datenschutz/`, the account at `/konto/` and `/en/account/`.
No tracking, cookies or analytics. Only the account page stores anything or
talks to a server (see below), apart from the script counter. Fonts, colors and buttons come from
`@agentz/design`; Kit and product modules are never imported.

Every page is dark and sits on one dot grid: a canvas behind the page
(`src/scripts/dot-field.ts`), started by `src/scripts/site.ts`, which also
handles reveal on scroll, the copy button and the platform-specific download
button. The home page (`src/components/Home.astro`, `src/scripts/home.ts`)
drives the field itself: it opens with a zoom-out from one giant dot into the
suite Z, and a yellow dot travels down the page with the scroll position
(`src/scripts/dot-journey.ts`), from the period of the headline to the period
of "Punktlandung". The ScriptZ page shows a working rebuild of the app
(`src/components/LiveApp.astro`, `src/scripts/live.ts`): editable script with
ScriptZ's smart Enter, live inspector and timeline, Ida, board and export
dialog. Without JavaScript every page shows its final state with static dots;
reduced motion skips the intro and the travelling dot. The demo paper uses
iA Writer Quattro (SIL OFL, `src/assets/fonts/`).

The footer carries the official EU icon for labelling AI-generated content
(`src/components/AiLabel.astro`, paths taken unchanged from the European
Commission's download, free to use without attribution), with a plain-language
note in German and English.

## Account

Sign-up, sign-in and the account view (name, password, deletion, an outlook on
upcoming features) use [Better Auth](https://better-auth.com) on
[Convex](https://convex.dev) through `@convex-dev/better-auth`. The backend
lives in `convex/` (Convex project `agentz-suite`, team `agentz`, region EU
West). Email and password, with password reset and email verification
(offered, not required). Emails go through Resend (`@convex-dev/resend`,
`convex/emails.ts`) from `info@agentz-suite.com`; the domain is verified in
Resend (EU region), DNS records live with the domain's DNS host. Email links
open the account page on the website (`SITE_URL`) with
`?flow=reset|verify&token=…`, never the Convex origin; the page hands the token
to the auth API. The email language follows the page that started the flow
(`/en/` = English). Mails show the suite icon from `/img/suite.png` on the live
site and link to the legal pages. `convex/crons.ts` deletes the
component's copies of sent emails after two days.

- `src/components/Account.astro` renders every state; `src/scripts/account.ts`
  switches between them and calls `better-auth/client`. The script and
  `src/styles/account.css` load only on the account pages.
- The auth API runs on the deployment's `.convex.site` origin. The
  cross-domain plugin keeps the session in `localStorage` and sends it as a
  header; CORS allows only `SITE_URL` and `TRUSTED_ORIGINS`.
- `PUBLIC_CONVEX_SITE_URL` points the page at the deployment. Without it
  (preview builds, CI) the page shows its "unavailable" state.
- `convex/auth.ts` exports `currentUser`, the query apps will use later.

Convex environment variables: `BETTER_AUTH_SECRET`, `RESEND_API_KEY`, `SITE_URL` (dev
`http://localhost:4321`, prod `https://www.agentz-suite.com`) and, in prod,
`TRUSTED_ORIGINS=https://agentz-suite.com`.

## Local

From the repository root: `pnpm dev:site`, `pnpm build:site` (output
`apps/site/dist`), `pnpm --filter @agentz/site typecheck`, `pnpm check:astro`.

For the account, `apps/site/.env.local` (git-ignored) needs `CONVEX_DEPLOYMENT`
and `PUBLIC_CONVEX_SITE_URL` of your dev deployment. `npx convex dev
--configure existing --team agentz --project agentz-suite` in `apps/site`
writes the first one; add the second as `https://<deployment>.convex.site`.
After changing `convex/`, run `pnpm dev:site:backend` (watches and pushes to
the dev deployment, regenerates `convex/_generated/`, which is committed).

## Search and link previews

`src/layouts/Base.astro` writes title, description, canonical URL, hreflang
links, Open Graph and Twitter card tags for every page; the home page and the
ScriptZ page add JSON-LD (`WebSite`, `SoftwareApplication`). URLs are built
from `site` in `astro.config.mjs` (`https://www.agentz-suite.com`, the real
address; the apex redirects there). Preview images are 1200x630 JPEGs in
`public/og/` (suite and ScriptZ, German and English), rendered by
`pnpm --filter @agentz/site build:og` with Chrome from `src/i18n.ts` and the
design tokens; regenerate them after changing the hero, ScriptZ or demo texts.
`src/pages/sitemap.xml.ts` lists the indexed pages with their language
alternates, `public/robots.txt` points to it.

## Script counter

The home page and the ScriptZ page show how many scripts were written with
ScriptZ (`src/components/ScriptCount.astro`). The server never interprets
record contents, so signed-in apps report their account's totals
(`SyncAdapter.stats` in the Kit, `stats:report` in `convex/stats.ts`, allowed
keys in `STAT_KEYS`). An hourly cron sums them into `site_stats`, and
`GET /stats` on the deployment serves the sum. The build renders the latest
value (`src/stats.ts`); the browser fetches `/api/stats.json`, a rewrite in
`vercel.json` to the production deployment whose response Vercel's CDN keeps
for an hour (`x-vercel-enable-rewrite-caching`, `CDN-Cache-Control`), so page
views almost never reach Convex. The dev server proxies the same path to the
deployment in `.env.local`. Below 50 scripts (`MIN_SCRIPTS` in `src/stats.ts`)
the counter stays hidden.

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

Address: `https://www.agentz-suite.com`; the apex domain redirects there.
Domain, Vercel project and DNS are set up manually. With `apps/site` as the
Vercel root directory, the `buildCommand` in `vercel.json` deploys `convex/`
to the production deployment and builds the site in one step
(`convex deploy --cmd`) when it runs for production with `CONVEX_DEPLOY_KEY`
set, and hands the deployed backend's `CONVEX_SITE_URL` to the site build as
`PUBLIC_CONVEX_SITE_URL`; otherwise it only builds the site, with
`PUBLIC_CONVEX_SITE_URL` cleared so the account page never talks to a backend
this build did not deploy. Vercel production only needs `CONVEX_DEPLOY_KEY`
(sensitive). `vercel.json` skips builds unless the site, `packages/design`, the
root `package.json`, `pnpm-workspace.yaml` or `pnpm-lock.yaml` changed since
the last successful deployment. Without one (first deployment) it always
builds.

Before going live, verify the provider details in the legal pages and match
the privacy policy against the actual hosting setup (processing agreement,
log retention, any extra services). The policy describes Vercel hosting and
the account on Convex; it does not claim a deployment exists. Never add analytics. The EU online
dispute resolution platform was shut down on 20 July 2025, so its link is
intentionally missing.

- [Vercel privacy notice](https://vercel.com/legal/privacy-notice)
- [Vercel DPA](https://vercel.com/legal/dpa)
- [Convex privacy policy](https://www.convex.dev/legal/privacy)
- [Convex DPA](https://www.convex.dev/legal/dpa)
- [Resend privacy policy](https://resend.com/legal/privacy-policy)
- [Resend DPA](https://resend.com/legal/dpa)
- [EU ODR platform shutdown](https://consumer-redress.ec.europa.eu/site-relocation_en)
- [EU icons for labelling AI-generated content](https://digital-strategy.ec.europa.eu/en/policies/eu-icons-labelling-ai-generated-content)
