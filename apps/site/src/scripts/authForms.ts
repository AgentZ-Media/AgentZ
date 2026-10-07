// Sign in, sign up and password reset (components/AuthForms.astro), shared by
// the account page and the app sign-in page. The Better Auth client
// (authClient.ts) loads in the background, so the pages show their first view
// without waiting for it.
import type { Catalog } from "../i18n";
import type { Auth } from "./authClient";

export type { Auth };
export type Text = Catalog["account"]["runtime"];
export type AuthError = { code?: string; status?: number } | null | undefined;
export interface SessionUser { name: string; email: string; emailVerified: boolean; createdAt: Date | string }
type Tab = "signIn" | "signUp";
type Mode = Tab | "forgot" | "reset";

/**
 * Starts loading the auth client right away and returns a getter for it.
 * A failed download is retried on the next call.
 */
export function lazyAuth(baseURL: string): () => Promise<Auth> {
  const load = () => import("./authClient").then(({ createAuth }) => createAuth(baseURL));
  let client = load();
  client.catch(() => { /* Retried on the next call. */ });
  return () => client.catch(() => (client = load()));
}

// Where the cross-domain plugin of the auth client keeps the session
// (@convex-dev/better-auth, default storage prefix).
const COOKIE_KEY = "better-auth_cookie";
const SESSION_KEY = "better-auth_session_data";

/**
 * The session this device holds, read from storage without the auth client:
 * whether a session token is stored and the user of the last session answer.
 * Without a token the visitor is signed out and the server need not be asked.
 */
export function storedSession(): { token: boolean; user: SessionUser | null } {
  try {
    const cookies = JSON.parse(localStorage.getItem(COOKIE_KEY) ?? "{}") as Record<string, { value?: string; expires?: string | null } | null>;
    const now = Date.now();
    const token = Object.entries(cookies).some(([name, cookie]) =>
      name.includes("session_token") && !!cookie?.value && (!cookie.expires || new Date(cookie.expires).getTime() >= now));
    if (!token) return { token: false, user: null };
    const data = JSON.parse(localStorage.getItem(SESSION_KEY) ?? "null") as { user?: SessionUser } | null;
    return { token, user: typeof data?.user?.email === "string" ? data.user : null };
  } catch {
    // Storage blocked or unreadable: let the server decide.
    return { token: true, user: null };
  }
}

export function errorText(text: Text, error: AuthError): string {
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

export function setError(target: HTMLFormElement, message: string | null) {
  const el = target.querySelector<HTMLElement>("[data-error]")!;
  el.textContent = message ?? "";
  el.hidden = !message;
}

export function setNotice(target: HTMLElement, message: string | null) {
  target.textContent = message ?? "";
  target.hidden = !message;
}

/** Runs an auth call for a form: busy state, error text, network errors. */
export async function submit(text: Text, target: HTMLFormElement, run: () => Promise<{ error: AuthError }>): Promise<boolean> {
  const button = target.querySelector<HTMLButtonElement>("button[type=submit]")!;
  setError(target, null);
  button.disabled = true;
  target.setAttribute("aria-busy", "true");
  try {
    const { error } = await run();
    if (error) { setError(target, errorText(text, error)); return false; }
    return true;
  } catch {
    setError(target, text.errors.network);
    return false;
  } finally {
    button.disabled = false;
    target.removeAttribute("aria-busy");
  }
}

export const field = (target: HTMLFormElement, name: string) => target.elements.namedItem(name) as HTMLInputElement;
export const value = (target: HTMLFormElement, name: string) => field(target, name).value;

/** Show or hide a password without losing the caret. */
export function setupPasswordToggles(root: HTMLElement, text: Text) {
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
}

export interface AuthFormsOptions {
  root: HTMLElement;
  auth: () => Promise<Auth>;
  text: Text;
  /** Runs after a successful sign-in or sign-up. */
  onSignedIn(): Promise<void>;
  /** Address the email links return to, with ?flow=reset|verify. */
  callback(kind: "reset" | "verify"): string;
  /** Email link parameters this page was opened with. */
  flow: string | null;
  flowToken: string | null;
}

export function setupAuthForms(options: AuthFormsOptions) {
  const { root, auth, text, flow, flowToken } = options;
  const form = (name: string) => root.querySelector<HTMLFormElement>(`[data-form="${name}"]`)!;
  const notice = root.querySelector<HTMLElement>("[data-notice]")!;
  const tabs = root.querySelectorAll<HTMLButtonElement>("[role=tab]");
  const tablist = root.querySelector<HTMLElement>(".auth-tabs")!;
  // A reset link always opens the reset form, even in a signed-in browser.
  let pendingReset = flow === "reset";

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
    if (mode === "signIn" || mode === "signUp") {
      history.replaceState(null, "", (mode === "signUp" ? "#signup" : location.pathname + location.search));
    }
  }
  root.querySelectorAll<HTMLButtonElement>("[data-tab], [data-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      const mode = (button.dataset.tab ?? button.dataset.mode) as Mode;
      setNotice(notice, null);
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
    const ok = await submit(text, target, async () => (await auth()).signIn.email({ email: value(target, "email").trim(), password: value(target, "password") }));
    if (ok) { target.reset(); setNotice(notice, null); await options.onSignedIn(); }
  });
  form("signUp").addEventListener("submit", async (event) => {
    event.preventDefault();
    const target = form("signUp");
    const name = value(target, "name").trim();
    if (!name) { setError(target, text.errors.nameRequired); return; }
    const ok = await submit(text, target, async () => (await auth()).signUp.email({ name, email: value(target, "email").trim(), password: value(target, "password"), callbackURL: options.callback("verify") }));
    if (ok) { target.reset(); setNotice(notice, null); await options.onSignedIn(); }
  });

  form("forgot").addEventListener("submit", async (event) => {
    event.preventDefault();
    const target = form("forgot");
    const email = value(target, "email").trim();
    // The answer never says whether the address has an account.
    if (await submit(text, target, async () => (await auth()).requestPasswordReset({ email, redirectTo: options.callback("reset") }))) {
      setMode("signIn");
      field(form("signIn"), "email").value = email;
      setNotice(notice, text.resetSent);
    }
  });
  form("reset").addEventListener("submit", async (event) => {
    event.preventDefault();
    const target = form("reset");
    if (await submit(text, target, async () => (await auth()).resetPassword({ newPassword: value(target, "password"), token: flowToken ?? "" }))) {
      target.reset();
      setMode("signIn");
      setNotice(notice, text.resetDone);
    } else if (target.querySelector("[data-error]")!.textContent === text.errors.invalidToken) {
      // An expired or used link: offer a new one right away.
      target.reset();
      setMode("forgot");
      setError(form("forgot"), text.errors.invalidToken);
    }
  });

  setupPasswordToggles(root, text);

  return {
    form,
    setMode,
    setNotice: (message: string | null) => setNotice(notice, message),
    /** True while a reset link waits for its new password. */
    resetPending: () => pendingReset,
  };
}

export function initials(name: string): string {
  const parts = name.replace(/@.*/, "").split(/[\s._-]+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] ?? "?").slice(0, 2);
  return letters.toUpperCase();
}
