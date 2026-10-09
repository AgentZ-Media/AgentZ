import { For, Match, Show, Switch, createEffect, createSignal, on } from "solid-js";
import { account } from "@agentz/kit/account";
import { getPlatformAdapter } from "@agentz/kit/platform";
import { t, type TranslationKey } from "../../i18n";
import {
  AGENT_KEY_INVALID,
  AGENT_NETWORK,
  AGENT_INCOMPLETE,
  AGENT_NO_CREDITS,
  AGENT_NOT_ENABLED,
  AGENT_PROCESS_EXITED,
  AGENT_RATE_LIMITED,
  AGENT_SIGNED_OUT,
} from "../../lib/agent/types";
import { agentStore } from "../../stores/agent";
import { AGENT_PROVIDERS, agentSettings, type AgentProviderId } from "../../stores/agentSettings";
import { CodexSetupInstructions } from "./CodexSetupInstructions";

// Choosing how the agent runs (Codex, AgentZ account, own OpenRouter key)
// and what each way needs to get ready. Shared by the settings, the agent
// onboarding and the chat gate, so all three look and behave the same.

const KEYS_URL = "https://openrouter.ai/settings/keys";

const ERROR_TEXT: Record<string, TranslationKey> = {
  [AGENT_PROCESS_EXITED]: "agent.error.exited",
  [AGENT_SIGNED_OUT]: "agent.error.signedOut",
  [AGENT_RATE_LIMITED]: "agent.error.rateLimited",
  [AGENT_NETWORK]: "agent.error.network",
  [AGENT_KEY_INVALID]: "agent.error.keyInvalid",
  [AGENT_NO_CREDITS]: "agent.error.noCredits",
  [AGENT_NOT_ENABLED]: "agent.error.notEnabled",
  [AGENT_INCOMPLETE]: "agent.error.incomplete",
};

/** Translated text for an `AGENT_*` error code, else null. */
export function agentErrorText(message: string | undefined): string | null {
  const key = message ? ERROR_TEXT[message] : undefined;
  return key ? t(key) : null;
}

const NAME: Record<AgentProviderId, TranslationKey> = {
  codex: "agent.provider.codex",
  agentz: "agent.provider.agentz",
  openrouter: "agent.provider.openrouter",
};

export function providerName(id: AgentProviderId = agentSettings.provider()): string {
  return t(NAME[id]);
}

/** The hosted agent is not open to this account (or nobody is signed in):
 *  the choice shows "coming soon" and cannot be picked. A choice made before
 *  stays selectable, its status explains the rest. */
function comingSoon(id: AgentProviderId): boolean {
  return id === "agentz" && !agentStore.hostedAccess() && agentSettings.provider() !== id;
}

const notEnabled = () => {
  const status = agentStore.status();
  return status.state === "error" && status.message === AGENT_NOT_ENABLED;
};

function providerSub(id: AgentProviderId): string {
  if (id === "codex") return t("agent.provider.codex.sub");
  return t(id === "agentz" ? "agent.provider.agentz.sub" : "agent.provider.openrouter.sub");
}

/** One line about the current provider's state. */
export function providerStatusLine(): string {
  const status = agentStore.status();
  const id = agentSettings.provider();
  if (!agentSettings.enabled()) return t("agent.status.off");
  if (status.state === "ready") return status.account ? t("agent.prefs.codex.readyAs", { account: status.account }) : t("agent.prefs.codex.ready");
  if (status.state === "checking") return t("agent.status.checking");
  if (status.state === "missing") return t("agent.state.missing.title");
  if (status.state === "logged-out") {
    if (id === "agentz") return t("agent.provider.agentz.signedOut");
    if (id === "openrouter") return t("agent.provider.openrouter.noKey");
    return t("agent.state.loggedOut.title");
  }
  if (status.state === "error") return providerErrorTitle();
  return t("agent.state.unavailable");
}

export function providerErrorTitle(): string {
  const id = agentSettings.provider();
  if (id === "agentz") return t(notEnabled() ? "agent.provider.soon" : "agent.provider.agentz.error");
  if (id === "openrouter") return t("agent.provider.openrouter.error");
  return t("agent.state.error.title");
}

/** Switches the provider. With `check` it is checked right away, also while
 *  the agent is still off (the onboarding); otherwise off stays off. */
export async function chooseProvider(id: AgentProviderId, check: boolean): Promise<void> {
  if (agentSettings.provider() === id) return;
  await agentSettings.setProvider(id);
  if (!check) return;
  const status = await agentStore.refreshStatus();
  if (status.state === "ready") await agentStore.refreshModels().catch(() => []);
}

