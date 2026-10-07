// The live ScriptZ rebuild: an editable script with ScriptZ's smart Enter,
// ⌘1–4 block types, live inspector and timeline, Ida's suggestions, a board
// with drag and drop, quick capture and the export dialog. Nothing leaves
// the page; every change lives only until reload.
import type { DemoBlock } from "../i18n";
import { demoStats, formatTime } from "./demo-model";
import { castColors, timeline } from "./live-model";

type Kind = DemoBlock[0];
const ENTER_NEXT: Record<Kind, Kind> = { a: "c", c: "d", d: "c", p: "d" };
const ENTER_EMPTY: Record<Kind, Kind> = { a: "c", c: "a", d: "c", p: "d" };
const KEY_KIND: Record<string, Kind> = { "1": "a", "2": "c", "3": "d", "4": "p" };
const hue = (c: number) => (c ? `var(--char-${((c - 1) % 5) + 1})` : "var(--line-strong)");
const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

export interface LiveApi {
  setStep: (step: number) => void;
  /** Current visual scale of the window, for drag animations. */
  scale: () => number;
}

export function initLive(root: HTMLElement, reducedMotion: boolean, getScale: () => number): LiveApi {
  const $ = <T extends Element = HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
  const $$ = <T extends Element = HTMLElement>(selector: string) => [...root.querySelectorAll<T>(selector)];
  const data = root.dataset;
  const script = JSON.parse(data.script ?? "[]") as DemoBlock[];
  const chips = JSON.parse(data.chips ?? "{}") as Record<Kind, string>;
  const options = JSON.parse(data.options ?? "[]") as string[];
  const pct = data.pct ?? "%";
  const tpl = (name: string) => root.querySelector<HTMLTemplateElement>(`template[data-${name}]`)?.innerHTML.trim() ?? "";
  const paper = $("[data-paper]");
  const desk = $("[data-desk]");
  const keys = $("[data-keys]");
  const toast = $("[data-toast]");
  let step = -1;
  let edited = false;
  let typing = false;
  let typed = false;

  // ---------------- Blocks ----------------
  const blocks = () => [...paper.children].filter((el): el is HTMLElement => el instanceof HTMLElement && el.classList.contains("blk"));
  const kindOf = (el: HTMLElement) => (el.dataset.kind ?? "a") as Kind;
  const read = (): DemoBlock[] => blocks().map((el) => {
    const kind = kindOf(el);
    const text = (el.textContent ?? "").replace(/ /g, " ");
    return [kind, kind === "c" ? text.trim().toUpperCase() : text];
  });

  function makeBlock(kind: Kind, text = ""): HTMLElement {
    const el = document.createElement("p");
    el.className = `blk blk-${kind}`;
    el.dataset.kind = kind;
    if (text) el.textContent = text; else el.append(document.createElement("br"));
    return el;
  }
  function setKind(el: HTMLElement, kind: Kind) {
    el.dataset.kind = kind;
    el.className = `blk blk-${kind}`;
  }

  // ---------------- Caret ----------------
  function caret(): { el: HTMLElement; offset: number } | null {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || !sel.isCollapsed) return null;
    const node = sel.focusNode;
    if (!node || !paper.contains(node)) return null;
    const el = (node instanceof HTMLElement ? node : node.parentElement)?.closest<HTMLElement>(".blk");
    if (!el || el.parentElement !== paper) return null;
    const range = document.createRange();
    range.setStart(el, 0);
    range.setEnd(node, sel.focusOffset);
    return { el, offset: range.toString().length };
  }
  function place(el: HTMLElement, offset: number) {
    const sel = window.getSelection();
    if (!sel) return;
    const range = document.createRange();
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let left = offset;
    let node = walker.nextNode() as Text | null;
    while (node) {
      if (left <= node.length) { range.setStart(node, left); break; }
      left -= node.length;
      node = walker.nextNode() as Text | null;
    }
    if (!node) range.setStart(el, el.childNodes.length && el.lastChild?.nodeName !== "BR" ? el.childNodes.length : 0);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
    follow(el);
  }
  function follow(el: HTMLElement) {
    const top = el.offsetTop - 40;
    const bottom = el.offsetTop + el.offsetHeight + 90;
    if (bottom > desk.scrollTop + desk.clientHeight) desk.scrollTo({ top: bottom - desk.clientHeight, behavior: reducedMotion ? "auto" : "smooth" });
    else if (top < desk.scrollTop) desk.scrollTo({ top, behavior: reducedMotion ? "auto" : "smooth" });
  }

  // ---------------- Smart Enter, block types, merging ----------------
  function otherSpeaker(before: HTMLElement): string {
    const names: string[] = [];
    let el: Element | null = before;
    while (el) {
      if (el instanceof HTMLElement && kindOf(el) === "c") {
        const name = (el.textContent ?? "").trim().toUpperCase();
        if (name && !names.includes(name)) names.push(name);
        if (names.length === 2) break;
      }
      el = el.previousElementSibling;
    }
    return names[1] ?? "";
  }

  function enter() {
    const at = caret();
    if (!at) return;
    const { el, offset } = at;
    const kind = kindOf(el);
    const text = el.textContent ?? "";
    if (!text.trim()) {
      // An empty Character with a predicted speaker accepts the prediction.
      const ghost = kind === "c" ? otherSpeaker(el) : "";
      if (ghost) {
        el.textContent = ghost;
        const next = makeBlock("d");
        el.after(next);
        place(next, 0);
      } else {
        setKind(el, ENTER_EMPTY[kind]);
        place(el, 0);
      }
      changed();
      return;
    }
    const after = text.slice(offset);
    el.textContent = text.slice(0, offset) || "";
    if (!el.textContent) el.append(document.createElement("br"));
    const next = makeBlock(ENTER_NEXT[kind], after);
    el.after(next);
    place(next, 0);
    changed();
  }

  function backspace(event: KeyboardEvent) {
    const at = caret();
    if (!at || at.offset !== 0) return;
    const prev = at.el.previousElementSibling as HTMLElement | null;
    if (!prev) return;
    event.preventDefault();
    const text = at.el.textContent ?? "";
    const join = (prev.textContent ?? "").length;
    if (text) prev.textContent = (prev.textContent ?? "") + text;
    at.el.remove();
    place(prev, join);
    changed();
  }

  paper.addEventListener("keydown", (event) => {
    if (typing) { event.preventDefault(); stopTyping(); return; }
    if (event.isComposing) return;
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); enter(); return; }
    if (event.key === "Backspace") { backspace(event); return; }
    if ((event.metaKey || event.ctrlKey) && KEY_KIND[event.key]) {
      event.preventDefault();
      const at = caret();
      if (at) { setKind(at.el, KEY_KIND[event.key]!); place(at.el, at.offset); changed(); }
    }
  });
  paper.addEventListener("beforeinput", (event) => {
    if (event.inputType === "insertParagraph") { event.preventDefault(); enter(); }
  });
  paper.addEventListener("paste", (event) => {
    event.preventDefault();
    const text = (event.clipboardData?.getData("text/plain") ?? "").replace(/\s*\n\s*/g, " ");
    document.execCommand("insertText", false, text);
  });
  paper.addEventListener("input", () => {
    // Keep the structure ScriptZ-shaped: only block paragraphs at the top.
    for (const node of [...paper.childNodes]) {
      if (node instanceof HTMLElement && node.classList.contains("blk")) continue;
      if (node.textContent?.trim()) {
        const el = makeBlock("a", node.textContent);
        node.replaceWith(el);
        place(el, el.textContent?.length ?? 0);
      } else node.remove();
    }
    if (!blocks().length) { const el = makeBlock("a"); paper.append(el); place(el, 0); }
    changed();
  });
  paper.addEventListener("pointerdown", () => { stopTyping(); keys.classList.remove("is-on"); });
  document.addEventListener("selectionchange", () => {
    const at = caret();
    for (const el of blocks()) {
      const on = el === at?.el;
      el.classList.toggle("is-active", on);
      if (on) el.dataset.chip = chips[kindOf(el)];
    }
  });

  // ---------------- Derived views ----------------
  let pending = 0;
  function changed() {
    edited = true;
    if (!pending) pending = requestAnimationFrame(() => { pending = 0; refresh(); });
  }

  function refresh() {
    const list = read();
    const stats = demoStats(list);
    const colors = castColors(list);
    const time = formatTime(stats.seconds);
    $$("[data-time]").forEach((el) => { el.textContent = time; });
    $("[data-words]").textContent = String(stats.words);
    $("[data-dialog]").textContent = String(stats.dialogWords);
    $("[data-switches]").textContent = String(stats.switches);
    const card = root.querySelector("[data-card-time]");
    if (card) card.textContent = time;

    // Character colours and the predicted next speaker.
    blocks().forEach((el) => {
      const empty = !(el.textContent ?? "").trim();
      el.classList.toggle("is-empty", empty);
      if (kindOf(el) !== "c") { el.style.removeProperty("--who"); delete el.dataset.ghost; return; }
      el.style.setProperty("--who", hue(colors.get((el.textContent ?? "").trim().toUpperCase()) ?? 0));
      const ghost = empty ? otherSpeaker(el) : "";
      if (ghost) el.dataset.ghost = ghost; else delete el.dataset.ghost;
    });

    // Cast.
    $("[data-cast]").replaceChildren(...stats.cast.map((c) => {
      const li = document.createElement("li");
      li.style.setProperty("--who", hue(c.color));
      li.innerHTML = `<span class="lv-cast-name"><i></i><span></span><em class="num">${c.share}${pct}</em></span><span class="lv-cast-bar"><i style="width:${c.share}%"></i></span>`;
      li.querySelector(".lv-cast-name > span")!.textContent = c.name;
      return li;
    }));

    // Timeline.
    const tl = timeline(list);
    const body = $("[data-tl]");
    body.style.setProperty("--scale", String(tl.scale));
    $("[data-tl-ruler]").replaceChildren(...Array.from({ length: tl.scale / 10 + 1 }, (_, i) => {
      const span = document.createElement("span");
      span.style.setProperty("--at", String(i * 10));
      span.textContent = formatTime(i * 10);
      return span;
    }));
    const lanes = $("[data-tl-lanes]");
    const nodes: HTMLElement[] = [];
    if (tl.hook !== null) {
      const hook = document.createElement("span");
      hook.className = "lv-tl-hook";
      hook.style.setProperty("--at", String(tl.hook));
      hook.innerHTML = "<i></i><i></i><i></i>";
      nodes.push(hook);
    }
    for (const lane of tl.lanes) {
      const row = document.createElement("div");
      row.className = "lv-tl-lane";
      row.style.setProperty("--who", hue(lane.color));
      const name = document.createElement("b");
      name.textContent = lane.name || "Action";
      const track = document.createElement("span");
      for (const item of lane.items) {
        const i = document.createElement("i");
        i.style.setProperty("--at", String(item.start));
        i.style.setProperty("--len", String(item.length));
        track.append(i);
      }
      row.append(name, track);
      nodes.push(row);
    }
    const head = document.createElement("span");
    head.className = "lv-tl-head-line";
    nodes.push(head);
    lanes.replaceChildren(...nodes);
    const mini = $("[data-tl-mini]");
    const rest = document.createElement("i");
    rest.style.setProperty("--seg", "transparent");
    const total = tl.lanes.reduce((n, lane) => n + lane.items.reduce((m, item) => m + item.length, 0), 0);
    mini.replaceChildren(...tl.lanes.flatMap((lane) => lane.items.map((item) => ({ ...item, color: lane.color })))
      .sort((a, b) => a.start - b.start)
      .map((item) => {
        const i = document.createElement("i");
        i.style.flexGrow = String(item.length);
        i.style.setProperty("--seg", hue(item.color));
        return i;
      }), rest);
    rest.style.flexGrow = String(Math.max(0, tl.scale - total));

    if (step === 4) renderExport(list, stats.seconds);
  }

  // ---------------- Typing the sketch ----------------
  let skip = false;
  let takeOver = false;
  function stopTyping() { if (typing) { skip = true; takeOver = true; } }
  async function typeSketch() {
    if (edited || typing || typed) return;
    typed = true;
    typing = true;
    skip = false;
    const speed = { a: 7, c: 30, d: 16, p: 26 } as const;
    paper.replaceChildren();
    const cursor = document.createElement("span");
    cursor.className = "caret";
    await sleep(500);
    for (const [kind, text] of script) {
      const el = makeBlock(kind);
      el.classList.add("is-active");
      el.dataset.chip = chips[kind];
      paper.append(el);
      if (!skip) {
        for (let n = 1; n <= text.length && !skip; n += 1) {
          el.textContent = text.slice(0, n);
          el.append(cursor);
          if (text[n - 1] === " " || n === text.length) refresh();
          follow(el);
          await sleep(speed[kind] + Math.random() * speed[kind]);
        }
        if (!skip) await sleep(kind === "c" ? 120 : 260);
      }
      el.textContent = text;
      el.classList.remove("is-active");
    }
    cursor.remove();
    typing = false;
    edited = false;
    refresh();
    if (takeOver) {
      // The visitor clicked in while the sketch was still being typed.
      const end = blocks().at(-1);
      if (end) { paper.focus({ preventScroll: true }); place(end, end.textContent?.length ?? 0); }
    } else keys.classList.add("is-on");
  }

  // ---------------- Ida ----------------
  let idaRan = false;
  async function runIda() {
    if (idaRan) return;
    idaRan = true;
    const chat = $("[data-chat]");
    const composer = $("[data-composer]");
    const ask = data.ask ?? "";
    const placeholder = composer.textContent ?? "";
    await sleep(500);
    composer.classList.add("is-typing");
    for (let n = 1; n <= ask.length; n += 1) {
      composer.textContent = ask.slice(0, n);
      await sleep(reducedMotion ? 0 : 34);
    }
    await sleep(350);
    composer.classList.remove("is-typing");
    composer.textContent = placeholder;
    const mine = document.createElement("p");
    mine.className = "lv-msg is-me";
    mine.textContent = ask;
    chat.append(mine);
    const dots = document.createElement("p");
    dots.className = "lv-msg is-ida lv-thinking";
    dots.innerHTML = "<i></i><i></i><i></i>";
    chat.append(dots);
    await sleep(reducedMotion ? 0 : 1300);
    dots.remove();
    const reply = document.createElement("div");
    reply.className = "lv-msg is-ida lv-reply";
    const intro = document.createElement("p");
    intro.textContent = tpl("reply");
    reply.append(intro);
    const first = read().find(([kind]) => kind === "c")?.[1] || script[1]?.[1] || "";
    options.forEach((option, i) => {
      const box = document.createElement("div");
      box.className = "lv-option";
      box.style.setProperty("--i", String(i));
      box.innerHTML = `<p class="blk blk-c"></p><p class="blk blk-d"></p><button type="button" class="lv-insert"></button>`;
      box.querySelector(".blk-c")!.textContent = first;
      (box.querySelector(".blk-c") as HTMLElement).style.setProperty("--who", hue(1));
      box.querySelector(".blk-d")!.textContent = option;
      const button = box.querySelector("button")!;
      button.textContent = `+ ${tpl("insert-label")}`;
      button.addEventListener("click", () => {
        const name = makeBlock("c", first);
        const line = makeBlock("d", option);
        line.classList.add("is-new");
        name.classList.add("is-new");
        paper.append(name, line);
        changed();
        follow(line);
        button.textContent = `✓ ${data.inserted ?? ""}`;
        button.disabled = true;
      });
      reply.append(box);
    });
    chat.append(reply);
  }

  // ---------------- Board ----------------
  const cols = $$("[data-col]");
  function counts() {
    cols.forEach((col, i) => {
      const n = col.querySelectorAll(".lv-card").length;
      col.querySelector("[data-col-count]")!.textContent = String(n);
      const side = root.querySelector(`[data-stage-count="${i}"]`);
      if (side) side.textContent = String(n);
    });
    const ours = root.querySelector<HTMLElement>("[data-card='ours']");
    const at = ours ? cols.indexOf(ours.closest<HTMLElement>("[data-col]")!) : 1;
    const stage = cols[at]?.querySelector(".lv-col-head b")?.textContent ?? "";
    root.querySelectorAll(".lv-stage b, .lv-pill-stage").forEach((el) => { el.textContent = stage; });
    $$(".lv-steps i").forEach((el, i) => el.classList.toggle("is-on", i < at));
  }
  function flip(card: HTMLElement, move: () => void) {
    const first = card.getBoundingClientRect();
    move();
    const last = card.getBoundingClientRect();
    const s = getScale() || 1;
    if (reducedMotion) return;
    card.animate([
      { transform: `translate(${(first.left - last.left) / s}px, ${(first.top - last.top) / s}px) rotate(-2deg)`, boxShadow: "var(--shadow-3)" },
      { transform: "none" },
    ], { duration: 650, easing: "cubic-bezier(0.22, 1, 0.36, 1)" });
  }
  let dragged: HTMLElement | null = null;
  root.addEventListener("dragstart", (event) => {
    const card = (event.target as HTMLElement).closest<HTMLElement>(".lv-card");
    if (!card) return;
    dragged = card;
    card.classList.add("is-dragging");
    event.dataTransfer?.setData("text/plain", card.textContent ?? "");
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
  });
  root.addEventListener("dragend", () => {
    dragged?.classList.remove("is-dragging");
    dragged = null;
    cols.forEach((col) => col.classList.remove("is-over"));
  });
  for (const col of cols) {
    const list = col.querySelector<HTMLElement>("[data-col-cards]")!;
    col.addEventListener("dragover", (event) => {
      if (!dragged) return;
      event.preventDefault();
      cols.forEach((c) => c.classList.toggle("is-over", c === col));
    });
    col.addEventListener("drop", (event) => {
      if (!dragged) return;
      event.preventDefault();
      const card = dragged;
      const before = [...list.querySelectorAll<HTMLElement>(".lv-card")].find((el) => el !== card && event.clientY < el.getBoundingClientRect().top + el.getBoundingClientRect().height / 2);
      flip(card, () => list.insertBefore(card, before ?? null));
      col.classList.remove("is-over");
      counts();
    });
  }

  let boardRan = false;
  async function runBoard() {
    if (boardRan) return;
    boardRan = true;
    await sleep(900);
    const ours = root.querySelector<HTMLElement>("[data-card='ours']");
    const ready = cols[2]?.querySelector<HTMLElement>("[data-col-cards]");
    if (ours && ready && ours.closest("[data-col]") === cols[1]) { flip(ours, () => ready.prepend(ours)); counts(); }
    await sleep(1300);
    const capture = $("[data-capture]");
    const text = $("[data-capture-text]");
    const idea = data.idea ?? "";
    capture.classList.add("is-on");
    await sleep(400);
    capture.classList.add("is-typing");
    for (let n = 1; n <= idea.length; n += 1) { text.textContent = idea.slice(0, n); await sleep(reducedMotion ? 0 : 38); }
    await sleep(500);
    capture.classList.remove("is-on", "is-typing");
    const card = document.createElement("article");
    card.className = "lv-card is-new";
    card.draggable = true;
    card.innerHTML = `<b></b><span><i style="--dot: var(--char-3)"></i><span></span><small></small></span>`;
    card.querySelector("b")!.textContent = idea;
    card.querySelector("span > span")!.textContent = data.folder ?? "";
    card.querySelector("small")!.textContent = data.just ?? "";
    cols[0]?.querySelector("[data-col-cards]")?.prepend(card);
    counts();
    const ideas = root.querySelector("[data-week-ideas]");
    if (ideas) ideas.textContent = String(Number(ideas.textContent) + 1);
    say(tpl("saved-idea"));
    window.setTimeout(() => { text.textContent = ""; }, 400);
  }

  // ---------------- Export ----------------
  const dialog = $("[data-export]");
  function renderExport(list = read(), seconds = demoStats(list).seconds) {
    const colors = castColors(list);
    const time = formatTime(seconds);
    const names = [...colors.keys()].join(", ");
    $("[data-cover-cast]").textContent = (data.castLine ?? "").replace("{names}", names);
    $("[data-cover-meta]").textContent = `${data.folder ?? ""} · ${(data.runtime ?? "").replace("{time}", time)}`;
    let speaker = "";
    $("[data-print]").replaceChildren(...list.map(([kind, text]) => {
      if (kind === "c") speaker = text;
      const p = document.createElement("p");
      p.className = `pv pv-${kind}`;
      if (kind !== "a") p.style.setProperty("--who", hue(colors.get(speaker) ?? 0));
      p.textContent = text;
      return p;
    }));
    speaker = "";
    const plain: HTMLElement[] = [];
    for (const [kind, text] of list) {
      if (kind === "c") { speaker = text; continue; }
      if (kind !== "d" || !text.trim()) continue;
      const p = document.createElement("p");
      const b = document.createElement("b");
      b.textContent = speaker;
      p.append(b, document.createTextNode(text));
      plain.push(p);
    }
    $("[data-plain]").replaceChildren(...plain);
    const file = $("[data-file]");
    file.textContent = JSON.stringify({ title: $(".lv-crumb b").textContent, runtime: time, cast: [...colors.keys()], blocks: list.length }, null, 2);
  }
  const fileName = $("[data-filename]");
  const baseName = (fileName.textContent ?? "").replace(/\.pdf$/, "");
  const ext = { pdf: ".pdf", txt: ".txt", file: ".scriptz" } as const;
  dialog.addEventListener("change", (event) => {
    const input = event.target as HTMLInputElement;
    if (input.type === "radio") {
      dialog.dataset.format = input.value;
      fileName.textContent = baseName + (ext[input.value as keyof typeof ext] ?? "");
    } else if (input.dataset.opt) {
      dialog.classList.toggle(`opt-${input.dataset.opt}`, input.checked);
    }
  });
  dialog.classList.add("opt-cover");
  $("[data-export-go]").addEventListener("click", () => say(tpl("done")));

  let toastTimer = 0;
  function say(text: string) {
    toast.textContent = text;
    toast.classList.add("is-on");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove("is-on"), 2800);
  }

  // ---------------- Steps ----------------
  const date = root.querySelector("[data-date]");
  if (date) date.textContent = new Intl.DateTimeFormat(data.lang, { weekday: "long", day: "numeric", month: "long" }).format(new Date());
  paper.contentEditable = "true";
  paper.setAttribute("role", "textbox");
  paper.setAttribute("aria-multiline", "true");
  refresh();

  return {
    scale: getScale,
    setStep(next) {
      if (next === step) return;
      step = next;
      root.dataset.step = String(next);
      root.dataset.view = next === 3 ? "board" : "editor";
      root.dataset.panel = next === 2 ? "ida" : "insp";
      root.classList.toggle("is-timeline", next === 1);
      root.classList.toggle("is-export", next === 4);
      if (next === 0 && !reducedMotion) void typeSketch();
      if (next === 2) void runIda();
      if (next === 3) void runBoard();
      if (next === 4) renderExport();
    },
  };
}
