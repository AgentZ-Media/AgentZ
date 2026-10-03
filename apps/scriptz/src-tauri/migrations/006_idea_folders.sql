-- v6: Ideen in Ordner einsortieren.
--
-- Ideen teilen sich ab jetzt dieselben Ordner wie Skripte (die bestehende
-- folders-Tabelle). Ein Ordner "Kunde X" kann damit dessen Ideen UND Skripte
-- halten. Schema-Migration ist additiv: eine nullbare FK auf folders, exakt
-- nach dem Vorbild von scripts.folder_id. ON DELETE SET NULL haelt die Idee am
-- Leben, wenn ihr Ordner geloescht wird - sie faellt dann in "Kein Ordner"
-- zurueck, statt mit dem Ordner zu verschwinden. Bestehende Ideen starten mit
-- folder_id = NULL (kein Ordner), was dem heutigen Verhalten entspricht.
ALTER TABLE ideas ADD COLUMN folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ideas_folder ON ideas(folder_id);
