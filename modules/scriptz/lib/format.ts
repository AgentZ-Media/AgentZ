import { tPlural } from "../i18n";

/** Product-specific printed page unit. */
export function formatPageCount(n: number): string {
  return tPlural("units.pages", n);
}
