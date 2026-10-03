import { For, Match, Show, Switch, createEffect, createSignal } from "solid-js";
import { api } from "../../lib/api";
import { CHARACTER_PALETTE } from "../../lib/colors";
import { K } from "@agentz/kit/platform";
import { getWelcomeScript } from "../../lib/welcome";
import { navStore } from "../../stores/nav";
import { settingsStore, type Theme } from "../../stores/settings";
import { uiStore } from "../../stores/ui";
import { type LanguagePref } from "@agentz/kit/i18n";
import { t } from "../../i18n";
import { AppMark } from "@agentz/kit/ui";
import { Icon } from "@agentz/kit/ui";
import { DialogFrame } from "@agentz/kit/ui";
import "./Onboarding.css";

/** app_state key marking the onboarding as done (unchanged since v1, so
 *  existing installs don't see it again). */
export const ONBOARDING_KEY = "onboarding_completed_v1";

const STEPS = 3;
// Demo characters - content colours (data), taken from the character palette.
const COLOR_A = CHARACTER_PALETTE[3];
const COLOR_B = CHARACTER_PALETTE[4];

/** First-run onboarding (and "Onboarding erneut zeigen" in the settings):
 *  three steps - appearance, the four blocks, keys - on a full-window
 *  grid. Parameterless, driven by `uiStore.onboardingOpen()`. */
export function Onboarding() {
  const [step, setStep] = createSignal(0);
  const [finishing, setFinishing] = createSignal(false);

  let wasOpen = false;
  createEffect(() => {
    const open = uiStore.onboardingOpen();
    if (open && !wasOpen) {
      setStep(0);
      setFinishing(false);
    }
    wasOpen = open;
  });

  async function persistDone() {
    try {
      await api.setAppState(ONBOARDING_KEY, "1");
    } catch {
      /* non-fatal */
    }
  }

  async function skip() {
    if (finishing()) return;
    setFinishing(true);
    await persistDone();
    uiStore.closeOnboarding();
  }

  async function finish() {
    if (finishing()) return;
    setFinishing(true);
    await persistDone();
    uiStore.closeOnboarding();
    try {
      const welcome = await getWelcomeScript();
      if (welcome) {
        navStore.openScript(welcome.id, welcome.title);
        return;
      }
    } catch (err) {
      console.warn("[scriptz] welcome resolution failed", err);
    }
    if (!navStore.isScripts()) navStore.openScripts();
  }

  const next = () => (step() >= STEPS - 1 ? void finish() : setStep(step() + 1));
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

  const eyebrow = () =>
    t("onb.eyebrow", {
      n: step() + 1,
      total: STEPS,
      name: step() === 0 ? t("onb.s1.name") : step() === 1 ? t("onb.s2.name") : t("onb.s3.name"),
    });

  return (
    <DialogFrame
      open={uiStore.onboardingOpen()}
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
          <For each={Array.from({ length: STEPS }, (_, i) => i)}>
            {(i) => <span classList={{ done: i < step(), on: i === step() }} />}
          </For>
        </div>
        <div class="onb-eyebrow">{eyebrow()}</div>
        <Switch>
          <Match when={step() === 0}>
            <StepAppearance />
          </Match>
          <Match when={step() === 1}>
            <StepBlocks />
          </Match>
          <Match when={step() === 2}>
            <StepGo />
          </Match>
        </Switch>
        <div class="onb-foot">
          <Show when={step() > 0}>
            <button type="button" class="btn ghost" onClick={back}>
              {t("onb.back")}
            </button>
          </Show>
          <span class="sp" />
          <Show when={step() < STEPS - 1}>
            <button type="button" class="onb-skip" onClick={() => void skip()}>
              {t("onb.skip")}
            </button>
          </Show>
          <button type="button" class="btn primary" data-autofocus disabled={finishing()} onClick={next}>
            {step() < STEPS - 1 ? t("onb.next") : t("onb.finish")}
            <kbd>⏎</kbd>
          </button>
        </div>
      </div>
      <div class="onb-r" aria-hidden="true">
        <Switch>
          <Match when={step() === 0}>
            <PreviewAppearance />
          </Match>
          <Match when={step() === 1}>
            <PreviewBlocks />
          </Match>
          <Match when={step() === 2}>
            <PreviewKeys />
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
                  aria-checked={settingsStore.theme() === th.id}
                  onClick={() => void settingsStore.setTheme(th.id)}
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
                  aria-checked={settingsStore.language() === l.id}
                  onClick={() => void settingsStore.setLanguage(l.id)}
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

/** The mini script from the concept: Enter walks through the blocks, "("
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

export default Onboarding;
