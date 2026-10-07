// App sign-in page: sign in on the website, then hand a one-time code to the
// desktop app through its URL scheme. The app proves with its PKCE verifier
// that it started this sign-in (convex/appLink.ts), so the code alone is
// worthless to anyone else.
import type { Catalog } from "../i18n";
import { createAuth, initials, setNotice, setupAuthForms, type Text } from "./authForms";

type View = "loading" | "unavailable" | "invalid" | "auth" | "connect" | "done";
type PageText = Catalog["appSignIn"];
interface KnownApp { id: string; name: string; scheme: string; icon: string }
interface Runtime { account: Text; page: PageText; apps: KnownApp[] }

const root = document.querySelector<HTMLElement>("[data-app-signin]");
if (root) start(root);

function start(root: HTMLElement) {
  const { account: text, page, apps } = JSON.parse(root.querySelector("[data-app-signin-text]")?.textContent ?? "{}") as Runtime;
  const baseURL = root.dataset.authUrl;
  const views = root.querySelectorAll<HTMLElement>("[data-view]");
  const params = new URLSearchParams(location.search);
  const app = apps.find((entry) => entry.id === params.get("app"));
  const challenge = params.get("challenge") ?? "";

  // Keep app and challenge when switching the language.
  root.querySelectorAll<HTMLAnchorElement>("[data-keep-query]").forEach((link) => { link.search = location.search; });

  let current: View | null = null;
  let shown = false;
  function show(view: View) {
    if (view === current) return;
    current = view;
    views.forEach((el) => { el.hidden = el.dataset.view !== view; });
    if (view !== "loading" && shown) root.querySelector<HTMLElement>(`[data-view="${view}"] h1`)?.focus();
    if (view !== "loading") shown = true;
  }

  if (!app || !/^[A-Za-z0-9_-]{43}$/.test(challenge)) { show("invalid"); return; }
  if (!baseURL) { show("unavailable"); return; }

  const fill = (template: string) => template.replace("{app}", app.name);
  root.querySelectorAll<HTMLElement>("[data-app-text]").forEach((el) => {
    el.textContent = fill(page[el.dataset.appText as keyof PageText] as string);
  });
  root.querySelectorAll<HTMLImageElement>("[data-app-icon]").forEach((img) => { img.src = app.icon; });

  const auth = createAuth(baseURL);
  // Email links (reset, verification) finish on the account page; signing in
  // here does not wait for them.
  const accountPath = root.dataset.lang === "en" ? "/en/account/" : "/konto/";
  const callback = (kind: "reset" | "verify") => `${location.origin}${accountPath}?flow=${kind}`;
  setupAuthForms({ root, auth, text, flow: null, flowToken: null, callback, onSignedIn: () => load() });

  const connectError = root.querySelector<HTMLElement>("[data-connect-error]")!;
  async function load() {
    show("loading");
    try {
      const { data, error } = await auth.getSession();
      if (error && error.status !== 401) { show("unavailable"); return; }
      if (!data?.user) { show("auth"); return; }
      const name = data.user.name.trim() || data.user.email;
      root.querySelector('[data-user="initials"]')!.textContent = initials(name);
      root.querySelector('[data-user="title"]')!.textContent = page.connectTitle.replace("{name}", name);
      root.querySelector('[data-user="email"]')!.textContent = data.user.email;
      setNotice(connectError, null);
      show("connect");
    } catch {
      show("unavailable");
    }
  }

  let code = "";
  const openApp = () => { location.href = `${app.scheme}://auth?code=${encodeURIComponent(code)}`; };

  const openButton = root.querySelector<HTMLButtonElement>("[data-action=open]")!;
  openButton.addEventListener("click", async () => {
    openButton.disabled = true;
    setNotice(connectError, null);
    try {
      const response = await fetch(`${baseURL}/app-link/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Better-Auth-Cookie": auth.getCookie() },
        body: JSON.stringify({ app: app.id, challenge }),
      });
      if (response.status === 401) { show("auth"); return; }
      const body = await response.json() as { code?: string };
      if (!response.ok || !body.code) throw new Error("approve failed");
      code = body.code;
      root.querySelector("[data-code]")!.textContent = code;
      show("done");
      openApp();
      // The code expires on the server after five minutes; say so here too.
      window.setTimeout(() => {
        const fallback = root.querySelector<HTMLElement>(".as-fallback")!;
        fallback.querySelector("p")!.textContent = page.expired;
        fallback.querySelector(".as-code")?.remove();
        root.querySelector<HTMLElement>("[data-action=reopen]")!.hidden = true;
      }, 5 * 60 * 1000);
    } catch {
      setNotice(connectError, page.approveFailed);
    } finally {
      openButton.disabled = false;
    }
  });
  root.querySelector("[data-action=reopen]")!.addEventListener("click", openApp);

  const copyButton = root.querySelector<HTMLButtonElement>("[data-action=copy]")!;
  copyButton.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(code);
      copyButton.textContent = page.copied;
      window.setTimeout(() => { copyButton.textContent = page.copy; }, 1800);
    } catch {
      // Clipboard denied: the code stays selectable.
    }
  });

  root.querySelector("[data-action=other]")!.addEventListener("click", async () => {
    try { await auth.signOut(); } catch { /* The local session is cleared either way. */ }
    show("auth");
  });
  root.querySelector("[data-action=retry]")!.addEventListener("click", () => void load());
  void load();
}
