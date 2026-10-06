import { For, Show, createMemo, createSignal } from "solid-js";
import { DialogFrame, Icon } from "@agentz/kit/ui";
import { K, isModKey } from "@agentz/kit/platform";
import { pushToast } from "@agentz/kit/stores";
import { t, tPlural } from "../../i18n";
import { api } from "../../lib/api";
import { contentJsonFromBlocks, draftRuntime, draftWords, type DraftVersion } from "../../lib/agent/drafts";
import { foldersBus } from "../../lib/foldersBus";
import { ideasBus } from "../../lib/ideasBus";
import { formatClock, formatRange, resolveLengthRange } from "../../lib/lengthGoal";
import { scriptsBus } from "../../lib/scriptsBus";
import { firstStageId, scriptStages, stageLabel } from "../../lib/stages";
import type { ChatSession } from "../../stores/agent";
import { agentSettings } from "../../stores/agentSettings";
import { agentUi } from "../../stores/agentUi";
import { ideasStore } from "../../stores/ideas";
import { navStore } from "../../stores/nav";
import { settingsStore } from "../../stores/settings";
import { StageGlyph } from "../Common/StageGlyph";
import { FolderMenu } from "../Common/FolderMenu";
import { ContextMenu } from "../Common/ContextMenu";
import { defaultLengthRange, library } from "../Shell/libraryData";
import type { DraftState } from "./DraftPanel";

export interface FinishTarget {
  draft: DraftState;
  version: DraftVersion;
}

export interface FinishDialogProps {
  session: ChatSession;
  target: FinishTarget | null;
  onClose(): void;
  colorOf(name: string): string;
}

/** "Fertig": turns a draft version into a real script. Before this, the
 *  draft exists only in the agent mode. */
export function FinishDialog(props: FinishDialogProps) {
  return (
    <DialogFrame open={props.target !== null} onClose={() => props.onClose()} label={t("agentMode.finish.title")} class="am-fin">
      <Show when={props.target} keyed>
        {(target) => <FinishForm session={props.session} target={target} onClose={props.onClose} colorOf={props.colorOf} />}
      </Show>
    </DialogFrame>
  );
}

