import { Show, createSignal, onCleanup } from "solid-js";
import { Portal } from "solid-js/web";
import { t } from "../i18n";
import { shellUi } from "../stores/ui";
import { Icon, dismissOnDialog } from "../ui";
import { account } from "./account";
import { Avatar } from "./Avatar";
import { syncStatus } from "./status";

/**
 * Account entry for the sidebar footer: avatar, name and sync state. A click
 * opens a small menu (sign in, sync now, settings, sign out). Renders nothing
 * when the host has no cloud backend.
 */
export function AccountChip() {
  const [open, setOpen] = createSignal(false);
  const [pos, setPos] = createSignal({ left: 0, bottom: 0 });
  let trigger: HTMLButtonElement | undefined;
  let menu: HTMLDivElement | undefined;

  const close = (focus = true) => {
    setOpen(false);
    if (focus) trigger?.focus();
  };
  const toggle = () => {
    if (open()) { close(); return; }
    const rect = trigger!.getBoundingClientRect();
    setPos({ left: rect.left, bottom: window.innerHeight - rect.top + 8 });
    setOpen(true);
    requestAnimationFrame(() => menu?.querySelector<HTMLElement>(".menu-it")?.focus());
  };
  const run = (action: () => void) => () => { close(false); action(); };

  const onDocDown = (event: MouseEvent) => {
    if (!open()) return;
    const target = event.target as Node;
    if (menu?.contains(target) || trigger?.contains(target)) return;
    close(false);
  };
  const onKey = (event: KeyboardEvent) => {
    if (!open()) return;
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); return; }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const items = Array.from(menu?.querySelectorAll<HTMLElement>(".menu-it") ?? []);
    const index = items.indexOf(document.activeElement as HTMLElement);
    const next = items[(index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length];
    event.preventDefault();
    next?.focus();
  };
  document.addEventListener("mousedown", onDocDown, true);
  document.addEventListener("keydown", onKey, true);
  onCleanup(() => {
    document.removeEventListener("mousedown", onDocDown, true);
    document.removeEventListener("keydown", onKey, true);
  });
  dismissOnDialog({
    dialogOpen: () => shellUi.anyDialogOpen() || account.dialog() !== null,
    open,
    inside: (node) => !!menu?.contains(node) || !!trigger?.contains(node),
    dismiss: () => setOpen(false),
  });

  const status = () => syncStatus();
  const name = () => account.user()?.name?.trim() || account.user()?.email || "";

  return (
    <Show when={account.enabled()}>
      <button ref={trigger} type="button" class="acc-chip" classList={{ "is-open": open() }}
        aria-haspopup="menu" aria-expanded={open()} aria-label={t("account.menu.aria")}
        title={account.signedIn() ? `${name()} · ${status().text}` : t("account.signInHint")}
        onClick={toggle}>
        <span class="acc-chip-av">
          <Avatar name={account.signedIn() ? name() : undefined} seed={account.user()?.id} size={26} />
          <Show when={account.signedIn() && account.syncAvailable()}>
            <span class={`acc-dot is-${status().tone}`} aria-hidden="true" />
          </Show>
        </span>
        <span class="acc-chip-t">
          <b>{account.signedIn() ? name() : t("account.local")}</b>
          <small>{account.signedIn() ? status().text : t("account.chipHint")}</small>
        </span>
      </button>
      <Show when={open()}>
        <Portal>
          <div ref={menu} class="menu acc-menu" role="menu" aria-label={t("account.menu.aria")}
            style={{ left: `${pos().left}px`, bottom: `${pos().bottom}px` }}>
            <Show when={account.signedIn()} fallback={<>
              <p class="acc-menu-note">{t("account.menu.signedOut")}</p>
              <button type="button" role="menuitem" class="menu-it" onClick={run(() => void account.signIn())}>
                <Icon name="cloud" /><span class="lbl">{t("account.signIn")}</span>
              </button>
              <div class="menu-sep" />
              <button type="button" role="menuitem" class="menu-it" onClick={run(() => shellUi.openSettings("account"))}>
                <Icon name="gear" /><span class="lbl">{t("account.menu.settings")}</span>
              </button>
            </>}>
              <div class="acc-menu-head">
                <Avatar name={name()} seed={account.user()?.id} size={34} />
                <span><b>{name()}</b><small>{account.user()?.email}</small></span>
              </div>
              <p class={`acc-menu-status is-${status().tone}`}>{status().text}</p>
              <div class="menu-sep" />
              <Show when={account.keyPhase() === "enter" || account.keyPhase() === "create"}>
                <button type="button" role="menuitem" class="menu-it" onClick={run(() => account.openKeyDialog())}>
                  <Icon name="shield" /><span class="lbl">{t("account.menu.unlock")}</span>
                </button>
              </Show>
              <Show when={account.keyPhase() === "ready"}>
                <button type="button" role="menuitem" class="menu-it" onClick={run(() => account.syncNow())}>
                  <Icon name="refresh" /><span class="lbl">{t("account.menu.syncNow")}</span>
                </button>
              </Show>
              <button type="button" role="menuitem" class="menu-it" onClick={run(() => shellUi.openSettings("account"))}>
                <Icon name="gear" /><span class="lbl">{t("account.menu.settings")}</span>
              </button>
              <div class="menu-sep" />
              <button type="button" role="menuitem" class="menu-it" onClick={run(() => void account.signOut())}>
                <Icon name="x" /><span class="lbl">{t("account.menu.signOut")}</span>
              </button>
            </Show>
          </div>
        </Portal>
      </Show>
    </Show>
  );
}
