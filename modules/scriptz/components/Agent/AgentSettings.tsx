import { For, Show, createEffect, createMemo } from "solid-js";
import { Row, SectionHead, Switch, confirmDialog } from "@agentz/kit/ui";
import { pushToast } from "@agentz/kit/stores";
import { ModelSelect } from "./ModelSelect";
import { ProviderPicker, ProviderSetup } from "./ProviderSetup";
import { t } from "../../i18n";
import { resolveLearnStage } from "../../lib/agent/learnStage";
import { finalStageId, scriptStages, stageLabel } from "../../lib/stages";
import { EFFORT_ORDER, type AgentEffort, type AgentModel } from "../../lib/agent/types";
import { agentStore } from "../../stores/agent";
import { agentSettings } from "../../stores/agentSettings";
import { agentUi } from "../../stores/agentUi";
import "./Agent.css";

const EFFORT_KEY: Record<AgentEffort, `agent.effort.${AgentEffort}`> = {
  none: "agent.effort.none",
  minimal: "agent.effort.minimal",
  low: "agent.effort.low",
  medium: "agent.effort.medium",
  high: "agent.effort.high",
  xhigh: "agent.effort.xhigh",
};

/** Efforts shown in the segmented control: those the model supports,
 *  capped at the four common levels to keep the control compact. */
function effortsFor(model: AgentModel | undefined): AgentEffort[] {
  const common: AgentEffort[] = ["low", "medium", "high", "xhigh"];
  const supported = model?.efforts.length ? model.efforts : common;
  const list = EFFORT_ORDER.filter((e) => supported.includes(e) && (common.includes(e) || supported.length <= 4));
  return list.length ? list : common;
}

export function EffortControl(props: { model: AgentModel | undefined; value: AgentEffort; onChange(v: AgentEffort): void; label: string }) {
  return (
    <div class="seg" role="radiogroup" aria-label={props.label}>
      <For each={effortsFor(props.model)}>
        {(effort) => (
          <button type="button" role="radio" aria-checked={props.value === effort} onClick={() => props.onChange(effort)}>
            {t(EFFORT_KEY[effort])}
          </button>
        )}
      </For>
    </div>
  );
}

/** Stage from which finished scripts are learned. The first option is the
 *  default ("the last stage", stored empty) and follows the pipeline; the
 *  first stage is not offered because every draft starts there. */
function LearnStageSelect(props: { label: string; disabled: boolean }) {
  const value = () => {
    const id = resolveLearnStage(agentSettings.learnStage(), scriptStages());
    return id === finalStageId() ? "" : id;
  };
  const options = () => scriptStages().slice(1, -1);
  return (
    <select
      class="field ag-select"
      aria-label={props.label}
      value={value()}
      disabled={props.disabled}
      onChange={(e) => void agentSettings.setLearnStage(e.currentTarget.value)}
    >
      <option value="">{t("agent.prefs.learnStage.last", { stage: stageLabel(finalStageId()) })}</option>
      <For each={options()}>{(stage) => <option value={stage.id}>{stageLabel(stage.id)}</option>}</For>
    </select>
  );
}

