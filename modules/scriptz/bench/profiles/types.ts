// A demo user of ScriptZ: settings, folders, scripts, memory and ideas, as
// they would be in the app's database. The benchmark seeds each profile
// into a fresh database through the app's own storage functions.

import type { MemoryKind } from "../../lib/agent/memory";

export interface ProfileScript {
  /** Key the tasks use to find the script (ids are generated). */
  key: string;
  title: string;
  folder: string;
  /** Stage id (writing, ready, online, ...). */
  stage: string;
  /** Script text in the draft format: `NAME: line`, `NAME (cue): line`,
   *  `ACTION: what we see`, one block per line. */
  body: string;
}

export interface ProfileMemory {
  kind: MemoryKind;
  /** Folder key; null = all folders. */
  folder: string | null;
  /** Character name, or "A|B" for a relation. */
  subject?: string;
  content: string;
}

export interface Profile {
  id: string;
  name: string;
  /** One sentence about the user, shown in the bench app. */
  about: { de: string; en: string };
  language: "de" | "en";
  /** Rows of the settings table (keys as the app stores them). */
  settings: Record<string, string>;
  folders: { key: string; name: string; minSec: number | null; maxSec: number | null }[];
  scripts: ProfileScript[];
  memory: ProfileMemory[];
  ideas: { title: string; notes: string; folder: string | null }[];
}
