import { Show, createSignal } from "solid-js";
import { getPlatformAdapter } from "@agentz/kit/platform";
import { Icon } from "@agentz/kit/ui";
import { t } from "../../i18n";

// Official standalone installers: https://developers.openai.com/codex/cli#getting-started
const INSTALL_UNIX = "curl -fsSL https://chatgpt.com/codex/install.sh | sh";
const INSTALL_WINDOWS = 'powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 | iex"';
const DOCS_URL = "https://developers.openai.com/codex/cli#getting-started";

/** Shared recovery steps for onboarding, settings and the chat gate. */
export function CodexSetupInstructions(props: { install: boolean }) {
  const [windows, setWindows] = createSignal(getPlatformAdapter().platform === "windows");
  const [linkFailed, setLinkFailed] = createSignal(false);
  const openDocs = async (event: MouseEvent) => {
    event.preventDefault();
    setLinkFailed(false);
    try {
      await getPlatformAdapter().openUrl(DOCS_URL);
    } catch {
      setLinkFailed(true);
    }
  };

  return (
    <div class="ag-codex-setup">
      <Show when={props.install}>
        <div class="seg" role="group" aria-label={t("agent.install.platform")}>
          <button type="button" aria-pressed={!windows()} onClick={() => setWindows(false)}>{t("agent.install.unix")}</button>
          <button type="button" aria-pressed={windows()} onClick={() => setWindows(true)}>{t("agent.install.windows")}</button>
        </div>
        <p>{t(windows() ? "agent.install.windowsHint" : "agent.install.unixHint")}</p>
        <CopyCommand label={t("agent.install.command")} command={windows() ? INSTALL_WINDOWS : INSTALL_UNIX} />
      </Show>
      <p>{t(props.install ? "agent.install.loginHint" : "agent.install.loginOnlyHint")}</p>
      <CopyCommand label={t("agent.install.login")} command="codex login" />
      <p>{t("agent.install.retryHint")}</p>
      <a href={DOCS_URL} onClick={(event) => void openDocs(event)}>{t("agent.install.docs")}</a>
      <Show when={linkFailed()}><span role="alert">{t("agent.install.linkFailed")}</span></Show>
    </div>
  );
}

function CopyCommand(props: { label: string; command: string }) {
  const [copied, setCopied] = createSignal("");
  const [failed, setFailed] = createSignal(false);
  const copy = async () => {
    const command = props.command;
    setFailed(false);
    setCopied("");
    try {
      await navigator.clipboard.writeText(command);
      setCopied(command);
    } catch {
      setFailed(true);
    }
  };
  return (
    <div class="ag-codex-command">
      <div class="ag-codex-command-head">
        <b>{props.label}</b>
        <button type="button" class="btn" aria-label={t("agent.install.copyLabel", { command: props.label })} onClick={() => void copy()}>
          <Icon name={copied() === props.command ? "check" : "stack"} size={13} />
          {t(copied() === props.command ? "agent.install.copied" : "agent.ctx.copy")}
        </button>
      </div>
      <code>{props.command}</code>
      <span class="ag-codex-copy-status" role="status">{failed() ? t("agent.install.copyFailed") : copied() === props.command ? t("agent.install.copied") : ""}</span>
    </div>
  );
}
