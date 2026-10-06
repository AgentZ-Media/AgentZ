import { Resend } from "@convex-dev/resend";
import type { RunMutationCtx } from "@convex-dev/better-auth/utils";
import { components } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";

// Account emails (password reset, address verification) sent through Resend.
// The component queues, retries and deduplicates; RESEND_API_KEY comes from
// the deployment environment.
export const resend = new Resend(components.resend, { testMode: false });

const FROM = "AgentZ Suite <info@agentz-suite.com>";
// Absolute URLs of the live website: mail clients load images and links from there.
const SITE = "https://www.agentz-suite.com";
const LOGO = `${SITE}/img/suite.png`;

type Kind = "reset" | "verify";
type Language = "de" | "en";

const copy = {
  de: {
    reset: {
      subject: "Neues Passwort für dein AgentZ-Konto",
      title: "Neues Passwort festlegen",
      text: "du hast ein neues Passwort für dein AgentZ-Konto angefordert. Der Link gilt eine Stunde.",
      button: "Passwort zurücksetzen",
      ignore: "Du hast das nicht angefordert? Dann ignoriere diese E-Mail. Dein Passwort bleibt unverändert.",
    },
    verify: {
      subject: "Bestätige deine E-Mail-Adresse",
      title: "Willkommen in der AgentZ Suite",
      text: "bestätige kurz, dass diese Adresse dir gehört. Der Link gilt 24 Stunden.",
      button: "E-Mail bestätigen",
      ignore: "Du hast kein Konto angelegt? Dann ignoriere diese E-Mail.",
    },
    hello: "Hallo",
    fallback: "Falls der Knopf nicht funktioniert, öffne diesen Link:",
    footer: "AgentZ Media · Ziegenmarkt 6 · 19055 Schwerin",
    legal: "Impressum",
    privacy: "Datenschutz",
  },
  en: {
    reset: {
      subject: "A new password for your AgentZ account",
      title: "Choose a new password",
      text: "you asked for a new password for your AgentZ account. The link is valid for one hour.",
      button: "Reset password",
      ignore: "Didn't ask for this? Just ignore this email. Your password stays the same.",
    },
    verify: {
      subject: "Confirm your email address",
      title: "Welcome to the AgentZ Suite",
      text: "please confirm that this address belongs to you. The link is valid for 24 hours.",
      button: "Confirm email",
      ignore: "Didn't create an account? Just ignore this email.",
    },
    hello: "Hi",
    fallback: "If the button doesn't work, open this link:",
    footer: "AgentZ Media · Ziegenmarkt 6 · 19055 Schwerin · Germany",
    legal: "Legal notice (German)",
    privacy: "Privacy (German)",
  },
};

// Email clients cannot read CSS variables, so the mail carries the design
// token values directly (light theme: --bg, --surface, --fg, --muted,
// --line, --accent, --accent-fg).
const color = { bg: "#f3f4f6", surface: "#ffffff", fg: "#14161b", muted: "#5d6170", line: "#e3e5e9", accent: "#ffe14d", accentFg: "#14161b" };

const escape = (value: string) =>
  value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

/** Better Auth's link carries the page that started the flow; English pages live under /en/. */
function languageOf(url: string): Language {
  return decodeURIComponent(url).includes("/en/") ? "en" : "de";
}

/**
 * Email links open the account page on the website (SITE_URL), not the auth
 * API on the Convex origin. The page hands the token to the API itself.
 */
function accountLink(kind: Kind, token: string, lang: Language): string {
  const link = new URL(lang === "en" ? "/en/account/" : "/konto/", process.env.SITE_URL);
  link.searchParams.set("flow", kind);
  link.searchParams.set("token", token);
  return link.toString();
}

export async function sendAccountEmail(
  ctx: RunMutationCtx<DataModel>,
  kind: Kind,
  args: { to: string; name: string; url: string; token: string },
) {
  const lang = languageOf(args.url);
  const url = accountLink(kind, args.token, lang);
  const t = copy[lang];
  const k = t[kind];
  const name = args.name.trim().split(/\s+/)[0] ?? "";
  const greeting = name ? `${t.hello} ${name},` : `${t.hello},`;
  const font = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
  const html = `<!doctype html>
<html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escape(k.subject)}</title></head>
<body style="margin:0;padding:0;background:${color.bg};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${color.bg};padding:32px 12px;font-family:${font};">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">
<tr><td style="padding:0 0 14px;">
<table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="vertical-align:middle;"><img src="${LOGO}" width="44" height="44" alt="" style="display:block;width:44px;height:44px;border:0;"></td>
<td style="vertical-align:middle;padding-left:4px;font-size:16px;font-weight:700;color:${color.fg};">AgentZ <span style="font-weight:400;color:${color.muted};">Suite</span></td>
</tr></table>
</td></tr>
<tr><td style="background:${color.surface};border:1px solid ${color.line};border-radius:16px;padding:32px;">
<h1 style="margin:0 0 16px;font-size:24px;line-height:1.2;color:${color.fg};">${escape(k.title)}</h1>
<p style="margin:0 0 24px;font-size:16px;line-height:1.55;color:${color.fg};">${escape(greeting)} ${escape(k.text)}</p>
<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:10px;background:${color.accent};">
<a href="${escape(url)}" style="display:inline-block;padding:13px 22px;font-size:15px;font-weight:700;color:${color.accentFg};text-decoration:none;">${escape(k.button)}</a>
</td></tr></table>
<p style="margin:24px 0 0;font-size:14px;line-height:1.5;color:${color.muted};">${escape(k.ignore)}</p>
<p style="margin:16px 0 0;font-size:12px;line-height:1.5;color:${color.muted};">${escape(t.fallback)}<br><a href="${escape(url)}" style="color:${color.muted};word-break:break-all;">${escape(url)}</a></p>
</td></tr>
<tr><td style="padding:16px 8px 0;font-size:12px;line-height:1.6;color:${color.muted};">${escape(t.footer)}<br>
<a href="${SITE}/impressum/" style="color:${color.muted};">${escape(t.legal)}</a> &nbsp;·&nbsp; <a href="${SITE}/datenschutz/" style="color:${color.muted};">${escape(t.privacy)}</a></td></tr>
</table>
</td></tr>
</table>
</body></html>`;
  const text = `${greeting} ${k.text}\n\n${k.button}: ${url}\n\n${k.ignore}\n\n${t.footer}\n${t.legal}: ${SITE}/impressum/\n${t.privacy}: ${SITE}/datenschutz/`;
  await resend.sendEmail(ctx, { from: FROM, to: args.to, subject: k.subject, html, text });
}
