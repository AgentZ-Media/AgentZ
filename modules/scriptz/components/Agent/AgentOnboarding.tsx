import { For, Match, Show, Switch, createEffect, createMemo, createSignal, onCleanup, type JSX } from "solid-js";
import { AppMark, DialogFrame, Icon } from "@agentz/kit/ui";
import { t, tPlural, type TranslationKey } from "../../i18n";
import type { AgentEffort } from "../../lib/agent/types";
import { agentStore } from "../../stores/agent";
import {
  AGENT_LOOKS,
  AGENT_NAME_MAX,
  AGENT_TRAITS,
  agentSettings,
  cleanAgentName,
  type AgentLook,
  type AgentTrait,
} from "../../stores/agentSettings";
import { agentUi } from "../../stores/agentUi";
import { AgentAvatar, type AvatarState } from "./AgentAvatar";
import { EffortControl } from "./AgentSettings";
import { scopeLabel, folderLookup } from "./labels";
import { library } from "../Shell/libraryData";
import "./Agent.css";

const CYCLE: AvatarState[] = ["idle", "think", "talk", "learn"];
const CYCLE_KEYS: Record<string, TranslationKey> = {
  idle: "agent.onb.state.idle",
  think: "agent.onb.state.think",
  talk: "agent.onb.state.talk",
  learn: "agent.onb.state.learn",
};

/** First-time setup of the agent (and "edit personality" from Settings):
 *  welcome, Codex check with model choice, name + look + personality. */
