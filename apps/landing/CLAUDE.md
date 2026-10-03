# write-scriptz.com - Claude context

Astro-Landing für ScriptZ, Vercel-Deploy, statisch. Hosting unter
[write-scriptz.com](https://write-scriptz.com).

## Path-scoped Rules

Details lazy-load aus [`/.claude/rules/`](../../.claude/rules/):

- [`landing-blog.md`](../../.claude/rules/landing-blog.md) - Blog-
  Workflow, Schreibregeln, Anti-KI-Stil, Skript-Optik im Body, SEO/RSS,
  Markdown-Pipeline-Wartung. Lädt bei Blog-Inhalten und -Code.
- [`landing-consistency.md`](../../.claude/rules/landing-consistency.md)
  - Wann eine App-Änderung die Landing mit-anpassen muss.
- [`i18n.md`](../../.claude/rules/i18n.md) - allgemeine
  Mehrsprachigkeits-Grundsätze (gilt App + Landing).
- [`release.md`](../../.claude/rules/release.md) - zentrale Release-
  Pipeline + `fallbackVersion`-Bump.

## Aufbau

```
src/
  components/
    AppShell.astro       App-Demo-Chrome im Werkbank-Look für Landing-Routen
                         + Blog (siehe "Demo-Chrome"), inkl. Inline-Script
    LegalShell.astro     Editor-Optik-Wrapper für Impressum/Datenschutz
    SiteFooter.astro     EIN Footer für alle Shells (Blog, RSS, GitHub, Recht, Über)
    MobileNav.astro      Sticky Top-Bar + Drawer für <= 768 px
    blog/
      BlogIndex.astro      Übersichts-Liste auf /blog und /en/blog
      BlogPost.astro       Detail-Seite eines einzelnen Beitrags
    sections/            Sektion-Markup pro Route: PageHero, HomeSection,
                         WarumSection, IdeenSection, QuickmodusSection,
                         VergleichSection, NoAiSection, DownloadSection
  content/
    blog/<slug>/         Ein Ordner pro Beitrag, mit de.md + en.md + Bildern
    _example/de.md       Lebende Referenz, taucht nicht öffentlich auf
  content.config.ts      Zod-Schema für die Blog-Collection
  lib/
    remarkDialogue.mjs   Remark-Plugin: `> **NAME:** ...` → Skript-Dialog-Block
    blog.ts              getPosts/getPost/Slug-Parsing/Reading-Time
  data/site.ts           Zentrale Site-Konstanten + GitHub-Release-Fetch
  i18n/                  Mehrsprachige Strings (siehe Abschnitt unten)
    de.ts                  Deutsche Strings (Source of truth)
    en.ts                  Englische Strings (`Record<keyof typeof de, ...>`)
    index.ts               t()/tFormat()/tPlural()-Helper, Lang/Route-Typen
  layouts/Base.astro     Head, Meta, hreflang, Auto-Detect-Redirect, Reveal-Observer
  pages/
    index.astro            `/` - DE-Default: Base + AppShell + PageHero + HomeSection
    en/index.astro         `/en` - EN-Variante, gleicher Aufbau
    warum-scriptz, ideen, quickmodus, vergleich, keine-ki, download
                           Unterrouten (DE), EN-Pendants unter en/ mit
                           englischen Slugs (why-scriptz, ideas, ...)
    impressum.astro        `/impressum` - DE-only (Rechts-bedingt)
    datenschutz.astro      `/datenschutz` - DE-only (Rechts-bedingt)
    blog/index.astro       `/blog` + `/blog/[slug].astro` - Blog DE
    en/blog/index.astro    `/en/blog` + `/en/blog/[slug].astro` - Blog EN
    rss.xml.ts             `/rss.xml` - DE-Feed
    en/rss.xml.ts          `/en/rss.xml` - EN-Feed
  styles/
    landing.css            Geteiltes Stylesheet von AppShell + Sektionen (`.v2-*`)
    blog.css               Blog-spezifisches Layering auf landing.css-Blocks
    tokens.css, fonts.css, global.css
public/                  Schrift, Icons, App-Screenshots (img/app/), robots
```

## Demo-Chrome (`AppShell.astro`)

Die Landing zeigt sich selbst als ScriptZ-Fenster im Werkbank-Look und
muss der App optisch folgen (siehe
[`landing-consistency.md`](../../.claude/rules/landing-consistency.md)):

- **Seitenleiste** (dunkel): App-Mark, Routen als echte `<a>`-Links
  (Home, Ideen mit Zähler, Gruppe „Skripte" mit den Unterrouten), im
  Fuß ein Wort-Zähler, der die Wörter der aktuellen Seite zählt (Echo
  des Schreib-Zählers der App).
- **Kopfleiste**: Verlauf-Pfeile, Breadcrumb `ScriptZ / <Titel>`,
  „Gespeichert", Stufen-Chip (Online), DE/EN-Toggle, Open-Source-Pille,
  Download-Button (Mac/Windows per JS).
- **Papier** in der Mitte mit dem Sektion-Inhalt und dem `SiteFooter`.
- **Laufzeit-Pille** (`#runpill`, unten rechts): schätzt, wie lange die
  Seite vorgelesen dauert, und zeigt den Scroll-Fortschritt als
  Abspielposition (Echo der Laufzeit-Schätzung der App).

Die Landing importiert weder `@scriptz/core` noch `@agentz/design`; die
Werte in `styles/tokens.css` und `landing.css` (`--v2-*`) werden bei
Design-Änderungen in der App von Hand angeglichen.

## Konventionen

- **Hellmodus only**, monochrom. Akzent ist Tinten-Schwarz, nicht
  Orange. Die dunkle Seitenleiste der Demo ist App-Echo, kein
  Dunkelmodus. Status-Indikatoren in Tabellen / Checklisten dürfen
  Farbe tragen (grün/grau/gelb), ebenso die Charakter-Tönungen in der
  Editor-Demo (`--v2-tint-*`, wie die Hervorhebung in der App), sonst
  nichts.
- **Karo-Hintergrund** - Echo des App-Icons, durch Repeating-Gradient
  auf body in [`src/styles/global.css`](src/styles/global.css). Werte
  in [`src/styles/tokens.css`](src/styles/tokens.css) (`--grid-line`,
  `--grid-cell`). Die Demo-Shell (`.v2-shell`, `--v2-bg`) legt ihren
  eigenen Hintergrund darüber; sichtbar bleibt das Karo z.B. auf den
  Rechtsseiten (`LegalShell`).
- **Karten verdecken das Karo**, dashed-Border-Boxen zeigen es durch.
- **Schrift: iA Writer Quattro**, selbst gehostet (`public/fonts/`),
  kein CDN, kein Tracker.
- **Deutsche Texte**, normale Bindestriche statt Em-Dashes,
  Umlaute statt ae/oe/ue. Gilt für die DE-Hälfte der i18n-Kataloge
  und interne Docs. Code-Kommentare laufen auf Englisch (siehe
  Root-`CLAUDE.md`).

## Landing-spezifische i18n-Mechanik

Allgemeine Mehrsprachigkeits-Regeln (User-sichtbar, Anti-Pattern,
Sprachpflege) stehen zentral in
[`/.claude/rules/i18n.md`](../../.claude/rules/i18n.md). Hier nur die
Landing-Spezifika, die in der App nicht vorkommen:

**Routing:**

- `/` → Deutsch (Default-Sprache, kein Pfad-Prefix)
- `/en` → Englisch
- `/impressum`, `/datenschutz` → **bleiben DE-only** (deutsches Recht,
  Auto-Redirect ignoriert diese Pfade)

Erkennung beim Erstbesuch via `navigator.language` in
[`layouts/Base.astro`](src/layouts/Base.astro), dazu ein DE/EN-Toggle
oben rechts in der Titlebar. Nutzer-Wahl wird in
`localStorage["scriptz-lang"]` persistiert, damit der Auto-Redirect
nach dem ersten Wechsel niemanden mehr umbiegt.

**Landing-spezifische "User-sichtbar"-Stellen** (ergänzt die zentrale Liste):

- `data-title`, `data-label` etc., wenn JS daraus User-Text macht
  (siehe Laufzeit-Pille `data-label` und Kopfleisten-Titel
  `data-title-mac` / `data-title-win`)
- Meta-Tags (`<title>`, `description`, OG, Twitter) - bereits via
  `t(lang, "meta.*")` in `Base.astro` parametrisiert
- Strings, die im inline-`<script>` von `AppShell.astro` durch
  `define:vars={{ jsStrings }}` reingegeben werden (Copy-Button,
  Laufzeit-Pillen-Label, Wort-Einheit + Locale des Seitenleisten-
  Zählers) - **nicht** direkt aus `t()` heraus, das Script läuft im
  Browser ohne Astro-Kontext

**Wann eine Sprach-Differenz OK ist:** Nur wenn rechtlich oder
kontextuell unausweichlich. Aktueller einziger Fall: **Impressum und
Datenschutz bleiben deutsch** (deutsches Recht, deutscher Anbieter).
Auto-Redirect ignoriert diese Pfade, hreflang-en wird auf ihnen nicht
gesetzt, der Sprach-Toggle erscheint dort nicht. Wenn jemals
englisch-rechtliche Pendants nötig werden, eigene
`pages/en/impressum.astro` / `pages/en/datenschutz.astro` anlegen und
die Sonderfall-Logik in `src/i18n/index.ts` (Funktion `localePath` und
`switchLangPath`) sowie in `Base.astro` (`isLegal`-Check) entfernen.

**Landing-spezifisches Anti-Pattern:** Neue Page anlegen, die
`AppShell` umgeht und eigenen Text inline einbettet, statt durch i18n
zu gehen. DE-only-Page hinzufügen, ohne in
[`src/i18n/index.ts`](src/i18n/index.ts) (`localePath` /
`switchLangPath`) zu spezifizieren, dass dieser Pfad vom Sprach-Routing
ausgenommen ist.

## Versionsnummer

Wird zur Build-Zeit von der GitHub-Releases-API geholt
([`src/data/site.ts`](src/data/site.ts) → `getLatestRelease()`).
Fail-soft mit Fallback `site.fallbackVersion`.

**Wichtig:** Vercel reagiert nur auf Git-Push, nicht auf
GitHub-Release-Events. Ein Push, der einen Tag mitschickt, triggert
Vercel **sofort** - bevor der Release-Workflow auf macOS-26 fertig
gebaut und den Release publiziert hat. Der Vercel-Build sieht zu dem
Zeitpunkt also noch die *vorherige* Version in der Releases-API und
backt die in die statische Site ein.

Damit das funktioniert, ruft
[`/.github/workflows/release.yml`](../../.github/workflows/release.yml)
am Ende des Build-Jobs einen Vercel-Deploy-Hook auf
(Secret `VERCEL_DEPLOY_HOOK_URL`). Dadurch baut Vercel die Landing
ein zweites Mal - jetzt mit der frisch publizierten Release-Version.

Bei jedem Release auch [`fallbackVersion`](src/data/site.ts) auf den
neuen Tag bumpen, sonst zeigt die Landing bei einem GitHub-API-Ausfall
während des Builds eine veraltete Version. Vollständige Release-Checkliste:
[`/.claude/rules/release.md`](../../.claude/rules/release.md).

## Befehle

Vom Repo-Root:

```bash
pnpm dev:landing        # Astro-Devserver
pnpm build:landing      # statische Site nach dist/
pnpm typecheck          # astro check
```

Direkt in diesem Verzeichnis funktionieren auch `pnpm dev`,
`pnpm build`, `pnpm preview`.

## Don'ts

- Keine Tracker, kein Analytics, kein CDN. Wer eine "wir tracken
  nichts"-Page baut, soll auch keine Beacons feuern.
- Keine Brand-Akzentfarbe (Orange) wieder einführen, ohne dass die
  App sie ebenfalls trägt. Aktuell sind beide bewusst schwarz/weiß.
- Versionsnummer **nicht** hardcoden. `fallbackVersion` ist nur das
  Sicherheitsnetz, falls GitHub beim Build down ist.
