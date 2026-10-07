---
paths:
  - "apps/site/**"
---

# Suite-Website

- Statische Astro-Seite ohne Tracking, Cookies, lokalen Speicher oder externe
  Requests. JavaScript nur als Verbesserung: `src/scripts/site.ts` auf jeder
  Seite (Punktraster, Einblenden, Kopieren, Plattform-Erkennung), dazu
  `home.ts` (Intro und wandernder Punkt) und `scriptz-page.ts` (bedienbarer
  Nachbau). Ohne JavaScript ist alles im Endzustand lesbar,
  `prefers-reduced-motion` lässt Intro, wandernden Punkt und Tipp-Demo weg. Nur
  `@agentz/design` als internes Paket; keine Kit- oder Produktmodule importieren.
- Einzige Ausnahme ist das Konto (`/konto/`, `/en/account/`) samt
  Vollbild-Anmeldung für Apps (`/konto/app/`, `/en/account/app/`, ohne Header
  und Footer): Better Auth auf Convex über `@convex-dev/better-auth`, Backend in
  `convex/`. Nur `src/scripts/account.ts`, `appSignIn.ts` und das gemeinsame
  `authForms.ts` sprechen mit dem Server und speichern die Sitzung im
  `localStorage` (Cross-Domain-Plugin); `site.ts` und alle anderen Seiten
  bleiben ohne Requests und Speicher, bis auf den Skriptzähler (siehe unten).
  Kein React, kein Convex-Websocket auf der Website. Ohne `PUBLIC_CONVEX_SITE_URL` zeigt die Seite „nicht erreichbar“.
- Kontodaten sind Nutzerdaten: Die Tabellen der Better-Auth-Komponente nicht
  von Hand ändern, Konfigurationsänderungen (`convex/auth.ts`) erst gegen das
  Dev-Deployment (`pnpm dev:site:backend`) testen. Production deployt nur der
  Vercel-Build (`convex deploy --cmd`) nach dem Merge auf `main`.
  `convex/_generated/` wird committet. Sync-Daten der Apps
  (`schema.ts`, `sync.ts`, `appLink.ts`) sind Nutzerinhalte; jede App hat eine
  eigene Record-Tabelle
  ([`docs/cloud-sync.md`](../../docs/cloud-sync.md)). Neue Datenverarbeitung im Konto immer
  in der Datenschutzerklärung nachziehen.
- Skriptzähler (`ScriptCount.astro`, `src/stats.ts`, `src/scripts/script-count.ts`)
  auf Startseite und ScriptZ-Seite: Der Build rendert die letzte Summe, der
  Browser holt die aktuelle über `/api/stats.json`. Das ist ein Rewrite in
  `vercel.json` auf `/stats` des Production-Backends, dessen CDN die Antwort eine
  Stunde hält; im Dev-Server leitet `astro.config.mjs` auf das Deployment aus
  `.env.local` um. Die Summe bildet ein stündlicher Cron (`convex/stats.ts`) aus
  den Zahlen, die angemeldete Apps melden (`SyncAdapter.stats`, erlaubte
  Schlüssel in `STAT_KEYS`). Nur Zahlen, nie etwas aus Inhalten. Unter 50
  Skripten (`MIN_SCRIPTS`) bleibt der Zähler ausgeblendet.
- Suchmaschinen und Link-Vorschau: `Base.astro` setzt Titel (`<Seite> | AgentZ
  Suite`), Beschreibung, Canonical, hreflang, Open Graph und Twitter-Card;
  Startseite und ScriptZ-Seite liefern zusätzlich JSON-LD (`schema`). Jede
  indexierte Seite braucht eine eigene Beschreibung in DE und EN.
  Vorschaubilder (1200x630 JPEG) liegen in `public/og/` und entstehen mit
  `pnpm --filter @agentz/site build:og` aus `src/i18n.ts` und den Tokens; nach
  Änderungen an Hero-, ScriptZ- oder Demo-Texten neu erzeugen. `sitemap.xml`
  (`src/pages/sitemap.xml.ts`) listet nur indexierte Seiten, `noindex`-Seiten
  bleiben draußen. `site` in `astro.config.mjs` ist die echte Adresse mit `www`.
- Konto-E-Mails (Reset, Bestätigung) über Resend in `convex/emails.ts`, Absender
  `info@agentz-suite.com`, Texte dort in DE und EN. E-Mails tragen die
  Token-Werte als feste Farben (Mail-Clients kennen keine CSS-Variablen); das
  ist die einzige weitere Farbausnahme. Keine Werbe-Mails, kein Öffnungs- oder
  Klick-Tracking.
- Tokens, Fonts und `.btn` aus dem Design-Paket. Keine eigenen Farbwerte; einzige
  Ausnahme ist die Charakter-Palette der Demo in `src/styles/palette.css`, die
  die ScriptZ-Palette spiegelt. Icons stammen aus `node packages/design/scripts/build-logo.mjs --app <id>`.
- Die ganze Website ist dunkel und liegt auf einem Punktraster
  (`dot-field.ts`); Farben des Canvas kommen zur Laufzeit aus den Tokens.
  Formen im Raster entstehen aus den Logo-Daten (`@agentz/design/logo`).
- Der Nachbau auf der ScriptZ-Seite (`LiveApp.astro`, `live.ts`) bildet die
  echte ScriptZ-Oberfläche ab. Bei sichtbaren Änderungen an ScriptZ den Nachbau
  mitziehen.
- Im Footer steht das offizielle EU-Icon zur Kennzeichnung von KI-Inhalten
  (`AiLabel.astro`, Pfade unverändert aus dem Download der EU-Kommission) mit
  Begleittext in DE/EN. Nicht entfernen oder umzeichnen.
- `src/apps.ts` ist die datengetriebene App-Liste. Name, ID und echte Taglines in
  DE/EN pflegen. `soon` hat keine Download-Buttons. Erst nach erfolgreichem Release
  beider Installer auf `available` wechseln. Download-URLs aus ID bauen, niemals
  GitHubs repoübergreifendes `releases/latest` verwenden.
- `src/i18n.ts`: Deutsch ist kanonisch, Englisch muss dieselben Schlüssel besitzen.
  Alle Nutzertexte in beiden Sprachen pflegen. `/` ist DE, `/en/` EN. Impressum
  und Datenschutz sind bewusst Deutsch; englische Footer-Links kennzeichnen das.
- Anbieterangaben in Impressum und Datenschutz nicht eigenmächtig ändern; bei
  sachlichen Änderungen aktuell verifizieren. Hostingangaben mit tatsächlichem Betrieb
  abgleichen, keine Aufbewahrungsfristen oder abgeschlossenen Verträge erfinden.
- Vor Abschluss `pnpm --filter @agentz/site typecheck` und `pnpm build:site`;
  Desktop/Mobil und beide Sprachen einmal visuell prüfen. Ein Build ist keine
  Veröffentlichung. Domain (`agentz-suite.com`), Vercel und DNS liegen bei Timo.
- Bei neuen Apps oder geändertem Namen/Icon immer auch `src/apps.ts` prüfen.
