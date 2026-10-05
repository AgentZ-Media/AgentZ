// Tiny, safe Markdown subset for agent replies. Produces a plain AST that
// the chat renders as DOM nodes - model output is never injected as HTML.
// Supported: paragraphs, bullet/numbered lists, **bold**, *italic*/_italic_,
// `code`, [links](https://...), bare https URLs, line breaks. Headings are
// flattened to bold paragraphs, code fences to plain code paragraphs.

export type Inline =
  | { t: "text"; v: string }
  | { t: "bold"; c: Inline[] }
  | { t: "italic"; c: Inline[] }
  | { t: "code"; v: string }
  | { t: "link"; href: string; c: Inline[] }
  | { t: "br" };

export type Block =
  | { t: "p"; c: Inline[] }
  | { t: "ul"; items: Inline[][] }
  | { t: "ol"; start: number; items: Inline[][] }
  | { t: "code"; v: string }
  | { t: "quote"; c: Inline[] };

function safeHref(raw: string): string | null {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Inline parser: scans left to right, longest delimiters first. */
export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let buf = "";
  const flush = () => {
    if (buf) out.push({ t: "text", v: buf });
    buf = "";
  };
  let i = 0;
  while (i < src.length) {
    const rest = src.slice(i);
    if (rest.startsWith("\n")) {
      flush();
      out.push({ t: "br" });
      i += 1;
      continue;
    }
    if (rest[0] === "`") {
      const end = src.indexOf("`", i + 1);
      if (end > i + 1) {
        flush();
        out.push({ t: "code", v: src.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    if (rest.startsWith("**") || rest.startsWith("__")) {
      const delim = rest.slice(0, 2);
      const end = src.indexOf(delim, i + 2);
      if (end > i + 2) {
        flush();
        out.push({ t: "bold", c: parseInline(src.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    }
    if ((rest[0] === "*" || rest[0] === "_") && rest[1] && rest[1] !== " " && rest[1] !== rest[0]) {
      const delim = rest[0];
      const end = src.indexOf(delim, i + 1);
      // `_` inside words (snake_case) is not emphasis.
      const prev = src[i - 1] ?? " ";
      if (end > i + 1 && src[end - 1] !== " " && !(delim === "_" && /\w/.test(prev))) {
        flush();
        out.push({ t: "italic", c: parseInline(src.slice(i + 1, end)) });
        i = end + 1;
        continue;
      }
    }
    if (rest[0] === "[") {
      const m = /^\[([^\]\n]+)\]\(([^)\s]+)\)/.exec(rest);
      const href = m ? safeHref(m[2]) : null;
      if (m && href) {
        flush();
        out.push({ t: "link", href, c: parseInline(m[1]) });
        i += m[0].length;
        continue;
      }
    }
    if (rest.startsWith("https://") || rest.startsWith("http://")) {
      const m = /^https?:\/\/[^\s<>()]+[^\s<>().,;:!?"'»“”]/.exec(rest);
      const href = m ? safeHref(m[0]) : null;
      if (m && href) {
        flush();
        out.push({ t: "link", href, c: [{ t: "text", v: m[0].replace(/^https?:\/\/(www\.)?/, "") }] });
        i += m[0].length;
        continue;
      }
    }
    buf += src[i];
    i += 1;
  }
  flush();
  return out;
}

const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBERED = /^\s*(\d{1,3})[.)]\s+(.*)$/;

export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let para: string[] = [];
  const flushPara = () => {
    const text = para.join("\n").trim();
    if (text) blocks.push({ t: "p", c: parseInline(text) });
    para = [];
  };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      flushPara();
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i++]);
      i += 1;
      if (code.join("").trim()) blocks.push({ t: "code", v: code.join("\n") });
      continue;
    }
    if (!line.trim()) {
      flushPara();
      i += 1;
      continue;
    }
    const heading = /^\s*#{1,6}\s+(.*)$/.exec(line);
    if (heading) {
      flushPara();
      blocks.push({ t: "p", c: [{ t: "bold", c: parseInline(heading[1].trim()) }] });
      i += 1;
      continue;
    }
    if (/^\s*>\s?/.test(line)) {
      flushPara();
      const quote: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) quote.push(lines[i++].replace(/^\s*>\s?/, ""));
      blocks.push({ t: "quote", c: parseInline(quote.join("\n").trim()) });
      continue;
    }
    if (BULLET.test(line)) {
      flushPara();
      const items: Inline[][] = [];
      while (i < lines.length && (BULLET.test(lines[i]) || (/^\s{2,}\S/.test(lines[i]) && items.length))) {
        const m = BULLET.exec(lines[i]);
        if (m) items.push(parseInline(m[1].trim()));
        else items[items.length - 1].push({ t: "text", v: ` ${lines[i].trim()}` });
        i += 1;
      }
      blocks.push({ t: "ul", items });
      continue;
    }
    const num = NUMBERED.exec(line);
    if (num) {
      flushPara();
      const items: Inline[][] = [];
      const start = Number(num[1]);
      while (i < lines.length && (NUMBERED.test(lines[i]) || (/^\s{2,}\S/.test(lines[i]) && items.length))) {
        const m = NUMBERED.exec(lines[i]);
        if (m) items.push(parseInline(m[2].trim()));
        else items[items.length - 1].push({ t: "text", v: ` ${lines[i].trim()}` });
        i += 1;
      }
      blocks.push({ t: "ol", start, items });
      continue;
    }
    para.push(line);
    i += 1;
  }
  flushPara();
  return blocks;
}

/** Plain one-line text of a markdown string (labels, reasoning titles). */
export function markdownToPlain(src: string): string {
  const plain = (nodes: Inline[]): string => nodes.map((n) => {
    switch (n.t) {
      case "text": case "code": return n.v;
      case "br": return " ";
      default: return plain(n.c);
    }
  }).join("");
  return parseMarkdown(src).map((b) => {
    switch (b.t) {
      case "p": case "quote": return plain(b.c);
      case "code": return b.v;
      default: return b.items.map(plain).join(" ");
    }
  }).join(" ").replace(/\s+/g, " ").trim();
}