export function AgentOnboarding() {
  const [step, setStep] = createSignal(0);
  const [name, setName] = createSignal("");
  const [look, setLook] = createSignal<AgentLook>("eyes");
  const [traits, setTraits] = createSignal<AgentTrait[]>([]);
  const [userName, setUserName] = createSignal("");
  const [instructions, setInstructions] = createSignal("");
  const [model, setModel] = createSignal("");
  const [effort, setEffort] = createSignal<AgentEffort>("medium");
  const [saving, setSaving] = createSignal(false);
  /** Existing scripts found when the onboarding opened (adds the learn step). */
  const [existing, setExisting] = createSignal(0);
  const steps = () => (existing() > 0 ? 4 : 3);

  let wasOpen = false;
  createEffect(() => {
    const open = agentUi.onboardingOpen();
    if (open && !wasOpen) {
      setStep(agentUi.onboardingStep());
      setName(agentSettings.name());
      setLook(agentSettings.look());
      setTraits(agentSettings.traits());
      setUserName(agentSettings.userName());
      setInstructions(agentSettings.instructions());
      setModel(agentSettings.model());
      setEffort(agentSettings.effort());
      setSaving(false);
      setExisting(0);
      if (agentUi.onboardingStep() !== 2 || !agentSettings.onboarded()) {
        void agentStore.existingScriptCount().then((n) => { if (agentUi.onboardingOpen()) setExisting(n); });
      }
    }
    wasOpen = open;
  });

  // Step 2 checks Codex and loads the live model list.
  createEffect(() => {
    if (!agentUi.onboardingOpen() || step() !== 1) return;
    void (async () => {
      const status = await agentStore.refreshStatus();
      if (status.state === "ready" && agentStore.models().length === 0) await agentStore.refreshModels().catch(() => []);
      if (!model()) setModel(agentStore.models().find((m) => m.isDefault)?.id ?? "");
    })();
  });

  const displayName = () => cleanAgentName(name()) || "Ida";
  const editOnly = () => agentSettings.onboarded() && agentUi.onboardingStep() === 2;
  const lastStep = () => (editOnly() ? 2 : steps() - 1);

  const finish = async () => {
    if (saving()) return;
    setSaving(true);
    try {
      await Promise.all([
        agentSettings.setName(name()),
        agentSettings.setLook(look()),
        agentSettings.setTraits(traits()),
        agentSettings.setUserName(userName()),
        agentSettings.setInstructions(instructions()),
        agentSettings.setModel(model()),
        agentSettings.setEffort(effort()),
      ]);
      const first = !agentSettings.onboarded();
      // Editing the persona later keeps the on/off choice as it is.
      const setup = !editOnly();
      await agentSettings.markLearnSince();
      await agentSettings.setOnboarded(true);
      if (setup) await agentSettings.setEnabled(true);
      agentUi.closeOnboarding();
      if (first) {
        agentUi.setChatOpen(true);
        agentStore.scheduleLearning(4000);
      }
    } finally {
      setSaving(false);
    }
  };

  const close = () => agentUi.closeOnboarding();
  const next = () => (step() >= lastStep() ? void finish() : setStep(step() + 1));
  const back = () => step() > (editOnly() ? 2 : 0) && setStep(step() - 1);

  const onKey = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement | null;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return;
    if (target instanceof HTMLButtonElement && e.key === "Enter") return;
    if (e.key === "Enter") { e.preventDefault(); next(); }
  };

  return (
    <DialogFrame
      open={agentUi.onboardingOpen()}
      onClose={close}
      label={t("agent.onb.welcome.title")}
      surfaceClass="onb-card ag-onb"
      closeOnBackdrop={false}
    >
      <div class="onb-l" onKeyDown={onKey}>
        <div class="onb-brand">
          <AppMark logo="scriptz" appName="ScriptZ" size={34} />
          ScriptZ
        </div>
        <Show when={!editOnly()}>
          <div class="onb-steps ag-onb-steps" aria-hidden="true" style={{ "--steps": String(steps()) }}>
            <For each={Array.from({ length: steps() }, (_, i) => i)}>
              {(i) => <span classList={{ done: i < step(), on: i === step() }} />}
            </For>
          </div>
        </Show>
        <Switch>
          <Match when={step() === 0}>
            <div class="onb-eyebrow">{t("agent.onb.step", { n: 1, total: steps() })} · {t("agent.onb.brand")}</div>
            <h2 class="onb-h">{t("agent.onb.welcome.title")}</h2>
            <p class="onb-p">{t("agent.onb.welcome.body")}</p>
            <div class="ag-onb-list">
              <Point icon="users" title="agent.onb.welcome.p1.title" body="agent.onb.welcome.p1.body" />
              <Point icon="pen" title="agent.onb.welcome.p2.title" body="agent.onb.welcome.p2.body" />
              <Point icon="bulb" title="agent.onb.welcome.p3.title" body="agent.onb.welcome.p3.body" />
            </div>
          </Match>
          <Match when={step() === 1}>
            <div class="onb-eyebrow">{t("agent.onb.step", { n: 2, total: steps() })} · {t("agent.onb.codex.eyebrow")}</div>
            <h2 class="onb-h ag-onb-h2">{t("agent.onb.codex.title")}</h2>
            <p class="onb-p">{t("agent.onb.codex.body")}</p>
            <Show when={agentStore.status().state === "ready" && agentStore.models().length > 0}>
              <div class="ag-onb-models">
                <div class="ag-f-lbl">{t("agent.onb.codex.model")}</div>
                <div class="ag-onb-model-list" role="radiogroup" aria-label={t("agent.onb.codex.model")}>
                  <For each={agentStore.models()}>
                    {(m) => (
                      <button type="button" role="radio" class="ag-onb-model" aria-checked={model() === m.id || (!model() && m.isDefault)} onClick={() => setModel(m.id)}>
                        <span class="ag-prov-rd" />
                        <b>{m.label}</b>
                        <Show when={m.isDefault}><small>{t("agent.onb.codex.recommended")}</small></Show>
                      </button>
                    )}
                  </For>
                </div>
                <div class="ag-onb-effort">
                  <div class="ag-f-lbl">{t("agent.prefs.effort")}</div>
                  <EffortControl
                    model={agentStore.models().find((m) => m.id === model()) ?? agentStore.models().find((m) => m.isDefault)}
                    value={effort()}
                    onChange={setEffort}
                    label={t("agent.prefs.effort")}
                  />
                </div>
                <div class="ag-onb-hint">{t("agent.onb.codex.modelHint", { count: agentStore.models().length })}</div>
              </div>
            </Show>
          </Match>
          <Match when={step() === 2}>
            <Show when={!editOnly()}>
              <div class="onb-eyebrow">{t("agent.onb.step", { n: 3, total: steps() })} · {t("agent.prefs.persona")}</div>
            </Show>
            <label class="ag-f-lbl" for="ag-onb-name">{t("agent.onb.persona.name")}</label>
            <input
              id="ag-onb-name"
              class="field ag-onb-name"
              maxLength={AGENT_NAME_MAX}
              placeholder={t("agent.onb.persona.namePlaceholder")}
              value={name()}
              onInput={(e) => setName(e.currentTarget.value)}
              data-autofocus
            />
            <div class="ag-f-lbl">{t("agent.onb.persona.look")}</div>
            <div class="ag-looks" role="radiogroup" aria-label={t("agent.onb.persona.look")}>
              <For each={AGENT_LOOKS}>
                {(l) => (
                  <button type="button" role="radio" class="ag-look" aria-checked={look() === l} onClick={() => setLook(l)}>
                    <AgentAvatar look={l} size={44} state={look() === l ? "idle" : "still"} />
                    <span>{t(`agent.look.${l}`)}</span>
                  </button>
                )}
              </For>
            </div>
            <div class="ag-f-lbl">{t("agent.onb.persona.traits")}</div>
            <div class="ag-traits">
              <For each={AGENT_TRAITS}>
                {(trait) => (
                  <button
                    type="button"
                    class="ag-trait"
                    aria-pressed={traits().includes(trait)}
                    onClick={() => setTraits(traits().includes(trait) ? traits().filter((x) => x !== trait) : [...traits(), trait])}
                  >
                    {t(`agent.trait.${trait}`)}
                  </button>
                )}
              </For>
            </div>
            <div class="ag-onb-pair">
              <div>
                <label class="ag-f-lbl" for="ag-onb-user">{t("agent.onb.persona.userName", { name: displayName() })}</label>
                <input id="ag-onb-user" class="field" maxLength={AGENT_NAME_MAX} value={userName()} onInput={(e) => setUserName(e.currentTarget.value)} />
              </div>
            </div>
            <label class="ag-f-lbl" for="ag-onb-instr">{t("agent.onb.persona.instructions")}</label>
            <textarea
              id="ag-onb-instr"
              class="field ag-onb-instr"
              rows={2}
              placeholder={t("agent.onb.persona.instructionsPlaceholder")}
              value={instructions()}
              onInput={(e) => setInstructions(e.currentTarget.value)}
            />
          </Match>
          <Match when={step() === 3}>
            <div class="onb-eyebrow">{t("agent.onb.step", { n: 4, total: steps() })} · {t("agent.onb.learn.eyebrow")}</div>
            <h2 class="onb-h ag-onb-h2">{tPlural("agent.onb.learn.title", existing())}</h2>
            <p class="onb-p">{t("agent.onb.learn.body", { name: displayName() })}</p>
            <LearnControls />
          </Match>
        </Switch>
        <div class="onb-foot">
          <Show when={step() > (editOnly() ? 2 : 0)}>
            <button type="button" class="btn ghost" onClick={back}>{t("agent.onb.back")}</button>
          </Show>
          <span class="sp" />
          <button type="button" class="onb-skip" onClick={close}>{editOnly() ? t("agent.mem.cancel") : t("agent.onb.later")}</button>
          <button
            type="button"
            class="btn primary"
            data-autofocus={step() !== 2 ? true : undefined}
            disabled={saving() || (step() === 1 && agentStore.status().state !== "ready")}
            onClick={next}
          >
            {step() < lastStep() ? t("agent.onb.next") : editOnly() ? t("agent.mem.save") : t("agent.onb.finish")}
            <kbd>⏎</kbd>
          </button>
        </div>
      </div>
      <div class="onb-r ag-onb-stage">
        <Switch>
          <Match when={step() === 0}><StageWelcome look={look()} /></Match>
          <Match when={step() === 1}><StageCodex /></Match>
          <Match when={step() === 2}>
            <StagePersona look={look()} name={displayName()} userName={cleanAgentName(userName())} traits={traits()} />
          </Match>
          <Match when={step() === 3}>
            <StageLearn look={look()} name={displayName()} />
          </Match>
        </Switch>
      </div>
    </DialogFrame>
  );
}

