-- v3 Re-Design: Ideen-Inbox + tägliche Wortprotokollierung.
--
-- Zwei orthogonale Erweiterungen für die neue Home-Ansicht (Ideen-Drawer,
-- Streak/Heatmap/Tagesziel). Schema-Migration ist additiv - keine
-- Spalte wird entfernt, kein vorhandener Datensatz mutiert. Bestehende
-- Skripte starten mit last_word_count = 0; der erste Save nach dem
-- Update zählt deshalb den vollen Wortbestand als "heute geschrieben".
-- Das ist Absicht: ein Update-Tag soll das Streak-Zähler-Onboarding
-- sein, nicht rückwirkend alle alten Skripte als "0 Tage Streak"
-- zeigen.

-- Letzter beim Save berechneter Gesamt-Wortcount des Skripts. Wird vom
-- Diff-on-Save-Pfad in lib/scripts.ts gelesen und zurückgeschrieben,
-- um den positiven Delta in daily_word_log einzutragen.
ALTER TABLE scripts ADD COLUMN last_word_count INTEGER NOT NULL DEFAULT 0;

-- Ideen-Inbox. Eine Idee = ein Titel (Pflicht) + optionale Notiz.
-- Ein Klick auf "Skript -" macht aus der Idee ein neues Skript;
-- script_id verweist dann darauf. ON DELETE SET NULL hält die Idee am
-- Leben, wenn das daraus entstandene Skript gelöscht wird (sie wird im
-- "Verwendet"-Tab dann ohne Link angezeigt - der Hinweis "ist im
-- Papierkorb" wäre zu viel UI für ein Randfall).
CREATE TABLE IF NOT EXISTS ideas (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  used_at INTEGER,
  script_id TEXT REFERENCES scripts(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_ideas_created ON ideas(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ideas_used    ON ideas(used_at);

-- Tägliche Schreibstatistik. Ein Eintrag pro Kalendertag (lokale
-- Zeitzone, YYYY-MM-DD), summiert alle positiven Wortanstiege über
-- alle Skripte hinweg. Füttert Streak und Heatmap (siehe
-- lib/dailyWords.ts). Tage ohne Schreibaktivität haben keinen Eintrag;
-- die Heatmap interpretiert fehlende Tage als 0 Wörter.
CREATE TABLE IF NOT EXISTS daily_word_log (
  date TEXT PRIMARY KEY,
  words_added INTEGER NOT NULL DEFAULT 0
);
