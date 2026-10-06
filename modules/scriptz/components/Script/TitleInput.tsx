import { Show, createEffect, createSignal, on, onCleanup } from "solid-js";
import { t } from "../../i18n";
import { registerFlusher } from "@agentz/kit/lib";
import { createSerialSaver } from "@agentz/kit/lib";

export interface TitleInputProps {
  scriptId: string;
  title: string;
  class?: string;
  /** When this equals `scriptId`, the input takes focus and selects its
   *  text once (new "Unbenannt" scripts). */
  focusFor: string | null;
  /** Called after the one-time auto focus happened. */
  onAutoFocused?(): void;
  /** Persists the new title of `scriptId`. Should reject on failure so
   *  the draft stays pending and the next flush retries. */
  onCommit(next: string, scriptId: string): Promise<void> | void;
}

/** Inline, auto-sizing script title. Commits on Enter / blur, Escape
 *  reverts. Enter hands the caret back to the editor.
 *
 *  The draft is also committed before anything can drop it: the input
 *  registers a save flusher (navigation, export and window close await
 *  `flushAll`) and commits on unmount (⌘⇧F swaps the top bar for the
 *  focus title, ⌘[ removes the whole screen - a removed focused input
 *  doesn't reliably fire blur). Remounted per script, so a draft can never
 *  be committed to the wrong script. */
export function TitleInput(props: TitleInputProps) {
  return (
    <Show when={props.scriptId} keyed>
      {(id) => <TitleInputField {...props} scriptId={id} />}
    </Show>
  );
}

function TitleInputField(props: TitleInputProps) {
  const scriptId = props.scriptId;
  const [draft, setDraft] = createSignal(props.title);
  let inputRef: HTMLInputElement | undefined;
  let lastFocusedFor: string | null = null;

  // Commits are serialized and diffed against the last acknowledged
  // title, so a blur during an in-flight rename never skips or reorders
  // writes, and blur + unmount + flush never commit the same value twice.
  const saver = createSerialSaver<string>({
    initial: props.title,
    read: () => draft().trim(),
    isClean: (d, base) => !d || d === base,
    async write(d) {
      await props.onCommit(d, scriptId);
      return d;
    },
    // The caller already reports failures (toast).
    onError: () => {},
  });

  // Follow external renames (palette, library) while nothing of ours is
  // pending, and never clobber what the user is typing.
  createEffect(
    on(
      () => props.title,
      (next) => {
        if (!saver.idle()) return;
        saver.resetBaseline(next);
        if (document.activeElement !== inputRef) setDraft(next);
      },
      { defer: true },
    ),
  );

  createEffect(() => {
    const id = props.focusFor;
    if (!id || id !== scriptId || lastFocusedFor === id) return;
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

  let disposed = false;
  const commit = async () => {
    // An emptied title is never saved - show the stored one again.
    if (!draft().trim()) setDraft(saver.baseline());
    const result = await saver.flush();
    if (disposed && result.ok) unregister();
    return result;
  };

  const unregister = registerFlusher(commit, `title:${scriptId}`);
  onCleanup(() => {
    disposed = true;
    void commit();
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
        onInput={(e) => {
          setDraft(e.currentTarget.value);
          saver.markDirty();
        }}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            leave();
          } else if (e.key === "Escape") {
            e.preventDefault();
            setDraft(saver.baseline());
            leave();
          }
        }}
      />
    </span>
  );
}
