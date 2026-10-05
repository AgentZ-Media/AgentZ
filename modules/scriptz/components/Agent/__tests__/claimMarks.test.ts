import { describe, expect, it } from "vitest";
import { findQuoteRange } from "../ClaimMarks";

function block(html: string): HTMLElement {
  const el = document.createElement("div");
  el.innerHTML = html;
  document.body.appendChild(el);
  return el;
}

describe("findQuoteRange", () => {
  it("finds a quote across inline formatting, ignoring case and extra spaces", () => {
    const el = block('<span>Laut <b>Arbeitszeitgesetz</b>  darfst du nur 8 Stunden arbeiten.</span>');
    const range = findQuoteRange(el, "„arbeitszeitgesetz darfst du“");
    expect(range?.toString()).toBe("Arbeitszeitgesetz  darfst du");
  });

  it("returns null when the quote is not in the block or too short", () => {
    const el = block("<span>Nichts davon.</span>");
    expect(findQuoteRange(el, "Überstunden")).toBeNull();
    expect(findQuoteRange(el, "ab")).toBeNull();
  });
});
