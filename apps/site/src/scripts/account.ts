// The account page: sign in, sign up and the signed-in account view.
// Forms and the auth client are shared with the app sign-in page (authForms.ts).
import {
  createAuth, errorText, field, initials, setError, setNotice, setupAuthForms, submit, value, type Text,
} from "./authForms";

type View = "loading" | "unavailable" | "auth" | "account";
interface User { name: string; email: string; emailVerified: boolean; createdAt: Date | string }

const root = document.querySelector<HTMLElement>("[data-account]");
if (root) start(root);

function start(root: HTMLElement) {
  const text = JSON.parse(root.querySelector("[data-account-text]")?.textContent ?? "{}") as Text;
  const locale = root.dataset.lang === "en" ? "en-US" : "de-DE";
  const baseURL = root.dataset.authUrl;
  const views = root.querySelectorAll<HTMLElement>("[data-view]");
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
  const auth = createAuth(baseURL);
  const forms = setupAuthForms({ root, auth, text, flow, flowToken, callback, onSignedIn: () => load() });
  const form = forms.form;

  function flashOk(target: HTMLFormElement, message: string) {
    const el = target.querySelector<HTMLElement>("[data-ok]");
    if (!el) return;
    el.textContent = message;
    el.classList.remove("is-on");
    void el.offsetWidth; // restart the fade when saving twice in a row
    el.classList.add("is-on");
  }

  // ---- Session ----
  async function load() {
    if (forms.resetPending()) { show("auth"); return; }
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
    if (await submit(text, target, () => auth.updateUser({ name })) && user) {
      // The session response is cached, so apply the saved name locally.
      renderAccount({ ...user, name });
      flashOk(target, text.saved);
    }
  });

  form("password").addEventListener("submit", async (event) => {
    event.preventDefault();
    const target = form("password");
    const ok = await submit(text, target, () => auth.changePassword({
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
      setNotice(accountNotice, error ? errorText(text, error) : text.verifySent);
    } catch {
      setNotice(accountNotice, text.errors.network);
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
    if (await submit(text, target, () => auth.deleteUser({ password: value(target, "password") }))) {
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
    forms.setMode("signIn");
    setNotice(accountNotice, null);
    forms.setNotice(message);
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
    const message = verified ? text.verifiedNotice : text.errors.invalidToken;
    if (current === "account") setNotice(accountNotice, message);
    else forms.setNotice(message);
  })();
}
