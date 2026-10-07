import { settingsStore } from "../../stores/settings";
import { For, Match, Show, Switch, createEffect, createSignal, onCleanup } from "solid-js";
import { CHARACTER_PALETTE } from "../../lib/colors";
import { K } from "@agentz/kit/platform";
import { getWelcomeScript } from "../../lib/welcome";
import { navStore } from "../../stores/nav";
import { baseSettingsStore, type Theme } from "@agentz/kit/stores";
import type { OnboardingProps } from "@agentz/kit/shell";
import { type LanguagePref } from "@agentz/kit/i18n";
import { t } from "../../i18n";
import { AppMark } from "@agentz/kit/ui";
import { Icon } from "@agentz/kit/ui";
import { DialogFrame } from "@agentz/kit/ui";
import { account } from "@agentz/kit/account";
import { agentStore } from "../../stores/agent";
import { agentSettings } from "../../stores/agentSettings";
import "./Onboarding.css";

/** app_state key marking the onboarding as done (unchanged since v1, so
 *  existing installs don't see it again). */
export const ONBOARDING_KEY = "onboarding_completed_v1";

type StepId = "appearance" | "blocks" | "go" | "agent" | "sync";
/** The agent step exists only where the agent can run, the sync step only
 *  when the host has a cloud backend. */
const stepIds = (): StepId[] => [
  "appearance",
  "blocks",
  "go",
  ...(agentStore.supported() ? (["agent"] as const) : []),
  ...(account.enabled() ? (["sync"] as const) : []),
];
type SyncChoice = "local" | "cloud";
// Demo characters - content colours (data), taken from the character palette.
const COLOR_A = CHARACTER_PALETTE[3];
const COLOR_B = CHARACTER_PALETTE[4];

/** First-run onboarding (and "Onboarding erneut zeigen" in the settings):
 *  appearance, the four blocks, keys, whether the AI agent is shown at all
 *  and, with a cloud backend, the choice between local only and a synced
 *  account - on a full-window grid. Its
 *  visibility and completion marker belong to the shared shell. */
export function Onboarding(props: OnboardingProps) {
  const [step, setStep] = createSignal(0);
  const [finishing, setFinishing] = createSignal(false);
  const [choice, setChoice] = createSignal<SyncChoice>("local");

  let disposed = false;
  onCleanup(() => { disposed = true; });
  let wasOpen = false;
  createEffect(() => {
    const open = props.open;
    if (open && !wasOpen) {
      setStep(0);
      setFinishing(false);
      setChoice("local");
    }
    wasOpen = open;
  });

  async function skip() {
    if (finishing()) return;
    setFinishing(true);
    await props.complete();
  }

  async function finish() {
    if (finishing()) return;
    setFinishing(true);
    await props.complete();
    if (disposed) return;
    // The sign-in dialog opens over the welcome script.
    const wanted = choice();
    if (wanted === "cloud" && !account.signedIn()) void account.signIn();
    try {
      const welcome = await getWelcomeScript();
      if (disposed) return;
      if (welcome) {
        navStore.openScript(welcome.id, welcome.title);
        return;
      }
    } catch (err) {
      console.warn("[scriptz] welcome resolution failed", err);
    }
    if (!disposed && !navStore.isScripts()) navStore.openScripts();
  }

  const steps = () => stepIds().length;
  const current = () => stepIds()[step()];
  const last = () => step() >= steps() - 1;
  const next = () => (last() ? void finish() : setStep(step() + 1));
  const back = () => step() > 0 && setStep(step() - 1);

  const onKey = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement | null;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
    // Buttons (back, skip, segments, switches) activate themselves; the
    // primary "Weiter" button has the focus by default.
    if (target instanceof HTMLButtonElement) {
      if (e.key === "Enter" || target.closest(".seg")) return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      next();
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      next();
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      back();
    }
  };

  const names = (): Record<StepId, string> => ({
    appearance: t("onb.s1.name"),
    blocks: t("onb.s2.name"),
    go: t("onb.s3.name"),
    agent: t("onb.agent.name"),
    sync: t("onb.s4.name"),
  });
  const eyebrow = () => t("onb.eyebrow", { n: step() + 1, total: steps(), name: names()[current()] });
  const finishLabel = () => (choice() === "cloud" && !account.signedIn() ? t("onb.s4.finishCloud") : t("onb.finish"));

  return (
    <DialogFrame
      open={props.open}
      onClose={() => void skip()}
      label={t("onb.aria")}
      layerClass="onb"
      surfaceClass="onb-card"
      closeOnBackdrop={false}
      restoreFocus={() => false}
    >
      <div class="onb-drag" data-tauri-drag-region aria-hidden="true" />
      <div class="onb-l" onKeyDown={onKey}>
        <div class="onb-brand">
          <AppMark logo="scriptz" appName="ScriptZ" size={34} />
          ScriptZ
        </div>
        <div class="onb-steps" aria-hidden="true">
          <For each={Array.from({ length: steps() }, (_, i) => i)}>
            {(i) => <span classList={{ done: i < step(), on: i === step() }} />}
          </For>
        </div>
        <div class="onb-eyebrow">{eyebrow()}</div>
        <Switch>
          <Match when={current() === "appearance"}>
            <StepAppearance />
          </Match>
          <Match when={current() === "blocks"}>
            <StepBlocks />
          </Match>
          <Match when={current() === "go"}>
            <StepGo />
          </Match>
          <Match when={current() === "agent"}>
            <StepAgent />
          </Match>
          <Match when={current() === "sync"}>
            <StepSync choice={choice()} onChoice={setChoice} />
          </Match>
        </Switch>
        <div class="onb-foot">
          <Show when={step() > 0}>
            <button type="button" class="btn ghost" onClick={back}>
              {t("onb.back")}
            </button>
          </Show>
          <span class="sp" />
          <Show when={!last()}>
            <button type="button" class="onb-skip" onClick={() => void skip()}>
              {t("onb.skip")}
            </button>
          </Show>
          <button type="button" class="btn primary" data-autofocus disabled={finishing()} onClick={next}>
            {last() ? finishLabel() : t("onb.next")}
            <kbd>⏎</kbd>
          </button>
        </div>
      </div>
      <div class="onb-r" aria-hidden="true">
        <Switch>
          <Match when={current() === "appearance"}>
            <PreviewAppearance />
          </Match>
          <Match when={current() === "blocks"}>
            <PreviewBlocks />
          </Match>
          <Match when={current() === "go"}>
            <PreviewKeys />
          </Match>
          <Match when={current() === "agent"}>
            <PreviewAgent />
          </Match>
          <Match when={current() === "sync"}>
            <PreviewSync />
          </Match>
        </Switch>
      </div>
    </DialogFrame>
  );
}

