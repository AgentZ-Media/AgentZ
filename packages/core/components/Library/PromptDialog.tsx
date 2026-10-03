import { Show, createEffect, createSignal } from "solid-js";
import { Modal } from "../Common/Modal";
import { t } from "../../i18n";

export interface PromptDialogProps {
  open: boolean;
  title: string;
  label: string;
  initialValue: string;
  placeholder?: string;
  submitLabel: string;
  /** Shown under the field while the value is empty (empty is not allowed). */
  emptyHint?: string;
  /** Shown under the field otherwise (e.g. "Aktuell: …"). */
  hint?: string;
  onSubmit: (value: string) => void | Promise<void>;
  onClose: () => void;
}

/** Single-field text dialog: script rename and "new folder" from the move
 *  menu (replaces the old BrowserDialogs). Empty values never submit. */
export function PromptDialog(props: PromptDialogProps) {
  const [value, setValue] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  let inputRef: HTMLInputElement | undefined;

  let wasOpen = false;
  createEffect(() => {
    if (props.open && !wasOpen) {
      setValue(props.initialValue);
      setBusy(false);
      // Modal focuses its first focusable (the close button) in the next
      // frame; take the focus over one frame later.
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          inputRef?.focus();
          inputRef?.select();
        }),
      );
    }
    wasOpen = props.open;
  });

  const empty = () => value().trim().length === 0;

  async function submit() {
    if (empty() || busy()) return;
    setBusy(true);
    try {
      await props.onSubmit(value().trim());
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={props.open}
      onClose={props.onClose}
      title={props.title}
      maxWidth={440}
      footer={
        <>
          <button type="button" class="btn" onClick={props.onClose}>
            {t("common.cancel")}
          </button>
          <button
            type="button"
            class="btn primary"
            onClick={() => void submit()}
            disabled={empty() || busy()}
          >
            {props.submitLabel}
          </button>
        </>
      }
    >
      <label class="prompt-field">
        <span class="prompt-label">{props.label}</span>
        <input
          ref={inputRef}
          type="text"
          class="field"
          value={value()}
          placeholder={props.placeholder}
          aria-invalid={empty()}
          onInput={(e) => setValue(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void submit();
            }
          }}
        />
        <Show
          when={empty() && props.emptyHint}
          fallback={
            <Show when={props.hint}>
              <span class="prompt-hint">{props.hint}</span>
            </Show>
          }
        >
          <span class="prompt-hint is-warn">{props.emptyHint}</span>
        </Show>
      </label>
    </Modal>
  );
}
