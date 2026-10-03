import { Show, createSignal, createMemo, createEffect, onMount, onCleanup, type JSX } from "solid-js";
import { Portal } from "solid-js/web";
import { settingsStore, type Theme } from "../../stores/settings";
import { api } from "../../lib/api";
import { K } from "../../lib/keys";
import { t, type LanguagePref } from "../../i18n";
import "./OnboardingDialog.css";

export const ONBOARDING_KEY = "onboarding_completed_v1";

export interface OnboardingDialogProps {
  open: boolean;
  onClose(): void;
  /** Called when the user finishes onboarding. The host app is
   *  expected to open the welcome/tutorial script if it still exists,
   *  and fall back to the browser otherwise. */
  onFinish?(): void;
  /** When true: shows an additional note block in step 1
   *  explaining that this is the web test version and
   *  recommending the desktop app. Only the web app sets this. */
  webIntro?: boolean;
}

type StepDir = "forward" | "backward" | "none";

// 3 cards: appearance (incl. language + theme) → writing → final CTA.
const TOTAL_STEPS = 3;

export function OnboardingDialog(props: OnboardingDialogProps) {
  const [step, setStep] = createSignal(0);
  const [dir, setDir] = createSignal<StepDir>("none");
  // Guard against double submission. While `setAppState` is in flight
  // the dialog is still rendered, so a fast Enter press / double click
  // could call `onFinish` twice — and the new contract opens the
  // welcome script, so we'd open it twice in two tabs.
  const [isFinishing, setIsFinishing] = createSignal(false);

  let lastOpen = false;
  createEffect(() => {
    if (props.open && !lastOpen) {
      setStep(0);
      setDir("none");
      setIsFinishing(false);
    }
    lastOpen = props.open;
  });

  const next = () => {
    if (step() >= TOTAL_STEPS - 1) {
      void completeAndFinish();
      return;
    }
    setDir("forward");
    setStep((s) => s + 1);
  };

  const back = () => {
    if (step() === 0) return;
    setDir("backward");
    setStep((s) => s - 1);
  };

  const completeAndClose = async () => {
    if (isFinishing()) return;
    setIsFinishing(true);
    try {
      await api.setAppState(ONBOARDING_KEY, "1");
    } catch {
      /* non-fatal */
    }
    props.onClose();
  };

  const completeAndFinish = async () => {
    if (isFinishing()) return;
    setIsFinishing(true);
    try {
      await api.setAppState(ONBOARDING_KEY, "1");
    } catch {
      /* non-fatal */
    }
    props.onClose();
    props.onFinish?.();
  };

  const skip = () => void completeAndClose();

  const onKey = (e: KeyboardEvent) => {
    if (!props.open) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      skip();
      return;
    }
    if (e.key === "Enter") {
      const target = e.target as HTMLElement | null;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
      e.preventDefault();
      next();
      return;
    }
    if (e.key === "ArrowRight") {
      e.preventDefault();
      next();
      return;
    }
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      back();
      return;
    }
  };

  onMount(() => {
    document.addEventListener("keydown", onKey, true);
    onCleanup(() => document.removeEventListener("keydown", onKey, true));
  });

  const animKey = createMemo(() => `${step()}-${dir()}`);

  const isFinalStep = () => step() === TOTAL_STEPS - 1;

  return (
    <Show when={props.open}>
      <Portal>
        <div class="ob-backdrop" role="dialog" aria-modal="true" aria-label={t("onboarding.aria")}>
          <div class="ob-shell">
            <button
              type="button"
              class="ob-skip-x"
              aria-label={t("onboarding.skipAria")}
              title={t("onboarding.skipTitle")}
              onClick={skip}
            >
              ✕
            </button>

            <div class="ob-stage">
              <div class="ob-card" data-step={step()} data-dir={dir()} data-anim-key={animKey()}>
                <Show when={step() === 0}>
                  <StepAppearance webIntro={props.webIntro} />
                </Show>
                <Show when={step() === 1}>
                  <StepWriting />
                </Show>
                <Show when={step() === 2}>
                  <StepFinal />
                </Show>
              </div>
            </div>

            <div class="ob-foot">
              <div class="ob-foot-left">
                <Show
                  when={step() > 0}
                  fallback={
                    <button type="button" class="ob-link" onClick={skip}>
                      {t("onboarding.skip")}
                    </button>
                  }
                >
                  <button type="button" class="ob-link" onClick={back}>
                    {t("onboarding.back")}
                  </button>
                </Show>
              </div>

              <div class="ob-dots" aria-hidden="true">
                {Array.from({ length: TOTAL_STEPS }, (_, i) => (
                  <span class="ob-dot" classList={{ "is-on": i === step(), "is-done": i < step() }} />
                ))}
              </div>

              <div class="ob-foot-right">
                <Show
                  when={!isFinalStep()}
                  fallback={
                    <button
                      type="button"
                      class="btn btn-primary ob-cta"
                      disabled={isFinishing()}
                      onClick={() => void completeAndFinish()}
                    >
                      {t("onboarding.finish")}
                    </button>
                  }
                >
                  <button type="button" class="btn btn-primary ob-cta" onClick={next}>
                    {t("onboarding.next")}
                  </button>
                </Show>
              </div>
            </div>
          </div>
        </div>
      </Portal>
    </Show>
  );
}