/* ----------------------------- step 1 ----------------------------- */

function StepAppearance() {
  const themes = (): Array<{ id: Theme; label: string }> => [
    { id: "light", label: t("theme.light") },
    { id: "dark", label: t("theme.dark") },
    { id: "auto", label: t("theme.auto") },
  ];
  const languages = (): Array<{ id: LanguagePref; label: string }> => [
    { id: "de", label: t("lang.de") },
    { id: "en", label: t("lang.en") },
    { id: "auto", label: t("lang.auto") },
  ];
  return (
    <>
      <h2 class="onb-h">{t("onb.s1.h")}</h2>
      <p class="onb-p">{t("onb.s1.p")}</p>
      <div class="onb-ctl">
        <div class="srow">
          <div>
            <b>{t("onb.s1.theme")}</b>
          </div>
          <div class="seg" role="radiogroup" aria-label={t("onb.s1.theme")}>
            <For each={themes()}>
              {(th) => (
                <button
                  type="button"
                  role="radio"
                  aria-checked={baseSettingsStore.theme() === th.id}
                  onClick={() => void baseSettingsStore.setTheme(th.id)}
                >
                  {th.label}
                </button>
              )}
            </For>
          </div>
        </div>
        <div class="srow">
          <div>
            <b>{t("lang.label")}</b>
          </div>
          <div class="seg" role="radiogroup" aria-label={t("lang.label")}>
            <For each={languages()}>
              {(l) => (
                <button
                  type="button"
                  role="radio"
                  aria-checked={baseSettingsStore.language() === l.id}
                  onClick={() => void baseSettingsStore.setLanguage(l.id)}
                >
                  {l.label}
                </button>
              )}
            </For>
          </div>
        </div>
        <div class="srow">
          <div>
            <b>{t("onb.s1.colors")}</b>
            <small>{t("onb.s1.colorsHelp")}</small>
          </div>
          <button
            type="button"
            class="sw-t"
            role="switch"
            aria-checked={settingsStore.highlightingDefault()}
            aria-label={t("onb.s1.colors")}
            onClick={() => void settingsStore.setHighlightingDefault(!settingsStore.highlightingDefault())}
          />
        </div>
      </div>
    </>
  );
}

