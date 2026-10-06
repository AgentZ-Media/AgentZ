// The account page: sign in, sign up and the signed-in account view.
// Better Auth runs on the Convex deployment, a different origin than the
// website. The cross-domain plugin therefore keeps the session in
// localStorage and sends it as a header instead of a cookie.
import { createAuthClient } from "better-auth/client";
import { convexClient, crossDomainClient } from "@convex-dev/better-auth/client/plugins";
import type { Catalog } from "../i18n";

type Text = Catalog["account"]["runtime"];
type View = "loading" | "unavailable" | "auth" | "account";
type Tab = "signIn" | "signUp";
type Mode = Tab | "forgot" | "reset";
type AuthError = { code?: string; status?: number } | null | undefined;
interface User { name: string; email: string; emailVerified: boolean; createdAt: Date | string }

const root = document.querySelector<HTMLElement>("[data-account]");
if (root) start(root);

function start(root: HTMLElement) {
  const text = JSON.parse(root.querySelector("[data-account-text]")?.textContent ?? "{}") as Text;
  const locale = root.dataset.lang === "en" ? "en-US" : "de-DE";
  const baseURL = root.dataset.authUrl;
  const views = root.querySelectorAll<HTMLElement>("[data-view]");
  const form = (name: string) => root.querySelector<HTMLFormElement>(`[data-form="${name}"]`)!;
  const notice = root.querySelector<HTMLElement>("[data-notice]")!;
  const accountNotice = root.querySelector<HTMLElement>("[data-account-notice]")!;
  // Email links open this page with ?flow=reset|verify&token=… (see convex/emails.ts).
  const params = new URLSearchParams(location.search);
  const flow = params.get("flow");
  const flowToken = params.get("token");
  if (flow) history.replaceState(null, "", location.pathname);
  const callback = (kind: "reset" | "verify") => `${location.origin}${location.pathname}?flow=${kind}`;

  let current: View | null = null;
  let shown = false;
  function show(view: View) {
    if (view === current) return;
    current = view;
    views.forEach((el) => { el.hidden = el.dataset.view !== view; });
    // Move focus to the new heading only after the first screen, so a page
    // load does not jump, but screen readers follow every later switch.
    if (view !== "loading" && shown) root.querySelector<HTMLElement>(`[data-view="${view}"] h1`)?.focus();
    if (view !== "loading") shown = true;
  }

  if (!baseURL) { show("unavailable"); return; }
  const auth = createAuthClient({ baseURL, plugins: [convexClient(), crossDomainClient()] });

  // ---- Messages ----
  function errorText(error: AuthError): string {
    const e = text.errors;
    if (error?.status === 429) return e.rateLimit;
    switch (error?.code) {
      case "INVALID_EMAIL_OR_PASSWORD": return e.invalidLogin;
      case "USER_ALREADY_EXISTS":
      case "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL": return e.exists;
      case "PASSWORD_TOO_SHORT": return e.shortPassword;
      case "PASSWORD_TOO_LONG": return e.longPassword;
      case "INVALID_EMAIL": return e.invalidEmail;
      case "INVALID_PASSWORD": return e.wrongPassword;
      case "INVALID_TOKEN": return e.invalidToken;
      case "SESSION_EXPIRED":
      case "SESSION_NOT_FRESH": return e.reauth;
      default: return e.generic;
    }
  }
  function setError(target: HTMLFormElement, message: string | null) {
    const el = target.querySelector<HTMLElement>("[data-error]")!;
    el.textContent = message ?? "";
    el.hidden = !message;
  }
  function flashOk(target: HTMLFormElement, message: string) {
    const el = target.querySelector<HTMLElement>("[data-ok]");
    if (!el) return;
    el.textContent = message;
    el.classList.remove("is-on");
    void el.offsetWidth; // restart the fade when saving twice in a row
    el.classList.add("is-on");
  }
  function setNotice(message: string | null, target = notice) {
    target.textContent = message ?? "";
    target.hidden = !message;
  }

  /** Runs an auth call for a form: busy state, error text, network errors. */
  async function submit(target: HTMLFormElement, run: () => Promise<{ error: AuthError }>): Promise<boolean> {
    const button = target.querySelector<HTMLButtonElement>("button[type=submit]")!;
    setError(target, null);
    button.disabled = true;
    target.setAttribute("aria-busy", "true");
    try {
      const { error } = await run();
      if (error) { setError(target, errorText(error)); return false; }
      return true;
    } catch {
      setError(target, text.errors.network);
      return false;
    } finally {
      button.disabled = false;
      target.removeAttribute("aria-busy");
    }
  }
  const field = (target: HTMLFormElement, name: string) => target.elements.namedItem(name) as HTMLInputElement;
  const value = (target: HTMLFormElement, name: string) => field(target, name).value;

  // ---- Session ----
  // A reset link always opens the reset form, even in a signed-in browser.
  let pendingReset = flow === "reset";
  async function load() {
    if (pendingReset) { show("auth"); return; }
    show("loading");
    try {
      // After confirming an email the cached session still says "unverified".
      const { data, error } = await auth.getSession(flow === "verify" ? { query: { disableCookieCache: true } } : undefined);
      if (error && error.status !== 401) { show("unavailable"); return; }
      if (data?.user) renderAccount(data.user);
      else show("auth");
    } catch {
      show("unavailable");
    }
  }

  // ---- Signed out ----
  const tabs = root.querySelectorAll<HTMLButtonElement>("[role=tab]");
  const tablist = root.querySelector<HTMLElement>(".auth-tabs")!;
  function setMode(mode: Mode, focus = false) {
    tabs.forEach((button) => {
      const on = button.dataset.tab === mode;
      button.setAttribute("aria-selected", String(on));
      button.tabIndex = on ? 0 : -1;
      if (on && focus) button.focus();
    });
    tablist.hidden = mode === "forgot" || mode === "reset";
    if (mode !== "reset" && mode !== "forgot") pendingReset = false;
    for (const name of ["signIn", "signUp", "forgot", "reset"] as const) form(name).hidden = name !== mode;
    if (mode === "signIn" || mode === "signUp") history.replaceState(null, "", mode === "signUp" ? "#signup" : location.pathname);
  }
  root.querySelectorAll<HTMLButtonElement>("[data-tab], [data-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      const mode = (button.dataset.tab ?? button.dataset.mode) as Mode;
      setNotice(null);
      setMode(mode, button.getAttribute("role") === "tab");
      if (button.getAttribute("role") !== "tab") field(form(mode), "email").focus();
    });
  });
  // Arrow keys move between the two tabs (WAI-ARIA tabs pattern).
  tablist.addEventListener("keydown", (event) => {
    const key = (event as KeyboardEvent).key;
    if (key !== "ArrowLeft" && key !== "ArrowRight") return;
    event.preventDefault();
    const current = root.querySelector<HTMLButtonElement>("[role=tab][aria-selected=true]")!;
    setMode(current.dataset.tab === "signIn" ? "signUp" : "signIn", true);
  });
  if (location.hash === "#signup") setMode("signUp");
  if (flow === "reset" && flowToken) setMode("reset");
  else if (flow === "reset") { setMode("forgot"); setError(form("forgot"), text.errors.invalidToken); }

  form("signIn").addEventListener("submit", async (event) => {
    event.preventDefault();
    const target = form("signIn");
    const ok = await submit(target, () => auth.signIn.email({ email: value(target, "email").trim(), password: value(target, "password") }));
    if (ok) { target.reset(); setNotice(null); await load(); }
  });
  form("signUp").addEventListener("submit", async (event) => {
    event.preventDefault();
    const target = form("signUp");
    const name = value(target, "name").trim();
    if (!name) { setError(target, text.errors.nameRequired); return; }
    const ok = await submit(target, () => auth.signUp.email({ name, email: value(target, "email").trim(), password: value(target, "password"), callbackURL: callback("verify") }));
    if (ok) { target.reset(); setNotice(null); await load(); }
  });

  form("forgot").addEventListener("submit", async (event) => {
    event.preventDefault();
    const target = form("forgot");
    const email = value(target, "email").trim();
    // The answer never says whether the address has an account.
    if (await submit(target, () => auth.requestPasswordReset({ email, redirectTo: callback("reset") }))) {
      setMode("signIn");
      field(form("signIn"), "email").value = email;
      setNotice(text.resetSent);
    }
  });
  form("reset").addEventListener("submit", async (event) => {
    event.preventDefault();
    const target = form("reset");
    if (await submit(target, () => auth.resetPassword({ newPassword: value(target, "password"), token: flowToken ?? "" }))) {
      target.reset();
      setMode("signIn");
      setNotice(text.resetDone);
    } else if (target.querySelector("[data-error]")!.textContent === text.errors.invalidToken) {
      // An expired or used link: offer a new one right away.
      target.reset();
      setMode("forgot");
      setError(form("forgot"), text.errors.invalidToken);
    }
  });

  // Show or hide a password without losing the caret.
  root.querySelectorAll<HTMLButtonElement>("[data-toggle-password]").forEach((button) => {
    button.setAttribute("aria-pressed", "false");
    button.addEventListener("click", () => {
      const input = button.parentElement!.querySelector("input")!;
      const reveal = input.type === "password";
      input.type = reveal ? "text" : "password";
      button.textContent = reveal ? text.hide : text.show;
      button.setAttribute("aria-pressed", String(reveal));
    });
  });

  // ---- Signed in ----
  let user: User | null = null;
  function renderAccount(next: User) {
    user = next;
    const name = next.name.trim() || next.email;
    const set = (key: string, content: string) => { root.querySelector(`[data-user="${key}"]`)!.textContent = content; };
    set("greeting", text.greeting.replace("{name}", name.split(/\s+/)[0]));
    set("email", next.email);
    set("since", text.memberSince.replace("{date}", new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(new Date(next.createdAt))));
    set("initials", initials(name));
    field(form("profile"), "name").value = next.name;
    field(form("profile"), "email").value = next.email;
    // Hidden username fields let password managers file the password under this account.
    field(form("password"), "username").value = next.email;
    field(form("delete"), "username").value = next.email;
    root.querySelector<HTMLElement>("[data-email-verified]")!.hidden = !next.emailVerified;
    root.querySelector<HTMLElement>("[data-email-unverified]")!.hidden = next.emailVerified;
    if (location.hash) history.replaceState(null, "", location.pathname);
    show("account");
  }

  form("profile").addEventListener("submit", async (event) => {
    event.preventDefault();
    const target = form("profile");
    const name = value(target, "name").trim();
    if (!name) { setError(target, text.errors.nameRequired); return; }
    if (await submit(target, () => auth.updateUser({ name })) && user) {
      // The session response is cached, so apply the saved name locally.
      renderAccount({ ...user, name });
      flashOk(target, text.saved);
    }
  });

  form("password").addEventListener("submit", async (event) => {
    event.preventDefault();
    const target = form("password");
    const ok = await submit(target, () => auth.changePassword({
      currentPassword: value(target, "currentPassword"),
      newPassword: value(target, "newPassword"),
      revokeOtherSessions: true,
    }));
    if (ok) {
      const email = value(target, "username");
      target.reset();
      field(target, "username").value = email;
      flashOk(target, text.passwordChanged);
    }
  });

  const resend = root.querySelector<HTMLButtonElement>("[data-action=resend-verification]")!;
  resend.addEventListener("click", async () => {
    if (!user) return;
    resend.disabled = true;
    try {
      const { error } = await auth.sendVerificationEmail({ email: user.email, callbackURL: callback("verify") });
      setNotice(error ? errorText(error) : text.verifySent, accountNotice);
    } catch {
      setNotice(text.errors.network, accountNotice);
    } finally {
      resend.disabled = false;
    }
  });

  root.querySelector("[data-action=sign-out]")!.addEventListener("click", async () => {
    try { await auth.signOut(); } catch { /* The local session is cleared either way. */ }
    signedOut(text.signedOut);
  });

  const deleteOpen = root.querySelector<HTMLButtonElement>("[data-action=delete-open]")!;
  function toggleDelete(open: boolean) {
    const target = form("delete");
    target.hidden = !open;
    deleteOpen.hidden = open;
    setError(target, null);
    if (open) field(target, "password").focus();
    else { field(target, "password").value = ""; deleteOpen.focus(); }
  }
  deleteOpen.addEventListener("click", () => toggleDelete(true));
  root.querySelector("[data-action=delete-cancel]")!.addEventListener("click", () => toggleDelete(false));
  form("delete").addEventListener("submit", async (event) => {
    event.preventDefault();
    const target = form("delete");
    if (await submit(target, () => auth.deleteUser({ password: value(target, "password") }))) {
      // Clears the stored session of the deleted user.
      try { await auth.signOut(); } catch { /* Already gone on the server. */ }
      target.reset();
      target.hidden = true;
      deleteOpen.hidden = false;
      signedOut(text.deleted);
    }
  });

  function signedOut(message: string) {
    for (const name of ["profile", "password"]) setError(form(name), null);
    setMode("signIn");
    setNotice(null, accountNotice);
    setNotice(message);
    show("auth");
  }

  /** Confirms the address from an email link; true when the token was accepted. */
  async function verifyEmail(token: string): Promise<boolean> {
    try {
      const { error } = await auth.verifyEmail({ query: { token } });
      return !error;
    } catch {
      return false;
    }
  }

  root.querySelector("[data-action=retry]")!.addEventListener("click", () => void load());
  void (async () => {
    const verified = flow === "verify" && !!flowToken && await verifyEmail(flowToken);
    await load();
    if (flow !== "verify") return;
    setNotice(verified ? text.verifiedNotice : text.errors.invalidToken, current === "account" ? accountNotice : notice);
  })();
}

function initials(name: string): string {
  const parts = name.replace(/@.*/, "").split(/[\s._-]+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] ?? "?").slice(0, 2);
  return letters.toUpperCase();
}
