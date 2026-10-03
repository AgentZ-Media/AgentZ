import { describe, expect, it } from "vitest";
import { safeSnippet } from "../snippet";

describe("palette search snippets", () => {
  it("permits only plain search marks and escapes arbitrary content", () => {
    expect(safeSnippet('<mark>match</mark> <img src=x onerror="alert(1)"> & \'text\''))
      .toBe('<mark>match</mark> &lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &#39;text&#39;');
    expect(safeSnippet('<mark onclick="alert(1)">match</mark>'))
      .toBe('&lt;mark onclick=&quot;alert(1)&quot;&gt;match</mark>');
  });

  it("keeps the word before the first match visible in a one-line preview", () => {
    expect(safeSnippet('Long introductory text before <mark>match</mark> after'))
      .toBe('… before <mark>match</mark> after');
    expect(safeSnippet('Before <mark>match</mark>')).toBe('Before <mark>match</mark>');
  });
});
