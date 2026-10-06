---
paths:
  - "apps/site/**"
---

# Suite-Website

- Statische Astro-Seite ohne Tracking, Cookies, lokalen Speicher oder externe
  Requests. JavaScript nur als kleine Verbesserung in `src/scripts/site.ts`
  (Einblenden, Tipp-Demo, Kopieren, Plattform-Erkennung); ohne JavaScript ist
  alles im Endzustand lesbar, `prefers-reduced-motion` stoppt die Demo. Nur
  `@agentz/design` als internes Paket; keine Kit- oder Produktmodule importieren.
- Tokens, Fonts und `.btn` aus dem Design-Paket. Keine eigenen Farbwerte; einzige
  Ausnahme ist die Charakter-Palette der Demo in `src/styles/palette.css`, die
  die ScriptZ-Palette spiegelt. Icons stammen aus `node packages/design/scripts/build-logo.mjs --app <id>`.
- Das Demo-Fenster (`ScriptzWindow.astro`) und die Feature-Kacheln bauen die
  echte ScriptZ-Oberfläche nach. Bei sichtbaren Änderungen an ScriptZ Nachbau
  und die Screenshots in `public/img/shots/` (DE/EN, je 1200 und 2400 px breit,
  WebP) mitziehen.
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
