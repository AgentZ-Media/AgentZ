// Canonical catalog. German is the reference language - en.ts is
// type-checked against `keyof typeof de`, so TypeScript complains
// about missing or extra keys.
//
// Conventions:
//  - Flat dot namespaces ("browser.empty.title") instead of nested
//    objects. Makes TypeScript inference for t() trivial and searching
//    for a spot in the code easy.
//  - Placeholders with `{name}` (e.g. "Moved to „{folder}"").
//  - Plural rules via `_one`/`_other` suffix using Intl.PluralRules.

import { shellDe } from "./parts/shell";
import { scriptDe } from "./parts/script";
import { dialogsDe } from "./parts/dialogs";
import { agentDe } from "./parts/agent";

export const de = {
  // ---------- units (with plurals) ----------
  "units.scripts_one": "{count} Skript",
  "units.scripts_other": "{count} Skripte",
  "units.pages_one": "1 Seite",
  "units.pages_other": "{count} Seiten",
  "units.words": "Wörter",
  "units.word_one": "Wort",
  "units.word_other": "Wörter",
  "units.ideas_one": "{count} Idee",
  "units.ideas_other": "{count} Ideen",

  // ---------- block types ----------
  "block.action": "Action",
  "block.character": "Charakter",
  "block.dialog": "Dialog",
  "block.parenthetical": "Paren.",

  // ---------- script stages (Werkbank pipeline) ----------
  "stage.idea": "Idee",
  "stage.writing": "Schreiben",
  "stage.ready": "Drehbereit",
  "stage.shot": "Gedreht",
  "stage.online": "Online",

  // ---------- length goal (target range) ----------
  "length.range.both": "{min}-{max}",
  "length.range.maxOnly": "bis {max}",
  "length.range.minOnly": "ab {min}",

  // ---------- browser / file overview ----------
  "browser.import.title": "ScriptZ-Datei importieren",
  "browser.fileType": "ScriptZ-Datei",
  "browser.trash": "Papierkorb",
  "browser.newScript": "Neues Skript",
  "browser.empty.search.title": "Nichts gefunden für „{query}\"",
  "browser.empty.folder.title": "„{folder}\" ist leer.",
  "browser.canvas.newFolder": "Neuer Ordner",
  "browser.loadMore": "{n} weitere laden",
  "browser.sort.updated": "Geändert",
  "browser.sort.created": "Erstellt",
  "browser.sort.title": "Titel",
  "browser.sort.label": "Sortieren · {value}",
  "browser.rowMore": "Mehr Aktionen",

  // ---------- folder operations ----------
  "folder.inbox": "Ohne Ordner",
  "folder.new": "Neuer Ordner",
  "folder.newDots": "Neuer Ordner…",
  "folder.none": "Kein Ordner",
  "folder.placeholder": "z. B. TikTok",
  "folder.createTitle": "Neuer Ordner",
  "folder.createSubmit": "Anlegen",
  "folder.renameLabel": "Neuer Name",
  "folder.deleteTitle": "„{name}\" löschen?",
  "folder.deleteBody.empty": "Der Ordner ist leer.",
  "folder.deleteBody.one": "Das eine Skript darin bleibt erhalten und ist danach unter „Alle Skripte\" zu finden.",
  "folder.deleteBody.many": "Die {count} Skripte darin bleiben erhalten und sind danach unter „Alle Skripte\" zu finden.",
  "folder.menu.rename": "Umbenennen",
  "folder.menu.delete": "Ordner löschen",
  "folder.toast.created": "Ordner „{name}\" angelegt",
  "folder.toast.renamed": "Ordner umbenannt",
  "folder.toast.deleted": "Ordner „{name}\" gelöscht",
  "folder.toast.movedTo": "Verschoben nach „{name}\"",

  // ---------- script row/card + context menu ----------
  "script.titleLabel": "Neuer Titel",
  "script.renameTitle": "Umbenennen",
  "script.renameEmptyHint": "Titel darf nicht leer sein.",
  "script.menu.open": "Öffnen",
  "script.menu.openPanel": "Im Seitenpanel öffnen",
  "script.menu.openNewTab": "In neuem Tab öffnen",
  "script.menu.rename": "Umbenennen",
  "script.menu.duplicate": "Duplizieren",
  "script.menu.move": "In Ordner verschieben",
  "script.menu.trash": "In Papierkorb verschieben",
  "script.toast.archived": "„{title}\" in den Papierkorb verschoben",
  "script.toast.duplicated": "Skript dupliziert",
  "script.toast.renamed": "Umbenannt",
  "script.toast.imported": "Skript importiert",
  "script.toast.importFailed": "Import fehlgeschlagen: {message}",
  "script.toast.created": "„{title}\" angelegt",
  "script.duplicateSuffix": " (Kopie)",
  "script.titleAriaLabel": "Skript-Titel",

  // ---------- trash view ----------
  "trash.empty": "Der Papierkorb ist leer.",
  "trash.restoreAll": "Alle wiederherstellen",
  "trash.emptyAll": "Papierkorb leeren",
  "trash.restoreOne": "Wiederherstellen",
  "trash.purgeOne": "Endgültig löschen",
  "trash.deletedAt": "Gelöscht {when}",
  "trash.confirm.restoreAll.title": "Alle wiederherstellen?",
  "trash.confirm.restoreAll.body_one": "{count} Skript wird aus dem Papierkorb wiederhergestellt.",
  "trash.confirm.restoreAll.body_other": "Alle {count} Skripte werden aus dem Papierkorb wiederhergestellt.",
  "trash.confirm.empty.title": "Papierkorb leeren?",
  "trash.confirm.empty.body_one": "{count} Skript wird unwiderruflich gelöscht. Diese Aktion kann nicht rückgängig gemacht werden.",
  "trash.confirm.empty.body_other": "Alle {count} Skripte werden unwiderruflich gelöscht. Diese Aktion kann nicht rückgängig gemacht werden.",
  "trash.confirm.purge.title": "Endgültig löschen?",
  "trash.confirm.purge.body": "„{title}\" wird unwiderruflich gelöscht.",
  "trash.toast.restoredAll_one": "{count} Skript wiederhergestellt",
  "trash.toast.restoredAll_other": "{count} Skripte wiederhergestellt",
  "trash.toast.emptied": "Papierkorb geleert",
  "trash.toast.restored": "Wiederhergestellt",
  "trash.toast.purged": "Endgültig gelöscht",
  "trash.confirm.empty.button": "Leeren",

  // ---------- activity modal ----------
  "activity.activeDaysNone": "Noch keine Schreibtage",
  "activity.heatmap.title": "Aktivität · 365 Tage",
  "activity.heatmap.activeDays": "{count} aktive Tage",
  "activity.heatmap.aria": "Aktivitätsverlauf der letzten 365 Tage",
  "activity.heatmap.less": "Weniger",
  "activity.heatmap.more": "Mehr",
  "activity.heatmap.tooltip.noActivity": "{date} · keine Aktivität",
  "activity.heatmap.tooltip.words_one": "{date} · {count} Wort",
  "activity.heatmap.tooltip.words_other": "{date} · {count} Wörter",

  // ---------- editor (general) ----------
  "editor.empty.hint": "Tippe los · {tab} wechselt den Block-Typ · {first}–{last} direkt",

  // ---------- validation errors (thrown from lib, surfaced as toasts) ----------
  "folder.error.emptyName": "Ordnername darf nicht leer sein",
  "folder.error.lengthInvalid": "Die Zielzeit muss eine ganze Zahl von Sekunden sein (0 oder mehr).",
  "folder.error.lengthOrder": "Das Minimum muss kleiner als das Maximum sein.",
  "idea.error.emptyTitle": "Ideen-Titel darf nicht leer sein",

  // ---------- editor toolbar ----------
  "editor.loading": "Lade…",
  "editor.toast.snapshotSaved": "Version gespeichert",
  "editor.toast.snapshotError": "Version konnte nicht gesichert werden: {message}",
  "editor.toast.renameFailed": "Umbenennen fehlgeschlagen: {message}",
  "editor.toast.highlightFailed": "Highlight-Wechsel fehlgeschlagen: {message}",
  "editor.toast.resetDone": "Skript zurückgesetzt. Eine Version des alten Inhalts liegt in den Versionen.",
  "editor.toast.resetFailed": "Reset fehlgeschlagen: {message}",
  "editor.recovery.title": "Skript-Inhalt nicht lesbar",
  "editor.recovery.body": "Die gespeicherte Struktur dieses Skripts konnte nicht geladen werden. Damit dein Inhalt nicht durch eine leere Version überschrieben wird, ist der Editor pausiert.",
  "editor.recovery.hint": "Empfohlen: Öffne die Versionen und stelle eine ältere wieder her - dort liegen alle automatisch gesicherten Stände.",
  "editor.recovery.openSnapshots": "Versionen öffnen",
  "editor.recovery.reset": "Trotzdem leer fortfahren",
  "editor.recovery.resetting": "Setze zurück…",
  "editor.recovery.tech": "Technische Info",

  // ---------- runtime label format ----------
  "runtime.seconds": "{n} s",
  "runtime.minutes": "{m} Min",
  "runtime.minutesSeconds": "{m}:{s} Min",

  // ---------- snapshots dialog ----------
  "snapshots.title": "Versionen",
  "snapshots.titleWithScript": "Versionen - {title}",
  "snapshots.createManual": "Jetzt eine Version sichern",
  "snapshots.restore": "Wiederherstellen",
  "snapshots.delete": "Löschen",
  "snapshots.empty": "Noch keine Versionen.",
  "snapshots.noneSelected": "Keine Version ausgewählt.",
  "snapshots.previewBroken": "Diese Version lässt sich nicht anzeigen - ihr Inhalt ist beschädigt.",
  "snapshots.badge.manual": "Manuell",
  "snapshots.badge.auto": "Auto",
  "snapshots.toast.created": "Version gesichert",
  "snapshots.toast.createFailed": "Version konnte nicht gesichert werden: {message}",
  "snapshots.toast.deleted": "Version gelöscht",
  "snapshots.toast.deleteFailed": "Löschen fehlgeschlagen: {message}",
  "snapshots.toast.restored": "Version wiederhergestellt",
  "snapshots.toast.restoreFailed": "Wiederherstellen fehlgeschlagen: {message}",
  "snapshots.confirm.delete.title": "Version löschen?",
  "snapshots.confirm.delete.body": "Diese Version wird unwiderruflich entfernt.",
  "snapshots.confirm.restore.title": "Version wiederherstellen?",
  "snapshots.confirm.restore.body": "Der aktuelle Stand wird vorher automatisch als Version gesichert. Fortfahren?",

  // ---------- export dialog ----------
  "export.button": "Exportieren",
  "export.exporting": "Exportiere…",
  "export.help.scriptz": "Eine ScriptZ-Datei enthält dieses Skript als Container und kann auf einem anderen Gerät importiert werden (Datei → Importieren). Nur das aktuelle Skript - ohne Ordner-Zuordnung, ohne Versions-Verlauf.",
  "export.toast.saved": "Export gespeichert",
  "export.toast.savedAt": "Export gespeichert: {path}",
  "export.toast.downloaded": "Datei heruntergeladen",
  "export.toast.failed": "Export fehlgeschlagen: {message}",
  "export.pdf.characters": "Charaktere: {names}",
  "export.pdf.runtime": "Laufzeit {time}",
  "export.pdf.page": "Seite {page} von {total}",

  // ---------- selection mode ----------
  "select.enter": "Auswählen",
  "select.exit": "Fertig",
  "select.count": "{count} ausgewählt",
  "select.selectAll": "Alle",
  "select.all": "Alle auswählen",
  "select.group": "Alle in „{name}“ auswählen",
  "select.clear": "Auswahl aufheben",
  "select.action.pdf": "Als PDF",
  "select.empty": "Nichts ausgewählt.",
  "select.pdf.toast_one": "{count} Skript als PDF exportiert",
  "select.pdf.toast_other": "{count} Skripte als PDF exportiert",
  "select.pdf.failed": "PDF-Export fehlgeschlagen: {message}",

  // ---------- settings ----------
  "settings.characters.colorAria": "Farbe von {name} ändern",
  "settings.characters.reset": "Zurücksetzen",
  "settings.about.sub": "Schnell. Lokal. Ohne Konto.",
  "settings.about.license": "Lizenz: MIT",
  "settings.about.developer.linkText": "AgentZ",
  "settings.about.repository.linkText": "github.com/AgentZ-Media/AgentZ",
  "settings.toast.colorFailed": "Farbe speichern fehlgeschlagen: {message}",
  "settings.toast.resetFailed": "Reset fehlgeschlagen: {message}",

  // ---------- ideas ----------
  "ideas.card.linked.title": "Verbundenes Skript öffnen",
  "ideas.card.linked.stale": "Skript gelöscht",
  "ideas.confirm.delete.title": "Idee löschen?",
  "ideas.confirm.delete.body": "„{title}\" wird endgültig gelöscht. Ein eventuell verknüpftes Skript bleibt bestehen.",
  "ideas.toast.deleted": "„{title}\" gelöscht",

  // ---------- IdeaQuickCapture ----------
  "idea.quick.toast.remembered": "Idee „{title}\" gemerkt",

  // ---------- status strip ----------
  "save.navigationBlocked": "Änderungen konnten nicht gespeichert werden. Bitte versuche es erneut.",
  "save.error.toast": "Skript konnte nicht gespeichert werden: {message}",

  // ---------- character / color picker ----------
  "charDropdown.colorAria": "Farbe von {name} ändern",
  "colorPicker.aria": "Farbe für {name}",
  "colorPicker.placeholder": "#rrggbb",
  "colorPicker.apply": "OK",
  "colorPicker.reset.title": "App-weiten Override löschen - die Farbe fällt auf den nächsten freien Palette-Slot zurück.",
  "colorPicker.reset.label": "Auf Standard zurücksetzen",

  // ---------- boot / errors ----------
  "boot.loadingScript": "Lade Skript…",
  "boot.error.title": "ScriptZ konnte nicht starten",
  "boot.error.lede": "Die Datenbank-Datei konnte nicht geöffnet werden. Deine Skripte sind vermutlich nicht verloren - die Datei liegt unverändert im App-Datenverzeichnis. Bitte den Fehler unten kopieren und an uns weiterleiten.",

  // ---------- thrown errors (user-facing) ----------
  "error.ideaAlreadyConverted": "Idee wurde bereits konvertiert.",
  "error.scriptz.invalidContent": "content_json ist kein gültiges JSON: {message}",
  "error.scriptz.notUtf8": "Datei ist nicht gültiges UTF-8: {message}",
  "error.scriptz.notJson": "Datei ist kein JSON: {message}",
  "error.scriptz.notObject": "Datei-Inhalt ist kein Objekt.",
  "error.scriptz.badFormat": "Format-Marker fehlt oder falsch (erwartet \"scriptz\", war {value}).",
  "error.scriptz.unsupportedVersion": "Version {version} wird nicht unterstützt - diese App liest nur Version 1.",
  "error.scriptz.missingScript": "Feld `script` fehlt oder ist kein Objekt.",
  "error.scriptz.missingTitle": "Feld `script.title` fehlt oder ist kein String.",
  "error.scriptz.missingContent": "Feld `script.contentJson` fehlt oder ist kein Objekt.",
  "error.scriptz.missingCharacters": "Feld `script.characters` fehlt oder ist kein Array.",
  "error.scriptz.invalidCharacter": "script.characters[{index}] hat ungültige name/color-Felder.",

  // ---------- redesign parts ----------
  ...shellDe,
  ...scriptDe,
  ...dialogsDe,
  ...agentDe,
} as const;
