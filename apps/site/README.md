# AgentZ Suite Website

Statische Astro-Website: Deutsch unter `/`, Englisch unter `/en/`, deutsche
Rechtstexte unter `/impressum/` und `/datenschutz/`. Es gibt kein Laufzeit-JavaScript,
kein Tracking und keine Cookies. Fonts, Farben und Buttons stammen aus
`@agentz/design`. Das Kit und Produktmodule werden nicht importiert.

## Lokal

Ab Repo-Root: `pnpm install --frozen-lockfile`, `pnpm dev:site`.
`pnpm build:site` erzeugt `apps/site/dist`. `pnpm --filter @agentz/site preview`
zeigt den statischen Build. `pnpm --filter @agentz/site typecheck` prüft auch die
Astro-Komponenten. Die Suite verwendet Node 24 in der CI und empfiehlt
diesen Stand auch lokal.

## Apps und Downloads

`src/apps.ts` ist die einzige App-Liste. Jede Karte hat ID, Name, echten deutschen
und englischen Funktionssatz sowie `soon` oder `available`. Bei `soon` erscheinen
keine Download-Links. `available` erst nach erfolgreichem Release mit beiden
Installern setzen. Ein erfolgreicher lokaler Build ist kein veröffentlichtes
Release. ScriptZ steht nach erfolgreicher Veröffentlichung und Prüfung
beider Installer auf `available`. Die temporäre Sandbox-Karte wurde nach
der vollständigen Generator-/Update-Abnahme wieder entfernt; die Website
zeigt in beiden Sprachen ausschließlich ScriptZ.

Icons kommen aus `/img/<id>.png`, erzeugt mit `pnpm build:logo --app <id>`. Die
Links folgen ausschließlich dem Phase-6-Schema:

- `https://github.com/AgentZ-Media/AgentZ/releases/download/<id>-latest/<id>-macos-arm64.dmg`
- `https://github.com/AgentZ-Media/AgentZ/releases/download/<id>-latest/<id>-windows-x64-setup.exe`

Der Build ruft keine GitHub-API auf und zeigt keine möglicherweise veraltete
Version an. Der Generator ergänzt Einträge zwischen den `@new-app:entries`-
Markern. Diese Marker behalten.

## Veröffentlichung durch Timo

Die Website ist im Repository vorbereitet; Domain, Vercel-Projekt und DNS werden
von Timo eingerichtet. In diesem Umsetzungsschritt werden weder Deployments noch
externe Konfigurationen vorgenommen.

Geplante Adresse: `https://agentz-suite.de` (`astro.config.mjs`). Die Domain muss
vor Veröffentlichung registriert und mit HTTPS verbunden sein. Für einen
Monorepo-Build vom Repository-Root: `pnpm build:site`, Ausgabe `apps/site/dist`.
Wird stattdessen `apps/site` als Vercel-Root gesetzt, Workspace-Dateien außerhalb
dieses Verzeichnisses einschließen und dort `pnpm build` / Ausgabe `dist` verwenden.
Die Site, `packages/design`, Root-`package.json`, `pnpm-workspace.yaml` und
`pnpm-lock.yaml` müssen bei Änderungen einen neuen Build auslösen.

Die Rechtstexte übernehmen die Anbieter- und Kontaktdaten aus der alten Landing
(Git vor `8a46a96`). Vor dem tatsächlichen Start Anbieterangaben und die dann
verwendete Hosting-Konfiguration einschließlich Auftragsverarbeitung,
Aufbewahrungsregeln und möglicher zusätzlicher Dienste abgleichen. Die vorbereitete
Datenschutzerklärung beschreibt das im Plan gewählte Vercel-Hosting; sie bestätigt
keine bereits erfolgte Bereitstellung. Keine Analytics-Integration aktivieren.

Die alte Behauptung einer festen 30-Tage-Logfrist wurde nicht ungeprüft übernommen.
Der frühere OS-Plattform-Link entfällt, weil die EU die Plattform zum 20. Juli 2025
eingestellt hat. Quellen für die Aktualisierung:

- [EU: Einstellung der OS-Plattform](https://consumer-redress.ec.europa.eu/site-relocation_en)
- [Vercel Datenschutz](https://vercel.com/legal/privacy-notice)
- [Vercel Auftragsverarbeitung](https://vercel.com/legal/dpa)
- [Datenschutzaufsicht Mecklenburg-Vorpommern](https://www.datenschutz-mv.de/kontakt)
- [Astro Installation](https://docs.astro.build/en/install-and-setup/)
