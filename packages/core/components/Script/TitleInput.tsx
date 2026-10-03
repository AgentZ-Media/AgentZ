import { createEffect, createSignal } from "solid-js";
import { t } from "../../i18n";

export interface TitleInputProps {
  scriptId: string;
  title: string;
  class?: string;
  /** When this equals `scriptId`, the input takes focus and selects its
   *  text once (new "Unbenannt" scripts). */
  focusFor: string | null;
  /** Called after the one-time auto focus happened. */
  onAutoFocused?(): void;
  onCommit(next: string): void;
}

/** Inline, auto-sizing script title. Commits on Enter / blur, Escape
 *  reverts. Enter hands the caret back to the editor. */
export function TitleInput(props: TitleInputProps) {
  const [draft, setDraft] = createSignal(props.title);
  let inputRef: HTMLInputElement | undefined;
  let lastFocusedFor: string | null = null;

  createEffect(() => {
    // Follow external renames, but never clobber what the user is typing.
    const next = props.title;
    if (document.activeElement !== inputRef) setDraft(next);
  });

  createEffect(() => {
    const id = props.focusFor;
    if (!id || id !== props.scriptId || lastFocusedFor === id) return;
    lastFocusedFor = id;
    // After the editor's own mount-focus (one rAF) has run.
    requestAnimationFrame(() =>
      setTimeout(() => {
        if (!inputRef || !inputRef.isConnected) return;
        inputRef.focus();
        inputRef.select();
        props.onAutoFocused?.();
      }, 0),
    );
  });

  // The rename is async: until the new title arrives via props, a second
  // blur must not commit the same value again.
  let lastCommitted: string | null = null;
  const commit = () => {
    const v = draft().trim();
    if (v && v !== props.title && v !== lastCommitted) {
      lastCommitted = v;
      props.onCommit(v);
    } else if (!v) {
      setDraft(props.title);
    }
  };
  createEffect(() => {
    void props.title;
    lastCommitted = null;
  });

  /** Moves the caret back into the editor (blurring the input commits). */
  const leave = () => {
    const root = inputRef?.closest(".ss")?.querySelector<HTMLElement>(".editor-root");
    if (root) root.focus();
    else inputRef?.blur();
  };

  return (
    <span class={`ss-title ${props.class ?? ""}`} data-value={draft() || t("common.untitled")}>
      <input
        ref={inputRef}
        value={draft()}
        size={1}
        spellcheck={false}
        placeholder={t("common.untitled")}
        aria-label={t("script.titleAriaLabel")}
        onInput={(e) => setDraft(e.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            leave();
          } else if (e.key === "Escape") {
            e.preventDefault();
            setDraft(props.title);
            leave();
          }
        }}
      />
    </span>
  );
}

export default TitleInput;
