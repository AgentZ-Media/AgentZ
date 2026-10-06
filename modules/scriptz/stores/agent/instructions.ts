import type { Accessor } from "solid-js";
import { language } from "@agentz/kit/i18n";
import { api } from "../../lib/api";
import type { Folder } from "../../lib/types";
import { draftStates, type ChatItem } from "../../lib/agent/chats";
import { draftRuntime } from "../../lib/agent/drafts";
import { formatClock } from "../../lib/lengthGoal";
import { listMemory, selectRelevantMemory } from "../../lib/agent/memory";
import { buildInstructions, contextBlock, memoryBlock, type InstructionMode } from "../../lib/agent/prompt";
import { blocksFromContent, charactersIn } from "../../lib/agent/scriptText";
import { stageNames } from "../../lib/agent/tools";
import { describeTarget, writingTarget, type Pace } from "../../lib/agent/writingContext";
import { settingsStore } from "../settings";
import { agentSettings } from "../agentSettings";
import { liveBlocks } from "../../components/Agent/editorBridge";

// ---------------------------------------------------------------------------
// Instructions
// ---------------------------------------------------------------------------

export function persona() {
  return {
    name: agentSettings.displayName(),
    userName: agentSettings.userName(),
    traits: agentSettings.traits(),
    instructions: agentSettings.instructions(),
    language: language(),
  };
}

export async function foldersMap(): Promise<Map<string, Folder>> {
  const list = await api.listFolders().catch(() => [] as Folder[]);
  return new Map(list.map((f) => [f.id, f]));
}

/** Speaking pace and default length target from the product settings. */
export function currentPace(): Pace {
  return {
    wpm: settingsStore.dialogWpm(),
    defaults: { minSec: settingsStore.lengthMinDefaultSec(), maxSec: settingsStore.lengthMaxDefaultSec() },
  };
}

export async function chatInstructions(scriptId: string | null, mode: InstructionMode, sessionFolderId: string | null): Promise<string> {
  const [all, folders] = await Promise.all([listMemory().catch(() => []), foldersMap()]);
  let title: string | null = null;
  let folderId: string | null = scriptId ? null : sessionFolderId;
  let characters: string[] = [];
  if (scriptId) {
    const script = await api.getScript(scriptId).catch(() => null);
    if (script) {
      title = script.title;
      folderId = script.folder_id;
      characters = charactersIn(liveBlocks(scriptId) ?? blocksFromContent(script.content_json));
    }
  }
  const folder = folderId ? folders.get(folderId) ?? null : null;
  const relevant = selectRelevantMemory(all, folderId, characters);
  return buildInstructions(
    persona(),
    memoryBlock(relevant, folders),
    contextBlock({
      scriptTitle: title,
      folder: folder?.name ?? null,
      characters,
      stages: stageNames(),
      // Sessions get the target with every message (the folder can change).
      target: scriptId ? describeTarget(writingTarget(folder, currentPace())) : undefined,
    }),
    agentSettings.learnFromChat(),
    mode,
  );
}

/** Context line in front of a session message: folder, target, pace,
 *  drafts with the runtime the draft panel shows, and saved ideas, so the
 *  model always works with what the user sees right now. Reads folder and
 *  items after the folders arrived. */
export async function sessionPreamble(folderId: Accessor<string | null>, items: () => ChatItem[]): Promise<string> {
  const folders = await foldersMap();
  const folder = folderId() ? folders.get(folderId()!) ?? null : null;
  const pace = currentPace();
  const parts = [describeTarget(writingTarget(folder, pace))];
  const drafts = draftStates(items());
  if (drafts.length) {
    parts.push(`Drafts in this session: ${drafts.map(({ draft, latest, state: s }) =>
      `"${latest.title || draft.slug}" (id ${draft.slug}, version ${draft.versions.length}, runtime ${formatClock(draftRuntime(latest.blocks, pace.wpm))}${s === "finished" ? ", already turned into a script" : s === "discarded" ? ", discarded" : ""})`).join("; ")}.`);
  }
  const saved: string[] = [];
  for (const item of items()) {
    if (item.kind !== "ideas-saved" || item.undone) continue;
    for (const ref of item.saved) saved.push(`"${ref.title}" (idea id ${ref.ideaId})`);
  }
  if (saved.length) parts.push(`Ideas saved in this session: ${saved.slice(-12).join("; ")}.`);
  return `[Session: ${parts.join(" ")}]`;
}
