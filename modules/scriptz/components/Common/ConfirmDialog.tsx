import { Show } from "solid-js";
import { render } from "solid-js/web";
import { Modal } from "./Modal";
import { t } from "../../i18n";

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  body?: string;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm(): void;
  onCancel(): void;
}

export function ConfirmDialog(props: ConfirmDialogProps) {
  return (
    <Modal
      open={props.open}
      onClose={props.onCancel}
      title={props.title}
      footer={
        <>
          <button class="btn" onClick={() => props.onCancel()}>
            {props.cancelLabel ?? t("common.cancel")}
          </button>
          <button
            class={props.danger ? "btn btn-danger" : "btn btn-primary"}
            onClick={() => props.onConfirm()}
            autofocus
          >
            {props.confirmLabel}
          </button>
        </>
      }
    >
      <Show when={props.body}>
        <p style="margin:0;color:var(--fg-muted);font-size:var(--fs-14);line-height:var(--lh-normal);">
          {props.body}
        </p>
      </Show>
    </Modal>
  );
}

export interface ConfirmOpts {
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

/** Promise-based helper. Mounts a temporary <ConfirmDialog/> to <body> and resolves with the user's choice. */
export function confirmDialog(opts: ConfirmOpts): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const host = document.createElement("div");
    document.body.appendChild(host);

    const cleanup = (result: boolean) => {
      try {
        dispose();
      } finally {
        host.remove();
        resolve(result);
      }
    };

    const dispose = render(
      () => (
        <ConfirmDialog
          open={true}
          title={opts.title}
          body={opts.body}
          confirmLabel={opts.confirmLabel ?? t("common.confirm")}
          cancelLabel={opts.cancelLabel}
          danger={opts.danger}
          onConfirm={() => cleanup(true)}
          onCancel={() => cleanup(false)}
        />
      ),
      host,
    );
  });
}
