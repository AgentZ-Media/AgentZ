-- v7: Redesign „Werkbank" - Stufen für Skripte und Zielbereich je Ordner.
--
-- Rein additiv, kein bestehendes Feld wird angefasst:
--
-- 1. scripts.status: Produktionsstufe eines Skripts
--    ('writing' | 'ready' | 'shot' | 'online'). Bestandsskripte starten
--    über den Default bei 'writing' (= Schreiben), genau wie neue Skripte.
--    Validiert wird in TypeScript (lib/scripts.ts::setScriptStatus); ein
--    CHECK-Constraint ließe sich in SQLite später nicht mehr erweitern,
--    ohne die Tabelle neu aufzubauen.
-- 2. scripts.status_changed_at: Zeitpunkt (Unix-Millis) des letzten
--    Stufenwechsels. NULL = Stufe wurde noch nie geändert.
-- 3. folders.length_min_sec / folders.length_max_sec: Zielbereich für die
--    Laufzeit in ganzen Sekunden (siehe docs/feature-laengenziel.md).
--    NULL = Grenze nicht gesetzt; beide NULL = kein eigener Bereich, dann
--    greift der Standard-Zielbereich aus den Einstellungen
--    (length_min_default_sec / length_max_default_sec, Key/Value in
--    settings, braucht keine Migration). Minimum < Maximum prüft
--    lib/storage.ts::validateLengthRange beim Schreiben.
--
-- Die Reduktion auf drei Blocktypen (Parenthetical, Kamera, Caption, SFX
-- werden zu Action) ist bewusst KEINE SQL-Migration: content_json ist ein
-- Lexical-JSON-Blob, den TypeScript umschreibt
-- (lib/legacyBlocksMigration.ts, einmalig beim Start, Flag
-- migration.legacy_blocks_v1 in app_state). Alle Lesepfade normalisieren
-- zusätzlich on-the-fly.

ALTER TABLE scripts ADD COLUMN status TEXT NOT NULL DEFAULT 'writing';
ALTER TABLE scripts ADD COLUMN status_changed_at INTEGER;

CREATE INDEX IF NOT EXISTS idx_scripts_status ON scripts(status);

ALTER TABLE folders ADD COLUMN length_min_sec INTEGER;
ALTER TABLE folders ADD COLUMN length_max_sec INTEGER;
