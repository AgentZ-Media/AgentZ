import { For, Show, createEffect, createMemo, createSignal } from "solid-js";
import { Modal } from "../Common/Modal";
import { pushToast } from "../../stores/toasts";
import { settingsStore } from "../../stores/settings";
import { t, tPlural } from "../../i18n";
import {
  fetchTargets,
  sendHandoff,
  tryParseConnectCode,
  type HandoffResult,
  type StudioConnection,
  type TransferClient,
} from "../../lib/handoff";
import "./HandoffDialog.css";

export interface HandoffDialogProps {
  open: boolean;
  scriptIds: string[];
  ideaIds: string[];
  onClose: () => void;
  /** Fired after a (possibly partial) successful transfer, so the caller can
   *  clear its selection and refresh lists. */
  onSent: (result: HandoffResult) => void;
}

/** Destination picker + send. The connection comes from the stored connect
 *  code (settings); the caller only opens this dialog when one is set. */
export function HandoffDialog(props: HandoffDialogProps) {
  const [clients, setClients] = createSignal<TransferClient[] | null>(null);
  const [loadError, setLoadError] = createSignal<string | null>(null);
  const [clientId, setClientId] = createSignal("");
  // "" = the client's inbox (no folder).
  const [folderId, setFolderId] = createSignal("");
  const [deleteAfter, setDeleteAfter] = createSignal(true);
  const [sending, setSending] = createSignal(false);

  const connection = createMemo<StudioConnection | null>(() =>
    tryParseConnectCode(settingsStore.studioConnectCode()),
  );

  async function loadTargets() {
    setClients(null);
    setLoadError(null);
    const conn = connection();
    if (!conn) {
      // Callers gate on a parseable code, so this is a stored code that went
      // bad afterwards - surface it instead of loading forever.
      setLoadError(t("handoff.error.invalidKey"));
      return;
    }
    try {
      const list = await fetchTargets(conn);
      setClients(list);
      // Preselect a single client; with several, force an explicit choice.
      setClientId(list.length === 1 ? list[0].id : "");
      setFolderId("");
    } catch (e) {
      setLoadError((e as Error).message ?? String(e));
    }
  }

  let prevOpen = false;
  createEffect(() => {
    if (props.open && !prevOpen) {
      setDeleteAfter(true);
      setSending(false);
      void loadTargets();
    }
    prevOpen = props.open;
  });

  const selectedClient = createMemo(() =>
    (clients() ?? []).find((c) => c.id === clientId()),
  );

  // Folder choice resets when the client changes - a folder id from client A
  // must never leak into a transfer to client B.
  createEffect(() => {
    clientId();
    setFolderId("");
  });

  const summary = createMemo(() => {
    const parts: string[] = [];
    if (props.scriptIds.length > 0) parts.push(tPlural("units.scripts", props.scriptIds.length));
    if (props.ideaIds.length > 0) parts.push(tPlural("units.ideas", props.ideaIds.length));
    return parts.join(", ");
  });

  const canSend = createMemo(
    () =>
      !sending() &&
      selectedClient() !== undefined &&
      props.scriptIds.length + props.ideaIds.length > 0,
  );

  async function onSend() {
    const conn = connection();
    const client = selectedClient();
    if (!conn || !client || !canSend()) return;
    setSending(true);
    try {
      const res = await sendHandoff(
        conn,
        { clientId: client.id, folderId: folderId() || null },
        { scriptIds: props.scriptIds, ideaIds: props.ideaIds },
        { deleteAfter: deleteAfter() },
      );
      const accepted = res.acceptedScriptIds.length + res.acceptedIdeaIds.length;
      if (accepted < res.total) {
        pushToast(t("handoff.toast.partial", { accepted, total: res.total }), "info");
      } else {
        pushToast(t("handoff.toast.success", { summary: summary() }), "ok");
      }
      props.onSent(res);
      props.onClose();
    } catch (e) {
      pushToast((e as Error).message ?? String(e), "error");
    } finally {
      setSending(false);
    }
  }

  return (
    <Modal
      open={props.open}
      onClose={() => (sending() ? null : props.onClose())}
      title={t("handoff.title")}
      footer={
        <>
          <button class="btn" onClick={() => props.onClose()} disabled={sending()}>
            {t("common.cancel")}
          </button>
          <button class="btn btn-primary" onClick={onSend} disabled={!canSend()}>
            {sending() ? t("handoff.sending") : t("handoff.send")}
          </button>
        </>
      }
    >
      <div class="handoff-form">
        <p class="handoff-intro">{t("handoff.intro")}</p>
        <p class="handoff-selection">{t("handoff.selection", { summary: summary() })}</p>

        <Show when={loadError()}>
          <p class="handoff-error">{loadError()}</p>
          <div>
            <button class="btn" onClick={() => void loadTargets()}>
              {t("handoff.retry")}
            </button>
          </div>
        </Show>

        <Show when={!loadError()}>
          <Show when={clients()} fallback={<p class="handoff-hint">{t("handoff.loading")}</p>}>
            {(list) => (
              <Show
                when={list().length > 0}
                fallback={<p class="handoff-error">{t("handoff.error.noTargets")}</p>}
              >
                <label class="handoff-label" for="handoff-client">
                  {t("handoff.client.label")}
                </label>
                <select
                  id="handoff-client"
                  class="field handoff-input"
                  value={clientId()}
                  onChange={(e) => setClientId(e.currentTarget.value)}
                >
                  <option value="" disabled>
                    {t("handoff.client.placeholder")}
                  </option>
                  <For each={list()}>{(c) => <option value={c.id}>{c.name}</option>}</For>
                </select>

                <Show when={selectedClient()}>
                  {(client) => (
                    <>
                      <label class="handoff-label" for="handoff-folder">
                        {t("handoff.folder.label")}
                      </label>
                      <select
                        id="handoff-folder"
                        class="field handoff-input"
                        value={folderId()}
                        onChange={(e) => setFolderId(e.currentTarget.value)}
                      >
                        <option value="">{t("handoff.folder.none")}</option>
                        <For each={client().folders}>
                          {(f) => <option value={f.id}>{f.name}</option>}
                        </For>
                      </select>
                    </>
                  )}
                </Show>
              </Show>
            )}
          </Show>
        </Show>

        <label class="handoff-opt">
          <span>{t("handoff.deleteAfter")}</span>
          <input
            type="checkbox"
            class="sw-t"
            checked={deleteAfter()}
            onChange={(e) => setDeleteAfter(e.currentTarget.checked)}
          />
        </label>
      </div>
    </Modal>
  );
}