/** The three ways as radio cards; the chosen one shows its state. */
export function ProviderPicker(props: { onChange?(id: AgentProviderId): void; showStatus: boolean; check: boolean }) {
  const ready = () => agentStore.status().state === "ready";
  // Whether the AgentZ account is open to this account follows the sign-in.
  createEffect(on(() => account.signedIn(), () => void agentStore.refreshHostedAccess()));
  return (
    <div class="ag-prov" role="radiogroup" aria-label={t("agent.prefs.connection")}>
      <For each={AGENT_PROVIDERS}>
        {(id) => {
          const selected = () => agentSettings.provider() === id;
          const soon = () => comingSoon(id);
          return (
            <button
              type="button"
              role="radio"
              class="ag-prov-it"
              classList={{ "is-on": selected(), "is-soon": soon() }}
              aria-checked={selected()}
              disabled={soon()}
              onClick={() => { void chooseProvider(id, props.check); props.onChange?.(id); }}
            >
              <span class="ag-prov-rd" />
              <div>
                <b>
                  {t(NAME[id])}
                  <Show when={soon()}><span class="ag-prov-soon">{t("agent.provider.soon")}</span></Show>
                </b>
                <small classList={{ "is-ready": selected() && props.showStatus && ready() }}>
                  <i />
                  {selected() && props.showStatus ? providerStatusLine() : providerSub(id)}
                </small>
              </div>
            </button>
          );
        }}
      </For>
    </div>
  );
}

/** What the current provider needs before it is ready: Codex installation
 *  and sign-in, the AgentZ sign-in, or an own key. Empty when ready. */
export function ProviderSetup() {
  const state = () => agentStore.status().state;
  return (
    <Switch>
      <Match when={agentSettings.provider() === "codex" && (state() === "missing" || state() === "logged-out")}>
        <CodexSetupInstructions install={state() === "missing"} />
      </Match>
      <Match when={agentSettings.provider() === "agentz" && state() === "logged-out"}>
        <AgentzSignIn />
      </Match>
      <Match when={agentSettings.provider() === "openrouter"}>
        <OpenRouterKey />
      </Match>
    </Switch>
  );
}

function AgentzSignIn() {
  return (
    <div class="ag-codex-setup">
      <Show when={account.enabled()} fallback={<p>{t("agent.provider.agentz.noCloud")}</p>}>
        <p>{t("agent.provider.agentz.signInBody", { name: agentSettings.displayName() })}</p>
        <button type="button" class="btn primary ag-setup-btn" onClick={() => void account.signIn()}>
          {t("agent.provider.agentz.signIn")}
        </button>
      </Show>
    </div>
  );
}

function OpenRouterKey() {
  const [draft, setDraft] = createSignal("");
  const [editing, setEditing] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [failed, setFailed] = createSignal(false);
  const hint = () => agentStore.openRouterKeyHint();
  const invalid = () => {
    const status = agentStore.status();
    return status.state === "error" && status.message === AGENT_KEY_INVALID;
  };
  const save = async (value: string) => {
    if (busy()) return;
    setBusy(true);
    setFailed(false);
    try {
      await agentStore.setOpenRouterKey(value);
      setDraft("");
      setEditing(false);
    } catch (error) {
      console.warn("[agent] storing the OpenRouter key failed", error);
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  const openKeys = (event: MouseEvent) => {
    event.preventDefault();
    void getPlatformAdapter().openUrl(KEYS_URL).catch(() => {});
  };
  return (
    <div class="ag-codex-setup">
      <p>{t("agent.provider.openrouter.body")}</p>
      <Show
        when={hint() && !editing()}
        fallback={
          <form class="ag-key-form" onSubmit={(e) => { e.preventDefault(); if (draft().trim()) void save(draft()); }}>
            <input
              class="field"
              type="password"
              autocomplete="off"
              spellcheck={false}
              placeholder={t("agent.provider.openrouter.placeholder")}
              aria-label={t("agent.provider.openrouter")}
              value={draft()}
              onInput={(e) => setDraft(e.currentTarget.value)}
            />
            <button type="submit" class="btn primary" disabled={busy() || !draft().trim()}>{t("agent.provider.openrouter.save")}</button>
            <Show when={hint()}>
              <button type="button" class="btn ghost" onClick={() => { setEditing(false); setDraft(""); }}>{t("agent.mem.cancel")}</button>
            </Show>
          </form>
        }
      >
        <div class="ag-key-form">
          <span class="ag-key-hint">{t("agent.provider.openrouter.saved", { hint: hint() ?? "" })}</span>
          <button type="button" class="btn" onClick={() => setEditing(true)}>{t("agent.provider.openrouter.change")}</button>
          <button type="button" class="btn ghost" disabled={busy()} onClick={() => void save("")}>{t("agent.provider.openrouter.remove")}</button>
        </div>
      </Show>
      <Show when={invalid()}><span role="alert">{t("agent.error.keyInvalid")}</span></Show>
      <Show when={failed()}><span role="alert">{t("agent.provider.openrouter.saveFailed")}</span></Show>
      <a href={KEYS_URL} onClick={openKeys}>{t("agent.provider.openrouter.getKey")}</a>
    </div>
  );
}
