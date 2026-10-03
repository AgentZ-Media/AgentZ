import { Show, createMemo, createSignal } from "solid-js";
import { settingsStore } from "../../../stores/settings";
import { pushToast } from "../../../stores/toasts";
import { t, tPlural } from "../../../i18n";
import {
  ConnectCodeError,
  connectionHost,
  fetchTargets,
  parseConnectCode,
  tryParseConnectCode,
  type StudioConnection,
} from "../../../lib/handoff";
import { Row, SectionHead } from "./parts";

/** Connection to a ScriptZ Studio. The user pastes the permanent connect
 *  code generated in Studio's admin UI; while no code is stored, the app
 *  shows no Studio surface anywhere else (most users don't have a Studio). */
export function SettingsStudio(props: { onClose(): void }) {
  const [draft, setDraft] = createSignal("");
  const [draftError, setDraftError] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [testResult, setTestResult] = createSignal<string | null>(null);

  // A stored-but-broken code should never happen (validated before saving),
  // but render it as "not connected" instead of crashing.
  const connection = createMemo<StudioConnection | null>(() =>
    tryParseConnectCode(settingsStore.studioConnectCode()),
  );

  async function connect() {
    const raw = draft().trim();
    if (!raw) return;
    let conn: StudioConnection;
    try {
      conn = parseConnectCode(raw);
    } catch (e) {
      setDraftError(e instanceof ConnectCodeError ? e.message : String(e));
      return;
    }
    setDraftError(null);
    setBusy(true);
    try {
      // Verify against Studio before persisting, so a revoked or mistyped
      // key fails here and not silently on the first transfer.
      const clients = await fetchTargets(conn);
      await settingsStore.setStudioConnectCode(raw);
      setDraft("");
      setTestResult(tPlural("settings.studio.test.ok", clients.length));
      pushToast(t("settings.studio.toast.connected"), "ok");
    } catch (e) {
      setDraftError((e as Error)?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    const conn = connection();
    if (!conn) return;
    setBusy(true);
    setTestResult(null);
    try {
      const clients = await fetchTargets(conn);
      setTestResult(tPlural("settings.studio.test.ok", clients.length));
    } catch (e) {
      setTestResult((e as Error)?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    await settingsStore.setStudioConnectCode("");
    setTestResult(null);
    setDraft("");
    setDraftError(null);
    pushToast(t("settings.studio.toast.disconnected"), "ok");
  }

  return (
    <>
      <SectionHead title={t("prefs.studio.title")} sub={t("settings.studio.sub")} onClose={props.onClose} />
      <Show
        when={connection()}
        fallback={
          <div class="set-block">
            <Row label={t("settings.studio.code.label")} help={t("settings.studio.code.help")} />
            <div class="set-inline">
              <input
                class="field set-code"
                value={draft()}
                aria-label={t("settings.studio.code.label")}
                placeholder={t("settings.studio.code.placeholder")}
                spellcheck={false}
                autocomplete="off"
                onInput={(e) => {
                  setDraft(e.currentTarget.value);
                  setDraftError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void connect();
                  }
                }}
              />
              <button class="btn primary" disabled={busy() || !draft().trim()} onClick={() => void connect()}>
                {busy() ? t("settings.studio.connecting") : t("settings.studio.connect")}
              </button>
            </div>
            <Show when={draftError()}>
              <p class="set-error" role="alert">
                {draftError()}
              </p>
            </Show>
          </div>
        }
      >
        {(conn) => (
          <div class="set-block">
            <Row
              label={t("settings.studio.connected", { host: connectionHost(conn()) })}
              help={testResult() ?? undefined}
            >
              <div class="set-actions">
                <button class="btn" disabled={busy()} onClick={() => void test()}>
                  {t("settings.studio.test")}
                </button>
                <button class="btn ghost" disabled={busy()} onClick={() => void disconnect()}>
                  {t("settings.studio.disconnect")}
                </button>
              </div>
            </Row>
          </div>
        )}
      </Show>
    </>
  );
}