function PreviewAppearance() {
  const tinted = () => settingsStore.highlightingDefault();
  return (
    <div class="onb-win">
      <div class="onb-win-side">
        <AppMark logo="scriptz" appName="ScriptZ" size={18} />
        <span />
        <span />
        <span class="on" />
        <span />
      </div>
      <div class="onb-win-main">
        <div class="onb-win-bar">
          <span />
        </div>
        <div class="onb-sheet onb-sheet-mini" classList={{ tinted: tinted() }}>
          <div class="b act">{t("onb.demo.action")}</div>
          <div class="b char" style={{ "--c": COLOR_A }}>
            <span class="m">{t("onb.demo.nameA")}</span>
          </div>
          <div class="b dia" style={{ "--c": COLOR_A }}>
            <span class="m">{t("onb.demo.lineA")}</span>
          </div>
          <div class="b char" style={{ "--c": COLOR_B }}>
            <span class="m">{t("onb.demo.nameB")}</span>
          </div>
          <div class="b dia" style={{ "--c": COLOR_B }}>
            <span class="m">{t("onb.demo.lineB")}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ----------------------------- step 2 ----------------------------- */

function StepBlocks() {
  return (
    <>
      <h2 class="onb-h">
        {t("onb.s2.h1")}
        <br />
        {t("onb.s2.h2")}
      </h2>
      <p class="onb-p">{t("onb.s2.p")}</p>
      <div class="onb-keys">
        <div>
          <kbd>{K("Mod+1")}</kbd>
          {t("block.action")}
        </div>
        <div>
          <kbd>{K("Mod+2")}</kbd>
          {t("block.character")}
        </div>
        <div>
          <kbd>{K("Mod+3")}</kbd>
          {t("block.dialog")}
        </div>
        <div>
          <kbd>{K("Mod+4")}</kbd>
          {t("block.parenthetical")}
        </div>
        <div>
          <kbd>{t("shortcut.key.tab")}</kbd>
          {t("onb.s2.picker")}
        </div>
      </div>
      <div class="srow onb-quick">
        <div>
          <b>{t("onb.s2.quick")}</b>
          <small>{t("onb.s2.quickHelp")}</small>
        </div>
        <button
          type="button"
          class="sw-t"
          role="switch"
          aria-checked={settingsStore.quickModeAutoEnable()}
          aria-label={t("onb.s2.quick")}
          onClick={() => void settingsStore.setQuickModeAutoEnable(!settingsStore.quickModeAutoEnable())}
        />
      </div>
    </>
  );
}

/** The onboarding mini script: Enter walks through the blocks, "("
 *  in the dialog line opens a parenthetical and ")" leads back into the
 *  dialog; rows appear one after another (static under reduced motion). */
function PreviewBlocks() {
  return (
    <div class="onb-sheet onb-demo tinted">
      <div class="dl" style={{ "--d": "0" }}>
        <span class="tag">{t("block.action")}</span>
        <div class="b act">{t("onb.demo.action")}</div>
        <span class="ent">⏎</span>
      </div>
      <div class="dl" style={{ "--d": "1" }}>
        <span class="tag">{t("block.character")}</span>
        <div class="b char" style={{ "--c": COLOR_A }}>
          <span class="m">{t("onb.demo.nameA")}</span>
        </div>
        <span class="ent">⏎</span>
      </div>
      <div class="dl" style={{ "--d": "2" }}>
        <span class="tag">{t("block.parenthetical")}</span>
        <div class="b par" style={{ "--c": COLOR_A }}>
          <span class="m">{t("onb.demo.parenA")}</span>
        </div>
        <span class="ent">)</span>
      </div>
      <div class="dl" style={{ "--d": "3" }}>
        <span class="tag">{t("block.dialog")}</span>
        <div class="b dia" style={{ "--c": COLOR_A }}>
          <span class="m">{t("onb.demo.lineA")}</span>
        </div>
        <span class="ent">⏎</span>
      </div>
      <div class="dl is-now" style={{ "--d": "4" }}>
        <span class="tag on">{t("block.character")}</span>
        <div class="b char" style={{ "--c": COLOR_B }}>
          <span class="m">{t("onb.demo.nameB")}</span>
          <span class="caret" />
        </div>
        <span class="ent" />
      </div>
      <div class="onb-note" style={{ "--d": "5" }}>
        <Icon name="bolt" size={13} />
        {t("onb.s2.note", { name: t("onb.demo.nameB") })}
      </div>
    </div>
  );
}

/* ----------------------------- step 3 ----------------------------- */

function StepGo() {
  return (
    <>
      <h2 class="onb-h">{t("onb.s3.h")}</h2>
      <p class="onb-p">{t("onb.s3.p")}</p>
      <div class="onb-keys onb-keys-list">
        <div>
          <kbd>{K("Mod+N")}</kbd>
          {t("onb.s3.newScript")}
        </div>
        <div>
          <kbd>{K("Mod+K")}</kbd>
          {t("onb.s3.palette")}
        </div>
        <div>
          <kbd>{K("Mod+I")}</kbd>
          {t("onb.s3.idea")}
        </div>
        <div>
          <kbd>{K("Mod+J")}</kbd>
          {t("onb.s3.timeline")}
        </div>
      </div>
    </>
  );
}

function PreviewKeys() {
  const keys = () => [
    { k: K("Mod+N"), l: t("onb.s3.capNew") },
    { k: K("Mod+K"), l: t("onb.s3.capPalette") },
    { k: K("Mod+I"), l: t("onb.s3.capIdea") },
    { k: K("Mod+J"), l: t("onb.s3.capTimeline") },
  ];
  return (
    <div class="onb-caps">
      <For each={keys()}>
        {(c, i) => (
          <div class="onb-cap" style={{ "--d": String(i()) }}>
            <b>{c.k}</b>
            <span>{c.l}</span>
          </div>
        )}
      </For>
    </div>
  );
}

/* ----------------------------- agent ------------------------------ */

/** Shown or hidden applies at once, like the other switches here; hiding
 *  keeps a set-up agent with its chats and memory. */
function StepAgent() {
  const name = () => agentSettings.displayName();
  return (
    <>
      <h2 class="onb-h">{t("onb.agent.h")}</h2>
      <p class="onb-p">{t("onb.agent.p")}</p>
      <div class="onb-choice" role="radiogroup" aria-label={t("onb.agent.name")}>
        <button
          type="button"
          role="radio"
          class="onb-opt"
          aria-checked={!agentSettings.hidden()}
          onClick={() => void agentSettings.setHidden(false)}
        >
          <Icon name="spark" size={18} />
          <span>
            <b>{t("onb.agent.show")}</b>
            <small>{agentSettings.onboarded() ? t("onb.agent.showReady", { name: name() }) : t("onb.agent.showHelp")}</small>
          </span>
        </button>
        <button
          type="button"
          role="radio"
          class="onb-opt"
          aria-checked={agentSettings.hidden()}
          onClick={() => void agentSettings.setHidden(true)}
        >
          <Icon name="x" size={18} />
          <span>
            <b>{t("onb.agent.hide")}</b>
            <small>{agentSettings.onboarded() ? t("onb.agent.hideReady") : t("onb.agent.hideHelp")}</small>
          </span>
        </button>
      </div>
    </>
  );
}

function PreviewAgent() {
  const caps = () => [
    { icon: "spark" as const, l: t("onb.agent.capPropose") },
    { icon: "bulb" as const, l: t("onb.agent.capLearn") },
    { icon: "shield" as const, l: t("onb.agent.capLocked") },
    { icon: "user" as const, l: t("onb.agent.capConnect") },
  ];
  return (
    <div class="onb-caps" classList={{ "is-off": agentSettings.hidden() }}>
      <For each={caps()}>
        {(c, i) => (
          <div class="onb-cap" style={{ "--d": String(i()) }}>
            <b><Icon name={c.icon} size={22} /></b>
            <span>{c.l}</span>
          </div>
        )}
      </For>
    </div>
  );
}

/* ----------------------------- sync ------------------------------- */

function StepSync(props: { choice: SyncChoice; onChoice(choice: SyncChoice): void }) {
  const name = () => account.user()?.name?.trim() || account.user()?.email || "";
  return (
    <>
      <h2 class="onb-h">{t("onb.s4.h")}</h2>
      <p class="onb-p">{t("onb.s4.p")}</p>
      <Show when={!account.signedIn()} fallback={<p class="onb-sync-done"><Icon name="check" size={14} />{t("onb.s4.signedIn", { name: name() })}</p>}>
        <div class="onb-choice" role="radiogroup" aria-label={t("onb.s4.name")}>
          <button type="button" role="radio" class="onb-opt" aria-checked={props.choice === "local"} onClick={() => props.onChoice("local")}>
            <Icon name="doc" size={18} />
            <span><b>{t("onb.s4.local")}</b><small>{t("onb.s4.localHelp")}</small></span>
          </button>
          <button type="button" role="radio" class="onb-opt" aria-checked={props.choice === "cloud"} onClick={() => props.onChoice("cloud")}>
            <Icon name="cloud" size={18} />
            <span><b>{t("onb.s4.cloud")}</b><small>{t("onb.s4.cloudHelp")}</small></span>
          </button>
        </div>
      </Show>
    </>
  );
}

function PreviewSync() {
  const caps = () => [
    { icon: "shield" as const, l: t("onb.s4.capEncrypted") },
    { icon: "stack" as const, l: t("onb.s4.capDevices") },
    { icon: "refresh" as const, l: t("onb.s4.capOffline") },
    { icon: "user" as const, l: t("onb.s4.capLocal") },
  ];
  return (
    <div class="onb-caps">
      <For each={caps()}>
        {(c, i) => (
          <div class="onb-cap" style={{ "--d": String(i()) }}>
            <b><Icon name={c.icon} size={22} /></b>
            <span>{c.l}</span>
          </div>
        )}
      </For>
    </div>
  );
}
