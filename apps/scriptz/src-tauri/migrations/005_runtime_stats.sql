-- Persistierte Eingangswerte für die Spielzeit-Schätzung.
--
-- Vorher hat die Browser-Übersicht `last_word_count` (Gesamtwörter aller
-- Blocktypen) durch die Dialog-WPM geteilt und damit Charakter-Namen,
-- Parentheticals, Action-Texte, Captions und SFX so behandelt, als würde
-- man sie sprechen. Ergebnis: die Übersicht zeigte deutlich längere
-- Spielzeiten als die Editor-Rail desselben Skripts. Die Rail rechnet
-- nur Dialog-Wörter / WPM + 2s pro Action/Camera-Block.
--
-- Mit dieser Migration ziehen wir die zwei Eingangsgrößen als Spalten
-- raus. lib/scripts.ts schreibt sie bei jedem Save (genau einmal),
-- lib/runtime.ts wendet die Formel an, Rail und Übersicht zeigen
-- danach garantiert denselben Wert. WPM bleibt eine Live-Setting und
-- wird nicht persistiert, damit eine Setting-Änderung sofort überall
-- greift.
--
-- Sentinel -1 = "noch nie gemessen". Identisches Muster wie
-- `last_word_count` aus Migration 004. Beim ersten Save nach dem
-- Update werden die Werte normalisiert; ein Boot-Backfill in
-- App.tsx zieht Bestandsskripte ohne Save-Touch nach.

ALTER TABLE scripts ADD COLUMN dialog_word_count INTEGER NOT NULL DEFAULT -1;
ALTER TABLE scripts ADD COLUMN direction_block_count INTEGER NOT NULL DEFAULT -1;