/** Settings > Agent. */
export function AgentSettings(props: { onClose(): void }) {
  const name = () => agentSettings.displayName();
  const ready = () => agentStore.status().state === "ready";

  createEffect(() => {
    if (!agentSettings.enabled()) return;
    if (agentStore.status().state === "checking") void agentStore.refreshStatus();
    if (ready() && agentStore.models().length === 0 && !agentStore.modelsLoading()) void agentStore.refreshModels().catch(() => {});
  });

  const chatModel = createMemo(() => agentStore.resolveModel());
  const learnModel = createMemo(() => {
    const list = agentStore.models();
    const id = agentSettings.learnModel();
    return list.find((m) => m.id === id) ?? chatModel();
  });

  const toggle = async (on: boolean) => {
    await agentSettings.setEnabled(on);
    if (on && !agentSettings.onboarded() && !agentSettings.hidden()) {
      props.onClose();
      agentUi.openOnboarding();
    }
  };

  const reset = async () => {
    const ok = await confirmDialog({
      title: t("agent.prefs.memory.resetTitle"),
      body: t("agent.prefs.memory.resetBody", { name: name() }),
      confirmLabel: t("agent.prefs.memory.reset"),
      danger: true,
    });
    if (!ok) return;
    await agentStore.clearMemory();
    pushToast(t("agent.prefs.memory.resetDone"), "ok");
  };

  return (
    <>
      <SectionHead
        title={t("agent.prefs.title")}
        sub={agentSettings.hidden() ? t("agent.prefs.subHidden") : t("agent.prefs.sub", { name: name() })}
        onClose={props.onClose}
      />
      <Row
        label={t("agent.prefs.visible")}
        help={agentSettings.onboarded() ? t("agent.prefs.visible.helpReady", { name: name() }) : t("agent.prefs.visible.help", { name: name() })}
      >
        <Switch checked={!agentSettings.hidden()} onChange={(v) => void agentSettings.setHidden(!v)} label={t("agent.prefs.visible")} />
      </Row>
      <Show when={!agentSettings.hidden()}>
        <Row label={t("agent.prefs.enabled")} help={t("agent.prefs.enabled.help")}>
          <Switch checked={agentSettings.enabled()} onChange={(v) => void toggle(v)} label={t("agent.prefs.enabled")} />
        </Row>
        <div class="srow ag-prov-row">
          <div><b>{t("agent.prefs.connection")}</b></div>
          <ProviderPicker showStatus check={agentSettings.enabled()} />
          <Show when={agentSettings.enabled()}>
            <ProviderSetup />
          </Show>
          <Show when={agentSettings.enabled() && !ready() && agentStore.status().state !== "checking"}>
            <div class="ag-prov-retry">
              <button type="button" class="btn" onClick={() => void agentStore.refreshStatus()}>{t("agent.state.retry")}</button>
            </div>
          </Show>
        </div>
        <Show when={agentStore.showsModel()}>
          <Row label={t("agent.prefs.model")} help={t("agent.prefs.model.help")}>
            <ModelSelect value={agentSettings.model()} onChange={(v) => void agentSettings.setModel(v)} label={t("agent.prefs.model")} />
          </Row>
        </Show>
        <Row label={t("agent.prefs.effort")} help={t("agent.prefs.effort.help")}>
          <EffortControl model={chatModel()} value={agentSettings.effort()} onChange={(v) => void agentSettings.setEffort(v)} label={t("agent.prefs.effort")} />
        </Row>
        <Row label={t("agent.prefs.learnScripts")} help={t("agent.prefs.learnScripts.help", { name: name() })}>
          <Switch checked={agentSettings.learnFromScripts()} onChange={(v) => void agentSettings.setLearnFromScripts(v)} label={t("agent.prefs.learnScripts")} />
        </Row>
        <Row label={t("agent.prefs.learnStage")} help={t("agent.prefs.learnStage.help", { name: name() })}>
          <LearnStageSelect label={t("agent.prefs.learnStage")} disabled={!agentSettings.learnFromScripts()} />
        </Row>
        <Row label={t("agent.prefs.learnChat")} help={t("agent.prefs.learnChat.help")}>
          <Switch checked={agentSettings.learnFromChat()} onChange={(v) => void agentSettings.setLearnFromChat(v)} label={t("agent.prefs.learnChat")} />
        </Row>
        <Show when={agentStore.showsModel()}>
          <Row label={t("agent.prefs.learnModel")} help={t("agent.prefs.learnModel.help")}>
            <ModelSelect
              value={agentSettings.learnModel()}
              onChange={(v) => void agentSettings.setLearnModel(v)}
              label={t("agent.prefs.learnModel")}
              sameLabel={t("agent.prefs.learnModel.same")}
            />
          </Row>
        </Show>
        <Row label={t("agent.prefs.learnEffort")}>
          <EffortControl model={learnModel()} value={agentSettings.learnEffort()} onChange={(v) => void agentSettings.setLearnEffort(v)} label={t("agent.prefs.learnEffort")} />
        </Row>
        <Row label={t("agent.prefs.relearn")} help={t("agent.prefs.relearn.help", { name: name() })}>
          <Show
            when={agentStore.bootstrap().running}
            fallback={
              <button type="button" class="btn" disabled={!agentSettings.enabled() || !ready()} onClick={() => void agentStore.startBootstrap()}>
                {t("agent.prefs.relearn.start")}
              </button>
            }
          >
            <span class="ag-row-btns">
              <span class="ag-relearn-n">{t("agent.prefs.relearn.running", { done: agentStore.bootstrap().done, total: agentStore.bootstrap().total })}</span>
              <button type="button" class="btn ghost" onClick={() => agentStore.cancelBootstrap()}>{t("agent.onb.learn.cancel")}</button>
            </span>
          </Show>
        </Row>
        <Row label={t("agent.prefs.persona")} help={t("agent.prefs.persona.help")}>
          <button type="button" class="btn" onClick={() => { props.onClose(); agentUi.openOnboarding(agentSettings.onboarded() ? 2 : 0); }}>{t("agent.prefs.persona.edit")}</button>
        </Row>
        <Row label={t("agent.prefs.memory")} help={t("agent.prefs.memory.help", { name: name() })}>
          <span class="ag-row-btns">
            <button type="button" class="btn" onClick={() => { props.onClose(); agentUi.openMemory(); }}>{t("agent.prefs.memory.open")}</button>
            <button type="button" class="btn ghost" onClick={() => void reset()}>{t("agent.prefs.memory.reset")}</button>
          </span>
        </Row>
      </Show>
    </>
  );
}