/* =========================================================================
   Schritt 1 - Erscheinungsbild (Sprache + Theme + Charakter-Highlighting)
   ========================================================================= */
function StepAppearance(props: { webIntro?: boolean }) {
  const themes = (): { id: Theme; label: string; sub: string }[] => [
    { id: "light", label: t("theme.light"), sub: t("theme.lightSub") },
    { id: "dark",  label: t("theme.dark"),  sub: t("theme.darkSub") },
    { id: "auto",  label: t("theme.auto"),  sub: t("theme.autoSub") },
  ];
  const languages = (): { id: LanguagePref; label: string }[] => [
    { id: "de",   label: t("lang.de") },
    { id: "en",   label: t("lang.en") },
    { id: "auto", label: t("lang.auto") },
  ];
  const on = () => settingsStore.highlightingDefault();
  return (
    <div class="ob-step">
      <div class="ob-eyebrow">{t("onboarding.appearance.eyebrow")}</div>
      <h1 class="ob-h1">{t("onboarding.appearance.h1")}</h1>
      <p class="ob-lede">
        {t("onboarding.appearance.lede")}
      </p>

      <Show when={props.webIntro}>
        <div class="ob-web-note" role="note">
          <div class="ob-web-note-title">
            {t("onboarding.appearance.webNote.title")}
          </div>
          <p class="ob-web-note-text">
            {t("onboarding.appearance.webNote.text")}{" "}
            <a
              href="https://write-scriptz.com"
              target="_blank"
              rel="noopener"
            >
              {t("onboarding.appearance.webNote.link")}
            </a>
          </p>
        </div>
      </Show>

      {/* Language: compact segmented control placed directly above
          the theme cards. Intentionally not its own step - the user
          should configure theme + language in one go. */}
      <div class="ob-hl-row" style="margin-bottom: 16px;">
        <div class="ob-hl-row-label">
          <div class="ob-field-label">{t("lang.label")}</div>
          <div class="ob-field-help">{t("lang.help")}</div>
        </div>
        <div class="seg" role="group" aria-label={t("lang.label")}>
          {languages().map((l) => (
            <button
              type="button"
              classList={{ "is-on": settingsStore.language() === l.id }}
              onClick={() => void settingsStore.setLanguage(l.id)}
            >
              {l.label}
            </button>
          ))}
        </div>
      </div>

      <div class="ob-themes">
        {themes().map((th) => (
          <button
            type="button"
            class="ob-theme"
            classList={{ "is-on": settingsStore.theme() === th.id }}
            onClick={() => void settingsStore.setTheme(th.id)}
            data-variant={th.id}
            aria-pressed={settingsStore.theme() === th.id}
          >
            <div class="ob-theme-preview" data-variant={th.id}>
              <div class="ob-theme-window">
                <div class="ob-theme-tl">
                  <span /><span /><span />
                </div>
                <div class="ob-theme-paper">
                  <div class="ob-theme-line w-70" />
                  <div class="ob-theme-line w-90" />
                  <div class="ob-theme-line w-50" />
                  <div class="ob-theme-line ob-theme-char w-30" />
                  <div class="ob-theme-line w-80" />
                </div>
              </div>
            </div>
            <div class="ob-theme-meta">
              <div class="ob-theme-label">{th.label}</div>
              <div class="ob-theme-sub">{th.sub}</div>
            </div>
            <span class="ob-theme-check" aria-hidden="true">✓</span>
          </button>
        ))}
      </div>

      <div class="ob-hl-preview" data-on={on() ? "1" : "0"} aria-hidden="true">
        <div class="ob-hl-paper">
          <ObHlBlock kind="character" tint="--char-1" text="MIRA" />
          <ObHlBlock kind="dialog"    tint="--char-1" text={t("onboarding.appearance.highlight.dialog1")} />
          <ObHlBlock kind="character" tint="--char-2" text="JONAS" />
          <ObHlBlock kind="dialog"    tint="--char-2" text={t("onboarding.appearance.highlight.dialog2")} />
        </div>
      </div>

      <div class="ob-hl-row">
        <div class="ob-hl-row-label">
          <div class="ob-field-label">{t("onboarding.appearance.highlight.label")}</div>
          <div class="ob-field-help">
            {t("onboarding.appearance.highlight.help")}
          </div>
        </div>
        <ObToggle
          checked={settingsStore.highlightingDefault()}
          onChange={(v) => void settingsStore.setHighlightingDefault(v)}
          label={t("onboarding.appearance.highlight.label")}
        />
      </div>
    </div>
  );
}

