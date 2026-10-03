import { JSX, Show } from "solid-js";
import { t } from "../i18n";

export function SectionHead(props: { title: string; sub: string; onClose(): void }) {
  return (
    <div class="dlg-h set-head">
      <div>
        <b>{props.title}</b>
        <small>{props.sub}</small>
      </div>
      <button type="button" class="dlg-esc" onClick={() => props.onClose()} aria-label={t("common.close")}>
        <kbd>esc</kbd>
      </button>
    </div>
  );
}

export function Row(props: { label: string; help?: JSX.Element; children?: JSX.Element; class?: string }) {
  return (
    <div class={`srow${props.class ? ` ${props.class}` : ""}`}>
      <div>
        <b>{props.label}</b>
        <Show when={props.help}>
          <small>{props.help}</small>
        </Show>
      </div>
      <Show when={props.children}>
        <div class="srow-ctl">{props.children}</div>
      </Show>
    </div>
  );
}

export function Switch(props: { checked: boolean; onChange(v: boolean): void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      class="sw-t"
      role="switch"
      aria-checked={props.checked}
      aria-label={props.label}
      disabled={props.disabled}
      onClick={() => !props.disabled && props.onChange(!props.checked)}
    />
  );
}

