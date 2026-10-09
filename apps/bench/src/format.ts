// Escaping and number formats in the page language.

import { lang } from "./i18n";

export function esc(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

const formats = new Map<string, Intl.NumberFormat>();
function number(value: number, digits: number): string {
  const key = `${lang()}|${digits}`;
  let format = formats.get(key);
  if (!format) {
    format = new Intl.NumberFormat(lang(), { minimumFractionDigits: digits, maximumFractionDigits: digits });
    formats.set(key, format);
  }
  return format.format(value);
}

/** US cents, as OpenRouter bills in US dollars. */
export const cents = (value: number) => `${number(value, value < 10 ? 2 : 1)} ct`;
export const dollars = (value: number) => `$${number(value, value < 100 ? 2 : 0)}`;
export const seconds = (ms: number) => `${number(ms / 1000, 1)} s`;
export const score = (value: number) => number(value, 1);
export const integer = (value: number) => number(Math.round(value), 0);
export const percent = (ratio: number) => `${number(ratio * 100, 0)} %`;
export const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}`;

export function date(iso: string): string {
  return new Date(iso).toLocaleString(lang(), { dateStyle: "medium", timeStyle: "short" });
}

/** Chat text: escaped, **bold** and line breaks only. */
export function chatText(text: string): string {
  return esc(text).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/\n{2,}/g, "</p><p>").replace(/\n/g, "<br>");
}