function FinishForm(props: { session: ChatSession; target: FinishTarget; onClose(): void; colorOf(name: string): string }) {
  const version = () => props.target.version;
  const [title, setTitle] = createSignal(version().title.trim() || t("agentMode.draft.untitled"));
  const [folderId, setFolderId] = createSignal<string | null>(library.folder(props.session.folderId()) ? props.session.folderId() : null);
  const [stage, setStage] = createSignal(firstStageId());
  const idea = createMemo(() => {
    const id = version().ideaId;
    return id ? ideasStore.ideas().find((i) => i.id === id) ?? null : null;
  });
  const [markIdea, setMarkIdea] = createSignal(true);
  const attachedElsewhere = () => props.session.scriptId() !== null;
  const [takeChat, setTakeChat] = createSignal(!attachedElsewhere());
  const [busy, setBusy] = createSignal(false);
  const [stageMenu, setStageMenu] = createSignal<{ x: number; y: number } | null>(null);

  const folder = () => library.folder(folderId()) ?? null;
  const range = () => resolveLengthRange(folder(), defaultLengthRange());
  const seconds = () => draftRuntime(version().blocks, settingsStore.dialogWpm());

  const create = async (open: boolean) => {
    const name = title().trim();
    if (!name || busy()) return;
    setBusy(true);
    try {
      const script = await api.createScript({
        title: name,
        initialContentJson: contentJsonFromBlocks(version().blocks),
        folderId: folderId(),
      });
      if (stage() !== firstStageId()) await api.setScriptStatus(script.id, stage());
      const ideaNow = idea();
      if (markIdea() && ideaNow && !ideaNow.used_at) {
        await api.markIdeaUsed(ideaNow.id, script.id).catch((error) => console.warn("[agent] marking idea failed", error));
      }
      scriptsBus.bump();
      foldersBus.bump();
      ideasBus.bump();
      props.session.recordHandoff({
        scriptId: script.id,
        title: name,
        slug: props.target.draft.draft.slug,
        versionId: version().id,
        // The folder the script really got (the menu stays usable meanwhile).
        folderId: script.folder_id,
      });
      const chatAlong = takeChat() && !attachedElsewhere();
      if (chatAlong) await props.session.attachToScript(script.id, script.folder_id);
      props.onClose();
      if (open) {
        await navStore.openScript(script.id, name);
        if (chatAlong) agentUi.setChatOpen(script.id, true);
      } else {
        pushToast(t("agentMode.finish.created", { title: name }), "ok");
      }
    } catch (error) {
      console.warn("[agent] creating script from draft failed", error);
      pushToast(t("agentMode.finish.failed"), "error");
    } finally {
      setBusy(false);
    }
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Enter" && isModKey(e)) {
      e.preventDefault();
      void create(true);
    }
  };

  return (
    <div class="am-fin-grid" onKeyDown={onKey}>
      <div class="am-fin-prev" aria-hidden="true">
        <div class="am-fin-page" data-paper>
          <div class="am-fin-ttl">{title()}</div>
          <For each={version().blocks.slice(0, 40)}>
            {(block) => <div class={`am-pb am-pb-${block.type}`}>{block.text}</div>}
          </For>
        </div>
        <div class="am-fin-meta">
          <b>{formatClock(seconds())}</b> · {tPlural("agentMode.draft.words", draftWords(version().blocks))}
          <Show when={range()}> · {t("agentMode.finish.target", { range: formatRange(range()) })}</Show>
        </div>
      </div>
      <div class="am-fin-body">
        <div class="dlg-h">
          <div>
            <b>{t("agentMode.finish.title")}</b>
            <small>{t("agentMode.finish.lede")}</small>
          </div>
          <button type="button" class="ag-ic" aria-label={t("common.close")} title={t("common.close")} onClick={() => props.onClose()}>
            <Icon name="x" size={15} />
          </button>
        </div>
        <label class="am-fin-lbl" for="am-fin-title">{t("agentMode.finish.name")}</label>
        <input
          id="am-fin-title"
          class="field am-fin-title"
          value={title()}
          maxLength={200}
          onInput={(e) => setTitle(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !isModKey(e)) {
              e.preventDefault();
              void create(true);
            }
          }}
          ref={(el) => queueMicrotask(() => { el.focus(); el.select(); })}
        />
        <div class="srow">
          <div>
            <b>{t("agentMode.finish.folder")}</b>
            <small>{range() ? t("agentMode.finish.target", { range: formatRange(range()) }) : t("agentMode.finish.noTarget")}</small>
          </div>
          <FolderMenu folders={library.folderList()} value={folderId()} onChange={setFolderId} ariaLabel={t("agentMode.finish.folder")} />
        </div>
        <div class="srow">
          <div>
            <b>{t("agentMode.finish.stage")}</b>
            <small>{t("agentMode.finish.stageSub")}</small>
          </div>
          <button
            type="button"
            class="chip"
            aria-haspopup="menu"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setStageMenu({ x: r.right, y: r.bottom + 4 });
            }}
          >
            <StageGlyph stage={stage()} />
            {stageLabel(stage())}
            <Icon name="down" size={12} />
          </button>
        </div>
        <Show when={idea() && !idea()!.used_at}>
          <div class="srow">
            <div>
              <b>{t("agentMode.finish.markIdea")}</b>
              <small>{t("agentMode.finish.markIdeaSub", { title: idea()!.title })}</small>
            </div>
            <button type="button" class="sw-t" role="switch" aria-checked={markIdea()} aria-label={t("agentMode.finish.markIdea")} onClick={() => setMarkIdea(!markIdea())} />
          </div>
        </Show>
        <div class="srow">
          <div>
            <b>{t("agentMode.finish.takeChat")}</b>
            <small>
              {attachedElsewhere()
                ? t("agentMode.finish.takeChatTaken")
                : t("agentMode.finish.takeChatSub", { name: agentSettings.displayName() })}
            </small>
          </div>
          <button
            type="button"
            class="sw-t"
            role="switch"
            disabled={attachedElsewhere()}
            aria-checked={takeChat() && !attachedElsewhere()}
            aria-label={t("agentMode.finish.takeChat")}
            onClick={() => setTakeChat(!takeChat())}
          />
        </div>
        <div class="am-fin-foot">
          <button type="button" class="btn ghost" onClick={() => props.onClose()}>{t("common.cancel")}</button>
          <span class="am-sp" />
          <button type="button" class="btn" disabled={busy() || !title().trim()} onClick={() => void create(false)}>
            {t("agentMode.finish.createOnly")}
          </button>
          <button type="button" class="btn primary" disabled={busy() || !title().trim()} onClick={() => void create(true)}>
            {t("agentMode.finish.createOpen")}
            <kbd>{K("Mod+Enter")}</kbd>
          </button>
        </div>
      </div>
      <Show when={stageMenu()}>
        {(pos) => (
          <ContextMenu
            x={pos().x}
            y={pos().y}
            align="end"
            onClose={() => setStageMenu(null)}
            items={scriptStages().map((s) => ({
              label: stageLabel(s.id),
              icon: <StageGlyph stage={s.id} />,
              checked: s.id === stage(),
              onClick: () => setStage(s.id),
            }))}
          />
        )}
      </Show>
    </div>
  );
}
