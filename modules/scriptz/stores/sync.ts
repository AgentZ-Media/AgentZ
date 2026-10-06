import type { SyncAdapter } from "@agentz/kit/account";
import { characterUsageBus } from "../lib/characterUsage";
import { dailyStatsBus } from "../lib/dailyStatsBus";
import { foldersBus } from "../lib/foldersBus";
import { ideasBus } from "../lib/ideasBus";
import { notifyMemoryChanged } from "../lib/agent/memory";
import { remoteScriptBus, scriptsBus } from "../lib/scriptsBus";
import { createScriptzSyncAdapter } from "../lib/sync/adapter";
import { t } from "../i18n";
import { agentStore } from "./agent";
import { notifyLearnedChanged } from "./agent/learning";
import { agentSettings } from "./agentSettings";
import { settingsStore } from "./settings";

/** The ScriptZ data the Kit account syncs, wired to the views that show it. */
export function createScriptzSync(): SyncAdapter {
  return createScriptzSyncAdapter({
    applied(summary) {
      const has = (entity: string) => summary.entities.has(entity);
      if (has("folders")) foldersBus.bump();
      if (has("scripts")) scriptsBus.bump();
      for (const id of summary.scripts) remoteScriptBus.emit(id);
      if (has("ideas")) ideasBus.bump();
      if (has("agent_memory")) notifyMemoryChanged();
      if (has("agent_learned")) notifyLearnedChanged();
      if (has("character_colors")) characterUsageBus.bumpRegistry();
      if (has("daily_words")) dailyStatsBus.bump();
      if (summary.chats.size > 0) agentStore.remoteChatsChanged(summary.chats);
    },
    async settingsChanged() {
      await Promise.all([settingsStore.load(), agentSettings.load()]);
    },
    copySuffix: () => t("sync.conflictCopy"),
  });
}
