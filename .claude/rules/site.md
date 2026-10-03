---
paths:
  - "apps/site/**"
---

# Suite-Website

- Statische Astro-Seite ohne Laufzeit-JavaScript, Tracking oder Cookies. Nur
  `@agentz/design` als internes Paket; keine Kit- oder Produktmodule importieren.
- Tokens, Fonts und `.btn` aus dem Design-Paket. Keine eigenen Farbwerte und
  keine Legacy-Aliase. Icons stammen aus `node packages/design/scripts/build-logo.mjs --app <id>`.
- `src/apps.ts` ist die datengetriebene App-Liste. Name, ID und echte Taglines in
  DE/EN pflegen. `soon` hat keine Download-Buttons. Erst nach erfolgreichem Release
  beider Installer auf `available` wechseln. Download-URLs aus ID bauen, niemals
  GitHubs repoübergreifendes `releases/latest` verwenden.
- `src/i18n.ts`: Deutsch ist kanonisch, Englisch muss dieselben Schlüssel besitzen.
  Alle Nutzertexte in beiden Sprachen pflegen. `/` ist DE, `/en/` EN. Impressum
  und Datenschutz sind bewusst Deutsch; englische Footer-Links kennzeichnen das.
- Anbieterangaben aus der übernommenen Landing beibehalten; bei sachlichen
  Änderungen aktuell verifizieren. Hostingangaben mit tatsächlichem Betrieb
  abgleichen, keine Aufbewahrungsfristen oder abgeschlossenen Verträge erfinden.
- Vor Abschluss `pnpm --filter @agentz/site typecheck` und `pnpm build:site`;
  Desktop/Mobil und beide Sprachen einmal visuell prüfen. Ein Build ist keine
  Veröffentlichung. Domain/Vercel/DNS liegen bei Timo.
- Bei neuen Apps oder geändertem Namen/Icon immer auch `src/apps.ts` prüfen.