function Point(props: { icon: "users" | "pen" | "bulb"; title: TranslationKey; body: TranslationKey }) {
  return (
    <div class="ag-onb-point">
      <span class="ag-onb-ico"><Icon name={props.icon} size={14} /></span>
      <div><b>{t(props.title)}</b><small>{t(props.body)}</small></div>
    </div>
  );
}

function StageWelcome(props: { look: AgentLook }) {
  const [index, setIndex] = createSignal(0);
  const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  if (!reduce) {
    const timer = setInterval(() => setIndex((i) => (i + 1) % CYCLE.length), 2600);
    onCleanup(() => clearInterval(timer));
  }
  return (
    <div class="ag-stage-col">
      <AgentAvatar look={props.look} size={132} state={CYCLE[index()]} onDark lifted />
      <div class="ag-states" aria-hidden="true">
        <For each={CYCLE}>{(state, i) => <span classList={{ on: i() === index() }}>{t(CYCLE_KEYS[state])}</span>}</For>
      </div>
    </div>
  );
}

function StageCodex() {
  const status = () => agentStore.status();
  const ready = () => status().state === "ready";
  const command = () => <code>codex login</code>;
  const split = (text: string) => {
    const [a, b] = text.split("{command}");
    return <>{a}{command()}{b ?? ""}</>;
  };
  return (
    <div class="ag-stage-col">
      <div class="ag-chk">
        <div class="ag-chk-h"><i classList={{ "is-ready": ready() }} />codex app-server</div>
        <Switch>
          <Match when={status().state === "checking"}>
            <div class="ag-chk-it"><span class="ag-spin" /><div><b>{t("agent.onb.codex.checking")}</b></div></div>
          </Match>
          <Match when={ready()}>
            <ChkRow icon="check" title={t("agent.onb.codex.found")} />
            <ChkRow icon="check" title={t("agent.onb.codex.login")} body={(status() as { account: string | null }).account ?? undefined} />
            <ChkRow icon="check" title={t("agent.onb.codex.tools")} body={t("agent.onb.codex.toolsBody")} />
            <ChkRow icon="check" title={t("agent.onb.codex.locked")} body={t("agent.onb.codex.lockedBody")} />
          </Match>
          <Match when={status().state === "missing"}>
            <ChkRow icon="x" bad title={t("agent.state.missing.title")} bodyEl={split(t("agent.state.missing.body", { name: agentSettings.displayName() }))} />
          </Match>
          <Match when={status().state === "logged-out"}>
            <ChkRow icon="check" title={t("agent.onb.codex.found")} />
            <ChkRow icon="x" bad title={t("agent.state.loggedOut.title")} bodyEl={split(t("agent.state.loggedOut.body"))} />
          </Match>
          <Match when={status().state === "error" || status().state === "unavailable"}>
            <ChkRow icon="x" bad title={t("agent.state.error.title")} body={(status() as { message?: string }).message} />
          </Match>
        </Switch>
      </div>
      <Show when={!ready() && status().state !== "checking"}>
        <button type="button" class="btn ag-stage-btn" onClick={() => void agentStore.refreshStatus()}>{t("agent.state.retry")}</button>
      </Show>
    </div>
  );
}

