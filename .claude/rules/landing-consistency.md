---
paths:
  - "apps/landing/**"
  - "apps/desktop/src/**"
  - "apps/web/src/**"
  - "packages/core/components/**"
  - "packages/core/styles/**"
  - "packages/core/i18n/**"
  - "packages/design/**"
---

# Konsistenz App ↔ Landing

Die Landing ist das **Schaufenster** der App. Wenn an der App etwas
verändert wird, muss die Landing nachgezogen werden, sonst zeigt sie
ein Produkt, das es so nicht mehr gibt. Vor dem Abschluss einer
App-Aufgabe immer prüfen, ob die Landing mit betroffen ist. Bei
Unsicherheit lieber kurz beim User nachfragen statt auseinanderlaufen
lassen.

Wo was auf der Landing lebt (alles unter `apps/landing/src/`):

- [`components/AppShell.astro`](apps/landing/src/components/AppShell.astro) -
  Demo-Chrome im Werkbank-Look: dunkle Seitenleiste (App-Mark, Routen
  als Links, Ideen-Zähler, Wort-Zähler im Fuß), Kopfleiste (Verlauf-
  Pfeile, Breadcrumb, „Gespeichert", Stufen-Chip, Sprach-Toggle,
  Download-Button), weißes Papier in der Mitte, schwebende
  Laufzeit-Pille (`v2-runpill`) mit Scroll-Fortschritt.
- [`components/sections/`](apps/landing/src/components/sections/) -
  Inhalt pro Route: `HomeSection` (Screenshot-Galerie + Feature-Teaser),
  `WarumSection`, `IdeenSection` (statischer Nachbau der Ideen-Seite),
  `QuickmodusSection` (Editor-Demo mit Action/Charakter/Dialog-Blöcken;
  Parentheticals stehen als eigene Zeile in `WarumSection` und
  `NoAiSection`),
  `VergleichSection` (Vergleichstabelle), `NoAiSection`,
  `DownloadSection`, `PageHero`.
- [`public/img/app/`](apps/landing/public/img/app/) - App-Screenshots
  (`overview.png`, `ideas.png`, `editor.png`).
- [`i18n/de.ts` / `en.ts`](apps/landing/src/i18n/) - alle Texte.

Auslöser, bei denen die Landing **mit** angepasst werden muss:

| Änderung in der App (Desktop oder Web) | Was in der Landing folgen muss |
|---|---|
| Neues Feature, das ein User merkt | Ggf. Aufnahme in die Feature-Teaser (`HomeSection`, `WarumSection`) oder die Vergleichstabelle (`VergleichSection`). Wenn es ein Top-Feature ist, eines der bestehenden ablösen. Wenn das Feature im Web *nicht* funktioniert, im Web-CTA-Hinweis ehrlich erwähnen. |
| Feature entfernt | Aus Teasern, Vergleich, Demo, Texten rauswerfen. Versprechen wie "lokal" oder "kein Konto" gegenchecken. |
| Design-Token geändert (Farbe, Schrift, Radius, Spacing) in `packages/design/` (`tokens.css`, `components.css`) oder App-Tokens in `packages/core/styles/tokens.css` | [`src/styles/tokens.css`](apps/landing/src/styles/tokens.css) bzw. [`landing.css`](apps/landing/src/styles/landing.css) angleichen, soweit die Landing den App-Look spiegelt (Seitenleiste, Kopfleiste, Stufen-Chip, Laufzeit-Pille). Die Landing importiert `@agentz/design` nicht, sie pflegt eigene Werte. |
| Editor-Layout geändert (Blocktypen, Einrückung, ALLCAPS-Regel, Spacing-Cluster) | Editor-Demo in `QuickmodusSection.astro` (und Skript-Optik in `landing.css`) so anpassen, dass sie weiterhin 1:1 dem echten Editor entspricht. Aktuell vier Blocktypen: Action, Charakter, Dialog, Parenthetical. |
| App-Chrome verändert (Seitenleiste, Kopfleiste, Stufen/Pipeline, Inspector, Zeitleiste, Laufzeit-/Fokus-Pille, Trafficlight-Position) | Demo-Chrome in `AppShell.astro` nachziehen, sonst sieht die Demo aus wie eine alte Version. |
| Ideen-Seite oder Skript-Liste verändert | `IdeenSection.astro` und die Screenshots in `public/img/app/` neu machen. |
| Stufen (Schreiben/Drehbereit/Gedreht/Online), Längenziel/Zielbereich, Schreib-Zähler | Stufen-Chip und Laufzeit-Pille in `AppShell.astro`, zugehörige Texte in `i18n/*.ts`. |
| Schriftart oder Schrift-Größen | [`src/styles/fonts.css`](apps/landing/src/styles/fonts.css) und Tokens. |
| `app_icon`, Logo, Branding (`packages/design/logo.ts`) | Icons in `apps/landing/public/img/` neu setzen, App-Mark in `AppShell.astro`. |
| Plattform-Support erweitert (z.B. Linux-Build) | Hero-Meta, `DownloadSection`, Vergleichstabelle, "First-Run"-Anleitung anpassen. |
| Lizenzmodell, Tracking-Verhalten, Konto-Verhalten | `NoAiSection`, Open-Source-Hinweise und Datenschutzerklärung gegenchecken. |
| Versionsnummer der Desktop-App | Siehe Release-Checkliste in `.claude/rules/release.md`. |
| Disclaimer-/Limit-Texte der Web-App (`apps/web/src/components/WebDisclaimerBanner.tsx`) | "Direkt im Browser testen"-CTA und der zugehörige Hinweistext auf der Landing müssen mit dem Banner-Text konsistent bleiben. |

Praktisch heißt das: nach jeder nicht-trivialen App-Änderung mit
einem Blick durch [`apps/landing/src/`](apps/landing/src/) gehen und
prüfen, ob Texte, Demo, Vergleich und Screenshots noch stimmen. Bei
reinen Bug-Fixes oder Code-Refactors ohne User-sichtbare Wirkung muss
nichts passieren.
