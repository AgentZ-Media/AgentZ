import { For, Show, createEffect, createMemo } from "solid-js";
import { Icon, Row, SectionHead, Switch, confirmDialog } from "@agentz/kit/ui";
import { pushToast } from "@agentz/kit/stores";
import { t } from "../../i18n";
import { resolveLearnStage } from "../../lib/agent/learnStage";
import { clearMemory } from "../../lib/agent/memory";
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

export function ModelSelect(props: { value: string; onChange(v: string): void; label: string; sameLabel?: string }) {
  const models = () => agentStore.models();
  const fallback = () => models().find((m) => m.isDefault) ?? models()[0];
  return (
    <span class="ag-model-ctl">
      <select
        class="field ag-select"
        aria-label={props.label}
        value={props.value}
        disabled={models().length === 0}
        onChange={(e) => props.onChange(e.currentTarget.value)}
      >
        <option value="">
          {props.sameLabel ?? (fallback()
            ? t("agent.prefs.model.default", { label: fallback()!.label })
            : t(agentStore.modelsLoading() ? "agent.prefs.model.loading" : "agent.prefs.model.auto"))}
        </option>
        <For each={models()}>{(model) => <option value={model.id}>{model.label}</option>}</For>
      </select>
      <button
        type="button"
        class="btn icon"
        title={t("agent.prefs.model.refresh")}
        aria-label={t("agent.prefs.model.refresh")}
        // Off means off: reloading would start Codex.
        disabled={agentStore.modelsLoading() || !agentSettings.enabled()}
        onClick={() => void agentStore.refreshModels().catch(() => {})}
      >
        <Icon name="refresh" size={14} />
      </button>
    </span>
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

  const codexLine = () => {
    const status = agentStore.status();
    if (!agentSettings.enabled()) return t("agent.status.off");
    if (status.state === "ready") return status.account ? t("agent.prefs.codex.readyAs", { account: status.account }) : t("agent.prefs.codex.ready");
    if (status.state === "checking") return t("agent.status.checking");
    if (status.state === "missing") return t("agent.state.missing.title");
    if (status.state === "logged-out") return t("agent.state.loggedOut.title");
    if (status.state === "error") return t("agent.state.error.title");
    return t("agent.state.unavailable");
  };

  const toggle = async (on: boolean) => {
    await agentSettings.setEnabled(on);
    if (on && !agentSettings.onboarded()) {
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
    await clearMemory();
    pushToast(t("agent.prefs.memory.resetDone"), "ok");
  };

  return (
    <>
      <SectionHead title={t("agent.prefs.title")} sub={t("agent.prefs.sub", { name: name() })} onClose={props.onClose} />
      <Row label={t("agent.prefs.enabled")} help={t("agent.prefs.enabled.help")}>
        <Switch checked={agentSettings.enabled()} onChange={(v) => void toggle(v)} label={t("agent.prefs.enabled")} />
      </Row>
      <div class="srow ag-prov-row">
        <div><b>{t("agent.prefs.connection")}</b></div>
        <div class="ag-prov">
          <div class="ag-prov-it is-on" aria-current="true">
            <span class="ag-prov-rd" />
            <div>
              <b>{t("agent.prefs.codex")}</b>
              <small classList={{ "is-ready": agentSettings.enabled() && ready() }}><i />{codexLine()}</small>
            </div>
          </div>
          <div class="ag-prov-it is-off" aria-disabled="true">
            <span class="ag-prov-rd" />
            <div><b>{t("agent.prefs.openrouter")}</b><small>{t("agent.prefs.later")}</small></div>
          </div>
          <div class="ag-prov-it is-off" aria-disabled="true">
            <span class="ag-prov-rd" />
            <div><b>{t("agent.prefs.local")}</b><small>{t("agent.prefs.later")}</small></div>
          </div>
        </div>
        <Show when={agentSettings.enabled() && !ready() && agentStore.status().state !== "checking"}>
          <div class="ag-prov-retry">
            <button type="button" class="btn" onClick={() => void agentStore.refreshStatus()}>{t("agent.state.retry")}</button>
          </div>
        </Show>
      </div>
      <Row label={t("agent.prefs.model")} help={t("agent.prefs.model.help")}>
        <ModelSelect value={agentSettings.model()} onChange={(v) => void agentSettings.setModel(v)} label={t("agent.prefs.model")} />
      </Row>
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
      <Row label={t("agent.prefs.learnModel")} help={t("agent.prefs.learnModel.help")}>
        <ModelSelect
          value={agentSettings.learnModel()}
          onChange={(v) => void agentSettings.setLearnModel(v)}
          label={t("agent.prefs.learnModel")}
          sameLabel={t("agent.prefs.learnModel.same")}
        />
      </Row>
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
    </>
  );
}