function ChkRow(props: { icon: "check" | "x"; title: string; body?: string; bodyEl?: JSX.Element; bad?: boolean }) {
  return (
    <div class="ag-chk-it">
      <span class="ag-chk-ok" classList={{ "is-bad": !!props.bad }}><Icon name={props.icon} size={11} /></span>
      <div>
        <b>{props.title}</b>
        <Show when={props.body || props.bodyEl}><small>{props.bodyEl ?? props.body}</small></Show>
      </div>
    </div>
  );
}

function StagePersona(props: { look: AgentLook; name: string; userName: string; traits: AgentTrait[] }) {
  const greeting = createMemo(() => {
    const parts = [props.userName ? t("agent.onb.greeting", { user: props.userName, name: props.name }) : t("agent.onb.greetingNoUser", { name: props.name })];
    for (const trait of props.traits.slice(0, 3)) parts.push(t(`agent.onb.greeting.${trait}`));
    parts.push(t("agent.onb.greeting.end"));
    return parts.join(" ");
  });
  return (
    <div class="ag-say">
      <AgentAvatar look={props.look} size={54} state="talk" onDark />
      <div class="ag-say-b">
        {greeting()}
        <small>{t("agent.onb.persona.preview")}</small>
      </div>
    </div>
  );
}

/** Start / cancel the one-off retroactive learning (onboarding + settings). */
export function LearnControls() {
  const state = () => agentStore.bootstrap();
  const pct = () => (state().total ? Math.round((state().done / state().total) * 100) : 0);
  return (
    <div class="ag-learn">
      <Show
        when={state().running || state().finished}
        fallback={
          <div class="ag-learn-start">
            <button type="button" class="btn primary" onClick={() => void agentStore.startBootstrap()}>
              <Icon name="spark" size={14} />
              {t("agent.onb.learn.start")}
            </button>
            <span class="ag-onb-hint">{t("agent.onb.learn.background")}</span>
          </div>
        }
      >
        <div class="ag-learn-prog">
          <div class="ag-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct()}>
            <i style={{ width: `${state().finished ? 100 : Math.max(4, pct())}%` }} />
          </div>
          <div class="ag-learn-t">
            <span>
              {state().finished
                ? t("agent.onb.learn.done")
                : state().total === 0
                  ? t("agent.onb.learn.preparing")
                  : t("agent.onb.learn.reading", { title: state().current[0] ?? "" })}
            </span>
            <b>{t("agent.onb.learn.progress", { done: state().done, total: state().total })}</b>
          </div>
          <Show when={state().running}>
            <button type="button" class="btn ghost ag-learn-cancel" onClick={() => agentStore.cancelBootstrap()}>{t("agent.onb.learn.cancel")}</button>
          </Show>
        </div>
      </Show>
    </div>
  );
}

function StageLearn(props: { look: AgentLook; name: string }) {
  const state = () => agentStore.bootstrap();
  const lookup = () => folderLookup(library.folderList(), (id) => library.script(id)?.title ?? null);
  return (
    <div class="ag-stage-col">
      <AgentAvatar look={props.look} size={84} state={state().running ? "learn" : "idle"} onDark lifted />
      <div class="ag-feed">
        <Show
          when={state().recent.length > 0}
          fallback={
            <div class="ag-feed-empty">
              {state().finished ? t("agent.onb.learn.nothing") : t("agent.onb.learn.idle", { name: props.name })}
            </div>
          }
        >
          <For each={state().recent}>
            {(change) => (
              <div class="ag-feed-it">
                <Icon name="spark" size={12} />
                <div>
                  <b>{scopeLabel(change.entry, lookup())}</b>
                  <span>{change.entry.content}</span>
                </div>
              </div>
            )}
          </For>
        </Show>
      </div>
    </div>
  );
}