function ObHlBlock(props: {
  kind: "action" | "character" | "dialog";
  tint?: string;
  text: string;
}) {
  return (
    <div
      class="ob-hl-block"
      data-kind={props.kind}
      style={props.tint ? `--ob-tint: var(${props.tint})` : ""}
    >
      <span class="ob-hl-text">{props.text}</span>
    </div>
  );
}

/* =========================================================================
   Schritt 2 - Schreib-Defaults (Wochenziel + Fokus-Modus)
   ========================================================================= */
function StepWriting() {
  return (
    <div class="ob-step">
      <div class="ob-eyebrow">{t("onboarding.writing.eyebrow")}</div>
      <h1 class="ob-h1">{t("onboarding.writing.h1")}</h1>
      <p class="ob-lede">
        {t("onboarding.writing.lede")}
      </p>

      <div class="ob-fields">
        <div class="ob-field">
          <div class="ob-field-head">
            <div class="ob-field-label">{t("onboarding.writing.focus.label")}</div>
            <div class="ob-field-help">
              {t("onboarding.writing.focus.help", { hotkey: K("Mod+Shift+F") })}
            </div>
          </div>
          <ObToggle
            checked={settingsStore.focusModeDefault()}
            onChange={(v) => void settingsStore.setFocusModeDefault(v)}
            label={t("onboarding.writing.focus.label")}
          />
        </div>
      </div>
    </div>
  );
}

/* =========================================================================
   Final-Karte - CTA zur ersten Aktion
   ========================================================================= */
function StepFinal() {
  return (
    <div class="ob-step ob-step-final">
      <div class="ob-eyebrow">{t("onboarding.final.eyebrow")}</div>
      <h1 class="ob-h1">{t("onboarding.final.h1")}</h1>
      <p class="ob-lede">
        {t("onboarding.final.lede")}
      </p>
      <div class="ob-final-hints">
        <div class="ob-final-hint">
          <span class="kbd kbd-inline">{K("Mod+N")}</span> {t("onboarding.final.hint.newScript")}
        </div>
        <div class="ob-final-hint">
          <span class="kbd kbd-inline">{K("Mod+K")}</span> {t("onboarding.final.hint.search")}
        </div>
        <div class="ob-final-hint">
          <span class="kbd kbd-inline">{K("Mod+I")}</span> {t("onboarding.final.hint.idea")}
        </div>
      </div>
    </div>
  );
}

function ObToggle(props: { checked: boolean; onChange(v: boolean): void; label?: string }) {
  return (
    <button
      type="button"
      class="ob-toggle"
      classList={{ "is-on": props.checked }}
      role="switch"
      aria-checked={props.checked}
      aria-label={props.label}
      onClick={() => props.onChange(!props.checked)}
    />
  );
}

void (null as unknown as JSX.Element);
