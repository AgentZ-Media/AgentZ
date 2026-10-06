import { Show, createEffect, on, onMount } from "solid-js";
import { Icon } from "@agentz/kit/ui";
import { t } from "../../i18n";
import { formatRange, resolveLengthRange } from "../../lib/lengthGoal";
import type { ChatQuote, ChatSession } from "../../stores/agent";
import { agentStore } from "../../stores/agent";
import { settingsStore } from "../../stores/settings";
import { uiStore } from "../../stores/ui";
import { FolderMenu } from "../Ideas/parts/FolderMenu";
import { defaultLengthRange, library } from "../Shell/libraryData";

export interface AgentComposerProps {
  session: ChatSession;
  value: string;
  onInput(value: string): void;
  onSend(): void;
  quote: ChatQuote | null;
  onClearQuote(): void;
  /** "big": centered start field; "dock": below the conversation. */
  variant: "big" | "dock";
  /** Narrow column (split view): fewer details in the footer. */
  compact?: boolean;
  placeholder: string;
  /** Bumped from outside to focus the field (Mod+L in the agent mode). */
  focusTick?: number;
}

/** Input of the agent mode. The footer shows what the agent writes
 *  against: folder, length target and speaking pace. */
export function AgentComposer(props: AgentComposerProps) {
  let input: HTMLTextAreaElement | undefined;
  const running = () => props.session.running();
  const attached = () => props.session.scriptId() !== null;
  const folder = () => library.folder(props.session.folderId()) ?? null;
  const range = () => resolveLengthRange(folder(), defaultLengthRange());
  const rangeText = () => formatRange(range());

  const resize = () => {
    if (!input) return;
    input.style.height = "auto";
    input.style.height = `${Math.min(props.variant === "big" ? 220 : 180, input.scrollHeight)}px`;
  };
  createEffect(on(() => props.value, () => queueMicrotask(resize)));
  createEffect(on(() => props.focusTick, (tick) => { if (tick) input?.focus(); }, { defer: true }));
  onMount(() => queueMicrotask(() => input?.focus({ preventScroll: true })));

  return (
    <div class="am-comp" classList={{ "is-big": props.variant === "big", "is-running": running() }}>
      <Show when={props.quote}>
        {(q) => (
          <div class="ag-quote">
            <span class="ag-quote-l">{q().draft !== undefined ? t("agentMode.composer.quoteDraft") : t("agent.composer.quote")}</span>
            <span class="ag-quote-t">{q().text}</span>
            <button type="button" class="ag-quote-x" aria-label={t("agent.composer.removeQuote")} title={t("agent.composer.removeQuote")} onClick={() => props.onClearQuote()}>
              <Icon name="x" size={11} />
            </button>
          </div>
        )}
      </Show>
      <textarea
        ref={input}
        class="am-comp-in"
        rows={props.variant === "big" ? 2 : 1}
        value={props.value}
        placeholder={props.placeholder}
        aria-label={props.placeholder}
        onInput={(e) => { props.onInput(e.currentTarget.value); resize(); }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
            e.preventDefault();
            props.onSend();
          } else if (e.key === "Escape" && running()) {
            e.preventDefault();
            void props.session.stop();
          }
        }}
      />
      <div class="am-comp-f">
        <Show
          when={!attached()}
          fallback={<span class="am-pick is-static"><Icon name="doc" size={12} />{t("agentMode.composer.inScript")}</span>}
        >
          <FolderMenu
            folders={library.folderList()}
            value={props.session.folderId()}
            onChange={(id) => props.session.setFolder(id)}
            ariaLabel={t("agentMode.composer.folderAria")}
            class="am-pick-folder"
          />
          <button
            type="button"
            class="am-pick"
            title={t("agentMode.composer.targetTitle")}
            onClick={() => uiStore.openSettings(folder() ? "folders" : "writing")}
          >
            <Icon name="history" size={12} />
            <span>{rangeText() || t("agentMode.composer.noTarget")}</span>
            <Show when={!props.compact}>
              <em>{t("agentMode.composer.wpm", { wpm: settingsStore.dialogWpm() })}</em>
            </Show>
          </button>
        </Show>
        <span class="am-sp" />
        <Show when={!props.compact && agentStore.resolveModel()}>
          {(model) => <span class="am-model" title={t("agentMode.composer.modelTitle")}>{model().label}</span>}
        </Show>
        <Show
          when={running()}
          fallback={
            <button
              type="button"
              class="ag-send"
              disabled={!props.value.trim()}
              title={t("agent.composer.send")}
              aria-label={t("agent.composer.send")}
              onClick={() => props.onSend()}
            >
              <Icon name="up" size={15} />
            </button>
          }
        >
          <button type="button" class="ag-send is-stop" title={t("agent.composer.stop")} aria-label={t("agent.composer.stop")} onClick={() => void props.session.stop()}>
            <span class="ag-stop-sq" />
          </button>
        </Show>
      </div>
    </div>
  );
}
