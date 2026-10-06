# AgentZ Suite website

Static Astro site: German at `/`, English at `/en/`, German legal pages at
`/impressum/` and `/datenschutz/`, the account at `/konto/` and `/en/account/`.
No tracking, cookies or analytics. Only the account page stores anything or
talks to a server (see below). Fonts, colors and buttons come from
`@agentz/design`; Kit and product modules are never imported.

The landing page shows a rebuilt, animated ScriptZ window
(`src/components/ScriptzWindow.astro`), feature tiles with small looping demos
(`Features.astro`) and real screenshots (`public/img/shots/<lang>-<view>-<width>.webp`).
`src/scripts/site.ts` runs on every page: reveal on scroll, the typing demo,
the copy button and the platform-specific download button. Without JavaScript
every section shows its final state; reduced motion stops the demo. The demo
paper uses iA Writer Quattro (SIL OFL, `src/assets/fonts/`).

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
