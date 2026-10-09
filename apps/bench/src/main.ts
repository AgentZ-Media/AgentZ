import "@agentz/design/fonts.css";
import "@agentz/design/tokens.css";
import "@agentz/design/components.css";
import "./styles.css";
import { ICONS, type IconName } from "@agentz/design/icons";
import { LOGO_DOT_R, LOGO_DOTS, LOGO_VIEWBOX } from "@agentz/design/logo";
import { heatColor, heatmap, scatter, seriesColor, type Series } from "./charts";
import { loadSuites, modelsOf, newestState, overview, parseScript, stats, tasksOf, type BenchRun, type ProfileInfo, type Stats, type Suite, type TaskInfo } from "./data";
import { cents, date, dollars, esc, integer, percent, score, seconds } from "./format";
import { lang, setLang, t, tx, type Key } from "./i18n";
import { characterColor, chat, script, toolLabel } from "./render";

const suites = loadSuites();
// Character colours in the order of the test library, so they stay put.
for (const suite of suites) {
  for (const profile of suite.profiles) {
    for (const s of profile.scripts) for (const b of parseScript(s.body)) if (b.type === "character") characterColor(b.text);
  }
}

type Metric = "score" | "cost" | "time" | "checks";
type SortKey = "rank" | "score" | "cost" | "time" | "visible" | "checks" | "retries";

const state = {
  profile: "",
  scope: "newest" as "newest" | "all",
  hidden: new Set<string>(),
  metric: "score" as Metric,
  sort: { key: "rank" as SortKey, dir: 1 },
  /** Models compared in detail per task (at most three). */
  compare: new Map<string, string[]>(),
  /** Chosen run per model and task (run id). */
  picked: new Map<string, string>(),
  libraryProfile: "",
};

const MAX_COMPARE = 3;

type View = { name: "overview" } | { name: "task"; id: string; model: string | null } | { name: "library" } | { name: "method" };

function parseRoute(): { suite: Suite | undefined; view: View } {
  const [path, query] = location.hash.replace(/^#\/?/, "").split("?");
  const [suiteId, name, arg] = path.split("/").map(decodeURIComponent);
  const suite = suites.find((s) => s.id === suiteId) ?? suites[0];
  const model = new URLSearchParams(query ?? "").get("m");
  if (name === "task" && arg) return { suite, view: { name: "task", id: arg, model } };
  if (name === "library" || name === "method") return { suite, view: { name } };
  return { suite, view: { name: "overview" } };
}

const href = (suite: Suite, ...parts: string[]) => `#/${[suite.id, ...parts].map(encodeURIComponent).join("/")}`;
const icon = (name: IconName) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;
const logo = () => `<svg viewBox="${LOGO_VIEWBOX}" aria-hidden="true">${LOGO_DOTS.map((d) => `<circle cx="${d.cx}" cy="${d.cy}" r="${LOGO_DOT_R}" class="${d.tone}"/>`).join("")}</svg>`;

const dark = matchMedia("(prefers-color-scheme: dark)");
const applyTheme = () => { document.documentElement.dataset.theme = dark.matches ? "dark" : "light"; };

const app = document.getElementById("app")!;
const tip = document.getElementById("tip")!;

// ------------------------------------------------------------------ model

interface Ranked extends Series {
  o: ReturnType<typeof overview>;
  /** Tasks this model has finished at least once. */
  coverage: number;
}

interface Model {
  suite: Suite;
  runs: BenchRun[];
  /** All models of the suite with rank (by rating in the current filter). */
  ranked: Ranked[];
  shown: Ranked[];
  tasks: { id: string; label: string; short: string; profile: string; profileName: string }[];
  /** Tasks every shown model has finished: the ranking compares only these,
   *  so a model with few (or easy) tasks does not jump ahead. */
  common: { id: string }[];
}

function build(suite: Suite): Model {
  const inProfile = suite.runs.filter((r) => !state.profile || r.profile === state.profile);
  const scoped = state.scope === "newest" ? newestState(inProfile) : inProfile;
  const all = modelsOf(suite.runs);
  const profileName = (id: string) => suite.profiles.find((p) => p.id === id)?.name ?? id;
  const tasks = tasksOf(suite, scoped).map((task) => ({
    id: task.id, profile: task.profile, profileName: profileName(task.profile), short: tx(task.label),
    label: state.profile ? tx(task.label) : `${profileName(task.profile)} · ${tx(task.label)}`,
  }));
  const covered = (model: string, task: string) => scoped.some((r) => r.model === model && r.task === task && r.status === "completed");
  const visible = all.filter((m) => !state.hidden.has(m.id) && scoped.some((r) => r.model === m.id));
  const common = tasks.filter((task) => visible.every((m) => covered(m.id, task.id)));
  const ranked = all
    .map((m, i) => ({
      id: m.id, name: m.name, color: seriesColor(i, dark.matches), rank: 0,
      o: overview(scoped, m.id, common), coverage: tasks.filter((task) => covered(m.id, task.id)).length,
    }))
    .filter((m) => m.o.runs > 0 || scoped.some((r) => r.model === m.id))
    .sort((a, b) => (b.o.score ?? -1) - (a.o.score ?? -1) || (a.o.cost ?? 1e9) - (b.o.cost ?? 1e9));
  ranked.forEach((m, i) => { m.rank = i + 1; });
  const shown = ranked.filter((m) => !state.hidden.has(m.id));
  return { suite, runs: scoped.filter((r) => shown.some((m) => m.id === r.model)), ranked, shown, tasks, common };
}

const cellStats = (m: Model, model: string, task: string) => stats(m.runs.filter((r) => r.model === model && r.task === task));

// ------------------------------------------------------------------ parts

function sidebar(m: Model | null, suite: Suite | undefined, view: View): string {
  const nav = (link: string, label: string, ico: IconName, on: boolean, extra = "") =>
    `<a class="nav${on ? " is-on" : ""}" href="${link}">${icon(ico)}<span class="lbl">${esc(label)}</span>${extra}</a>`;
  const suiteList = suites.length > 1
    ? `<p class="sec-h">${esc(t("benchmarks"))}</p>${suites.map((s) => nav(href(s, "overview"), tx(s.title), "stack", s.id === suite?.id)).join("")}`
    : "";
  let taskNav = "";
  if (m && suite) {
    const byProfile = new Map<string, typeof m.tasks>();
    for (const task of m.tasks) byProfile.set(task.profileName, [...(byProfile.get(task.profileName) ?? []), task]);
    taskNav = [...byProfile].map(([name, list]) => `
      <p class="sec-sub">${esc(name)}</p>
      ${list.map((task) => {
        const best = m.shown.map((s) => cellStats(m, s.id, task.id).score).filter((v): v is number => v !== null);
        const top = best.length ? Math.max(...best) : null;
        return nav(href(suite, "task", task.id), task.short, "doc", view.name === "task" && view.id === task.id, top === null ? "" : `<span class="n num">${esc(score(top))}</span>`);
      }).join("")}`).join("");
  }
  return `
    <aside class="side">
      <div class="brand">
        <span class="mark">${logo()}</span>
        <span class="brand-t"><b>AgentZ Bench</b><small>${esc(t("brandSub"))}</small></span>
      </div>
      <div class="side-scroll">
        ${suiteList}
        ${suite ? `<p class="sec-h">${esc(tx(suite.title))}</p>${nav(href(suite, "overview"), t("nav_overview"), "board", view.name === "overview")}` : ""}
        ${taskNav ? `<p class="sec-h">${esc(t("nav_tasks"))}</p>${taskNav}` : ""}
        ${suite ? `<p class="sec-h">${esc(t("nav_more"))}</p>${nav(href(suite, "library"), t("nav_library"), "folder", view.name === "library")}${nav(href(suite, "method"), t("nav_method"), "info", view.name === "method")}` : ""}
      </div>
      <div class="side-foot">
        <span class="muted-side">${m ? esc(t("meta", { runs: m.suite.runs.length, models: m.ranked.length })) : ""}</span>
        <button class="side-btn" data-lang>${esc(t("language"))}</button>
      </div>
    </aside>`;
}

function filters(suite: Suite): string {
  const profiles = suite.profiles.filter((p) => suite.runs.some((r) => r.profile === p.id));
  return `
    <div class="tools">
      ${profiles.length > 1 ? `<div class="seg" role="group" aria-label="${esc(t("profile"))}">
        <button data-profile="" aria-pressed="${state.profile === ""}">${esc(t("allProfiles"))}</button>
        ${profiles.map((p) => `<button data-profile="${esc(p.id)}" aria-pressed="${state.profile === p.id}">${esc(p.name)}</button>`).join("")}
      </div>` : ""}
      <div class="seg" role="group" aria-label="${esc(t("scope"))}" title="${esc(t("stateHint"))}">
        <button data-scope="newest" aria-pressed="${state.scope === "newest"}">${esc(t("stateNewest"))}</button>
        <button data-scope="all" aria-pressed="${state.scope === "all"}">${esc(t("stateAll"))}</button>
      </div>
    </div>`;
}

function header(kicker: string, title: string, side = ""): string {
  return `<header class="head"><div><p class="kicker">${esc(kicker)}</p><h1>${esc(title)}</h1></div>${side}</header>`;
}

const rankBadge = (s: Series) => `<span class="rank" style="--c:${s.color}">${s.rank}</span>`;

/** Best value of a column gets a marker; `low` = lower is better. */
function bestOf(values: (number | null)[], low: boolean): number | null {
  const v = values.filter((x): x is number => x !== null);
  if (!v.length) return null;
  return low ? Math.min(...v) : Math.max(...v);
}

function ranking(m: Model): string {
  const rows = [...m.ranked];
  const key = state.sort.key;
  const val = (r: Ranked): number | null => ({
    rank: r.rank, score: r.o.score, cost: r.o.cost, time: r.o.ms, visible: r.o.firstMs, checks: r.o.checks, retries: r.o.failedSteps,
  })[key];
  rows.sort((a, b) => ((val(a) ?? 1e12) - (val(b) ?? 1e12)) * state.sort.dir);
  const visible = m.ranked.filter((r) => !state.hidden.has(r.id));
  const best = {
    score: bestOf(visible.map((r) => r.o.score), false), cost: bestOf(visible.map((r) => r.o.cost), true),
    time: bestOf(visible.map((r) => r.o.ms), true), visible: bestOf(visible.map((r) => r.o.firstMs), true), checks: bestOf(visible.map((r) => r.o.checks), false),
  };
  const mark = (v: number | null, b: number | null) => (v !== null && v === b ? " best" : "");
  const th = (k: SortKey, label: Key, cls = "") => {
    const on = state.sort.key === k;
    return `<th class="${cls}"><button class="sort${on ? " on" : ""}" data-sort="${k}">${esc(t(label))}${on ? (state.sort.dir > 0 ? " ↑" : " ↓") : ""}</button></th>`;
  };
  return `
    <section class="card">
      <header class="card-h"><div><h2>${esc(t("ranking"))}</h2><p class="hint">${esc(t("rankingHint"))}</p>${m.common.length < m.tasks.length ? `<p class="notice">${esc(t("rankingCommon", { n: m.common.length, total: m.tasks.length }))}</p>` : ""}</div></header>
      <div class="scroll">
        <table class="table rank-table">
          <thead><tr><th class="cb"></th>${th("rank", "colRank", "num")}<th>${esc(t("colModel"))}</th>${th("score", "colRating")}${th("cost", "colCost", "num")}<th class="num">${esc(t("perThousand"))}</th>${th("time", "colTime", "num")}${th("visible", "colVisible", "num")}${th("checks", "colChecks", "num")}${th("retries", "colRetries", "num")}</tr></thead>
          <tbody>${rows.map((r) => `
            <tr class="${state.hidden.has(r.id) ? "off" : ""}">
              <td class="cb"><input type="checkbox" data-show="${esc(r.id)}" ${state.hidden.has(r.id) ? "" : "checked"} aria-label="${esc(t("showModel", { name: r.name }))}"></td>
              <td class="num">${rankBadge(r)}</td>
              <td><span class="model">${esc(r.name)}</span>${r.coverage < m.tasks.length ? ` <span class="cov" title="${esc(t("coverageHint"))}">${esc(t("coverage", { n: r.coverage, total: m.tasks.length }))}</span>` : ""}<span class="sub">${esc(r.id)}</span></td>
              <td class="${mark(r.o.score, best.score)}"><span class="meter"><span class="bar" style="width:${(r.o.score ?? 0) * 10}%;background:${r.color}"></span></span><span class="num strong">${r.o.score === null ? "-" : esc(score(r.o.score))}</span></td>
              <td class="num${mark(r.o.cost, best.cost)}">${r.o.cost === null ? "-" : esc(cents(r.o.cost))}</td>
              <td class="num muted">${r.o.cost === null ? "-" : esc(dollars(r.o.cost * 10))}</td>
              <td class="num${mark(r.o.ms, best.time)}">${r.o.ms === null ? "-" : esc(seconds(r.o.ms))}</td>
              <td class="num${mark(r.o.firstMs, best.visible)}">${r.o.firstMs === null ? "-" : esc(seconds(r.o.firstMs))}</td>
              <td class="num${mark(r.o.checks, best.checks)}">${r.o.checks === null ? "-" : esc(percent(r.o.checks))}</td>
              <td class="num">${r.o.failedSteps === null ? "-" : esc(score(r.o.failedSteps))}${r.o.completed !== null && r.o.completed < 1 ? ` <span class="warn-t">(${esc(percent(1 - r.o.completed))} ✕)</span>` : ""}</td>
            </tr>`).join("")}
          </tbody>
        </table>
      </div>
    </section>`;
}

function highlights(m: Model): string {
  const pick = (f: (r: Ranked) => number | null, low: boolean) => {
    const list = m.shown.filter((r) => f(r) !== null);
    if (!list.length) return null;
    return list.reduce((a, b) => ((low ? f(b)! < f(a)! : f(b)! > f(a)!) ? b : a));
  };
  const tile = (label: Key, r: Ranked | null, value: (r: Ranked) => string, ico: IconName) =>
    `<div class="hl">${icon(ico)}<p class="hl-l">${esc(t(label))}</p>${r ? `<p class="hl-v">${rankBadge(r)}<span>${esc(r.name)}</span></p><p class="hl-n num">${esc(value(r))}</p>` : "<p class=\"hl-v\">-</p>"}</div>`;
  const value = (r: Ranked) => (r.o.score !== null && r.o.cost ? r.o.score / r.o.cost : null);
  return `
    <section class="highlights">
      ${tile("hlBest", pick((r) => r.o.score, false), (r) => `${score(r.o.score ?? 0)} / 10`, "spark")}
      ${tile("hlValue", pick(value, false), (r) => t("pointsPerCent", { value: score(value(r) ?? 0) }), "bolt")}
      ${tile("hlCheap", pick((r) => r.o.cost, true), (r) => t("perTaskValue", { value: cents(r.o.cost ?? 0) }), "check")}
      ${tile("hlFast", pick((r) => r.o.ms, true), (r) => t("perTaskValue", { value: seconds(r.o.ms ?? 0) }), "timer")}
    </section>`;
}

const METRICS: { id: Metric; label: Key }[] = [
  { id: "score", label: "colRating" }, { id: "cost", label: "colCost" }, { id: "time", label: "colTime" }, { id: "checks", label: "colChecks" },
];

function heat(m: Model): string {
  const values = m.shown.flatMap((s) => m.tasks.map((task) => cellStats(m, s.id, task.id)));
  // Relative to the best and worst cell, so differences show; the cells
  // carry the real values.
  const scale = (f: (c: Stats) => number | null, low: boolean) => {
    const v = values.map(f).filter((x): x is number => x !== null);
    const min = Math.min(...v);
    const max = Math.max(...v);
    return (x: number) => (max > min ? (low ? max - x : x - min) / (max - min) : 1);
  };
  const checks = (c: Stats) => (c.checks === null ? null : c.checks * 100);
  const spec = {
    score: { f: (c: Stats) => c.score, fmt: score, good: scale((c) => c.score, false) },
    cost: { f: (c: Stats) => c.cost, fmt: cents, good: scale((c) => c.cost, true) },
    time: { f: (c: Stats) => c.ms, fmt: seconds, good: scale((c) => c.ms, true) },
    checks: { f: checks, fmt: (v: number) => percent(v / 100), good: scale(checks, false) },
  }[state.metric];
  const table = heatmap(m.shown, m.tasks.map((task) => ({ id: task.id, label: task.short, group: task.profileName })), (row, col) => {
    const c = cellStats(m, row, col);
    const v = c.n ? spec.f(c) : null;
    const task = m.tasks.find((x) => x.id === col);
    return {
      value: v,
      text: v === null ? "" : spec.fmt(v).replace(/\s*(ct|s|%)$/, ""),
      tip: v === null ? "" : `${m.shown.find((s) => s.id === row)?.name} · ${task?.label}\n${spec.fmt(v)} (n=${c.n})`,
      href: `${href(m.suite, "task", col)}?m=${encodeURIComponent(row)}`,
    };
  }, spec.good, heatColor(dark.matches));
  return `
    <section class="card">
      <header class="card-h">
        <div><h2>${esc(t("heatTitle"))}</h2><p class="hint">${esc(t("heatHint"))}</p></div>
        <div class="seg" role="group">${METRICS.map((x) => `<button data-metric="${x.id}" aria-pressed="${state.metric === x.id}">${esc(t(x.label))}</button>`).join("")}</div>
      </header>
      ${table}
    </section>`;
}

function overviewView(m: Model): string {
  const judge = m.suite.runs.find((r) => r.judge)?.judge?.model ?? "-";
  const points = m.shown.flatMap((s) => (s.o.cost === null || s.o.score === null ? [] : [{
    id: s.id, x: s.o.cost, y: s.o.score, label: s.name, rank: s.rank, color: s.color, tip: `${s.rank}. ${s.name}\n${cents(s.o.cost)} · ${score(s.o.score)}/10`,
  }]));
  return `
    ${header(tx(m.suite.title), t("nav_overview"), filters(m.suite))}
    <p class="lead">${esc(t("subtitle"))}</p>
    ${highlights(m)}
    ${ranking(m)}
    <div class="grid-2">
      <section class="card">
        <header class="card-h"><div><h2>${esc(t("pricePerformance"))}</h2><p class="hint">${esc(t("pricePerformanceHint"))}</p></div></header>
        ${scatter(points, t("costAxis"), t("ratingAxis"), cents)}
      </section>
      <section class="card">
        <header class="card-h"><div><h2>${esc(t("howRead"))}</h2></div></header>
        <ul class="facts-list">
          <li>${icon("spark")}<span>${esc(t("readRating", { judge }))}</span></li>
          <li>${icon("check")}<span>${esc(t("readChecks"))}</span></li>
          <li>${icon("bolt")}<span>${esc(t("readCost"))}</span></li>
          <li>${icon("timer")}<span>${esc(t("readTime"))}</span></li>
          <li>${icon("refresh")}<span>${esc(t("readRetries"))}</span></li>
        </ul>
      </section>
    </div>
    ${heat(m)}`;
}

// ------------------------------------------------------------------- task

function requestPanel(suite: Suite, info: TaskInfo | undefined): string {
  if (!info) return "";
  const profile = suite.profiles.find((p) => p.id === info.profile);
  const open = profile?.scripts.find((s) => s.key === info.script);
  const folder = profile?.folders.find((f) => f.key === (info.folder ?? open?.folder));
  const where = info.mode === "session" ? t("sessionIn", { folder: folder?.name ?? "-" })
    : info.mode === "claim" ? t("claimLine", { index: info.lineIndex ?? 0 })
    : info.mode === "learn" ? t("learnTask") : `${t("openScript")}: ${open?.title ?? "-"}`;
  return `
    <section class="card request">
      <div class="req-main">
        <p class="kicker">${esc(where)}</p>
        ${info.message ? `<div class="msg user">${info.quote ? `<blockquote class="quote">${esc(info.quote)}</blockquote>` : ""}<p>${esc(info.message)}</p></div>` : ""}
        <p class="hint">${esc(info.rubric)}</p>
      </div>
      <div class="req-more">
        ${open ? `<details class="drawer"><summary>${icon("doc")}<span>${esc(open.title)}</span></summary>${script(parseScript(open.body), true)}</details>` : ""}
        ${info.instruction ? `<details class="drawer"><summary>${icon("spark")}<span>${esc(t("toModel"))}</span></summary><pre class="instruction">${esc(info.instruction)}</pre></details>` : ""}
      </div>
    </section>`;
}

function modelCard(s: Ranked, m: Model, taskId: string): string {
  const options = m.runs.filter((r) => r.model === s.id && r.task === taskId).sort((a, b) => b.at.localeCompare(a.at) || a.rep - b.rep);
  const head = `${rankBadge(s)}<h3>${esc(s.name)}</h3>`;
  if (!options.length) return `<article class="mcard"><header class="mcard-h">${head}</header><p class="muted">${esc(t("noRun"))}</p></article>`;
  const key = `${s.id}|${taskId}`;
  const run = options.find((r) => r.id === state.picked.get(key)) ?? options[0];
  const failed = run.checks.filter((c) => !c.pass);
  const steps = run.stepLog.map((st) => `<li class="${st.error ? "fail" : ""}">${esc(st.kind === "search" ? t("tool_web_search") : t("stepLine", { provider: st.provider ?? "-", ms: seconds(st.ms), first: st.firstMs === null ? "-" : seconds(st.firstMs) }))}${st.error ? ` · ${esc(t("stepFailed", { error: st.error }))}` : ""}</li>`).join("");
  return `
    <article class="mcard">
      <header class="mcard-h">
        ${head}
        ${options.length > 1 ? `<select class="field" data-pick="${esc(key)}">${options.map((r) => `<option value="${esc(r.id)}"${r.id === run.id ? " selected" : ""}>${esc(t("run", { n: r.rep }))}</option>`).join("")}</select>` : ""}
        ${run.judge ? `<span class="score-badge" title="${esc(t("judge", { judge: run.judge.model }))}">${esc(score(run.judge.score))}</span>` : ""}
      </header>
      <p class="pills"><span>${esc(cents(run.costUsd * 100))}</span><span>${esc(seconds(run.ms))}</span>${run.firstOutputMs !== null ? `<span>${esc(t("visibleAfter", { value: seconds(run.firstOutputMs) }))}</span>` : ""}${run.failedSteps ? `<span class="warn">${run.failedSteps}× ${esc(t("colRetries"))}</span>` : ""}</p>
      ${run.status !== "completed" ? `<p class="error">${esc(t("failed", { error: run.error ?? run.status }))}</p>` : ""}
      ${run.judge ? `<blockquote class="judge">${esc(tx(run.judge.reason))}</blockquote>` : ""}
      <details class="checks-d"${failed.length ? " open" : ""}>
        <summary><span class="${failed.length ? "warn-t" : "ok-t"}">${failed.length ? "✕" : "✓"}</span> ${esc(t("checksLine", { passed: run.checks.length - failed.length, total: run.checks.length }))}</summary>
        <ul class="checks">${run.checks.map((c) => `<li class="${c.pass ? "pass" : "fail"}"><span class="mark-icon" aria-hidden="true">${c.pass ? "✓" : "✕"}</span>${esc(tx(c.label))}${c.detail ? ` <span class="muted">(${esc(c.detail)})</span>` : ""}</li>`).join("")}</ul>
      </details>
      ${chat(run)}
      <footer class="mcard-f">
        <details><summary>${esc(t("toolCalls"))} (${run.toolCalls.length})</summary><ol class="timeline">${run.toolCalls.map((c) => `<li><span class="muted num">${esc(seconds(c.atMs))}</span> ${esc(toolLabel(c.name))} <code>${esc(c.args.slice(0, 140))}</code></li>`).join("")}</ol></details>
        <details><summary>${esc(t("stepsTitle"))} (${run.stepLog.length})</summary><ol class="timeline">${steps}</ol><p class="hint">${esc(t("tokensLine", { prompt: integer(run.tokens.prompt), cached: integer(run.tokens.cached), completion: integer(run.tokens.completion), reasoning: integer(run.tokens.reasoning) }))}</p></details>
      </footer>
    </article>`;
}

function taskView(m: Model, id: string, focus: string | null): string {
  const index = m.tasks.findIndex((x) => x.id === id);
  const task = m.tasks[index];
  if (!task) return `${header(tx(m.suite.title), t("nav_tasks"))}<p class="muted">${esc(t("noRun"))}</p>`;
  const info = m.suite.tasks.find((x) => x.id === id);
  const rows = m.shown.map((s) => ({ s, c: cellStats(m, s.id, id) }))
    .sort((a, b) => (b.c.score ?? -1) - (a.c.score ?? -1) || (a.c.cost ?? 1e9) - (b.c.cost ?? 1e9));
  let chosen = (state.compare.get(id) ?? rows.filter((r) => r.c.n).slice(0, MAX_COMPARE).map((r) => r.s.id)).filter((cid) => m.shown.some((s) => s.id === cid));
  if (focus && m.shown.some((s) => s.id === focus) && !chosen.includes(focus)) chosen = [focus, ...chosen].slice(0, MAX_COMPARE);
  state.compare.set(id, chosen);
  const prev = m.tasks[index - 1];
  const next = m.tasks[index + 1];
  const navButtons = `<div class="tools">
      ${prev ? `<a class="btn" href="${href(m.suite, "task", prev.id)}" title="${esc(prev.label)}">${icon("left")}</a>` : ""}
      <span class="muted num">${index + 1} / ${m.tasks.length}</span>
      ${next ? `<a class="btn" href="${href(m.suite, "task", next.id)}" title="${esc(next.label)}">${icon("right")}</a>` : ""}
    </div>`;
  const best = {
    score: bestOf(rows.map((r) => r.c.score), false), cost: bestOf(rows.map((r) => r.c.cost), true), time: bestOf(rows.map((r) => r.c.ms), true),
  };
  const mark = (v: number | null, b: number | null) => (v !== null && v === b ? " best" : "");
  return `
    ${header(task.profileName, task.short, navButtons)}
    ${requestPanel(m.suite, info)}
    <section class="card">
      <header class="card-h"><div><h2>${esc(t("allModels"))}</h2><p class="hint">${esc(t("compareHint", { n: MAX_COMPARE }))}</p></div></header>
      <div class="scroll"><table class="table">
        <thead><tr><th class="cb">${esc(t("colCompare"))}</th><th>${esc(t("colModel"))}</th><th>${esc(t("colRating"))}</th><th class="num">${esc(t("colCost"))}</th><th class="num">${esc(t("colTime"))}</th><th class="num">${esc(t("colVisible"))}</th><th class="num">${esc(t("colChecks"))}</th><th class="num">${esc(t("colRetries"))}</th></tr></thead>
        <tbody>${rows.map(({ s, c }) => `
          <tr class="${chosen.includes(s.id) ? "chosen" : ""}">
            <td class="cb"><input type="checkbox" data-compare="${esc(s.id)}" data-task="${esc(id)}" ${chosen.includes(s.id) ? "checked" : ""} ${!(c.n + c.failed) || (!chosen.includes(s.id) && chosen.length >= MAX_COMPARE) ? "disabled" : ""} aria-label="${esc(t("compareModel", { name: s.name }))}"></td>
            <td>${rankBadge(s)} <span class="model">${esc(s.name)}</span></td>
            <td class="${mark(c.score, best.score)}"><span class="meter"><span class="bar" style="width:${(c.score ?? 0) * 10}%;background:${s.color}"></span></span><span class="num strong">${c.score === null ? "-" : esc(score(c.score))}</span></td>
            <td class="num${mark(c.cost, best.cost)}">${c.cost === null ? "-" : esc(cents(c.cost))}</td>
            <td class="num${mark(c.ms, best.time)}">${c.ms === null ? "-" : esc(seconds(c.ms))}</td>
            <td class="num">${c.firstMs === null ? "-" : esc(seconds(c.firstMs))}</td>
            <td class="num">${c.checks === null ? "-" : esc(percent(c.checks))}</td>
            <td class="num">${c.failedSteps === null ? "-" : esc(score(c.failedSteps))}</td>
          </tr>`).join("")}
        </tbody>
      </table></div>
    </section>
    <div class="compare" style="--n:${Math.max(1, chosen.length)}">
      ${chosen.map((cid) => m.shown.find((s) => s.id === cid)).filter((s): s is Ranked => !!s).map((s) => modelCard(s, m, id)).join("")}
    </div>`;
}

// ---------------------------------------------------------------- library

const STAGE_KEYS: Record<string, Key> = { writing: "stage_writing", ready: "stage_ready", shot: "stage_shot", online: "stage_online" };
const stageLabel = (id: string) => (STAGE_KEYS[id] ? t(STAGE_KEYS[id]) : id);

function libraryView(suite: Suite): string {
  const profiles = suite.profiles;
  const p: ProfileInfo | undefined = profiles.find((x) => x.id === state.libraryProfile) ?? profiles[0];
  if (!p) return header(tx(suite.title), t("nav_library"));
  const folderName = (key: string | null) => p.folders.find((f) => f.key === key)?.name ?? t("allFolders");
  const kinds: { kind: string; label: Key }[] = [
    { kind: "global", label: "kind_global" }, { kind: "folder", label: "kind_folder" }, { kind: "character", label: "kind_character" }, { kind: "relation", label: "kind_relation" },
  ];
  return `
    ${header(tx(suite.title), t("nav_library"), profiles.length > 1 ? `<div class="seg">${profiles.map((x) => `<button data-libprofile="${esc(x.id)}" aria-pressed="${x.id === p.id}">${esc(x.name)}</button>`).join("")}</div>` : "")}
    <p class="lead">${esc(t("libraryHint"))}</p>
    <section class="card persona">
      <div class="avatar">${esc(p.persona.name.slice(0, 1))}</div>
      <div class="persona-b">
        <h2>${esc(t("persona", { name: p.persona.name, user: p.persona.userName }))}</h2>
        <p class="hint">${esc(tx(p.about))}</p>
        <p class="tags">${p.persona.traits.map((x) => `<span class="fchip">${esc(x)}</span>`).join("")}<span class="fchip">${esc(t("pace", { wpm: p.wpm }))}</span>${p.folders.map((f) => `<span class="fchip">${icon("folder")}${esc(f.name)} · ${f.minSec ?? "-"}-${f.maxSec ?? "-"} s</span>`).join("")}</p>
        ${p.persona.instructions ? `<p class="quote-line">„${esc(p.persona.instructions)}“</p>` : ""}
      </div>
    </section>
    <h2 class="sec-title">${esc(t("scripts"))} <span class="muted">${p.scripts.length}</span></h2>
    <div class="script-grid">${p.scripts.map((s) => `
      <details class="card sc">
        <summary><span class="sc-t">${esc(s.title)}</span><span class="sc-m">${esc(folderName(s.folder))} · ${esc(stageLabel(s.stage))}</span></summary>
        ${script(parseScript(s.body))}
      </details>`).join("")}
    </div>
    <div class="grid-2">
      <section class="card">
        <header class="card-h"><h2>${esc(t("memory"))}</h2></header>
        ${kinds.map(({ kind, label }) => {
          const list = p.memory.filter((x) => x.kind === kind);
          return list.length ? `<p class="kicker">${esc(t(label))}</p><ul class="mem">${list.map((x) => `<li>${x.subject ? `<b>${esc(x.subject.replace("|", " ↔ "))}</b> ` : ""}<span class="muted">${esc(folderName(x.folder))}</span><br>${esc(x.content)}</li>`).join("")}</ul>` : "";
        }).join("")}
      </section>
      <section class="card">
        <header class="card-h"><h2>${esc(t("ideas"))}</h2></header>
        <ul class="mem">${p.ideas.map((i) => `<li><b>${esc(i.title)}</b><br>${esc(i.notes)}</li>`).join("")}</ul>
      </section>
    </div>`;
}

// ----------------------------------------------------------------- method

function methodView(m: Model): string {
  const rows = m.shown.flatMap((s) => m.tasks.map((task) => {
    const c = cellStats(m, s.id, task.id);
    if (!c.n && !c.failed) return "";
    const v = (x: number | null, f: (n: number) => string) => (x === null ? "-" : esc(f(x)));
    return `<tr><td>${rankBadge(s)} ${esc(s.name)}</td><td>${esc(task.label)}</td><td class="num">${c.n}${c.failed ? ` (+${c.failed} ✕)` : ""}</td>
      <td class="num">${v(c.cost, cents)}</td><td class="num">${c.costMin === null ? "-" : esc(`${cents(c.costMin)} - ${cents(c.costMax ?? 0)}`)}</td>
      <td class="num">${v(c.ms, seconds)}</td><td class="num">${v(c.firstMs, seconds)}</td><td class="num">${v(c.checks, percent)}</td><td class="num">${v(c.score, score)}</td><td class="num">${v(c.failedSteps, score)}</td>
      <td class="num">${c.tokens ? esc(integer(c.tokens.prompt)) : "-"}</td><td class="num">${c.tokens ? esc(integer(c.tokens.cached)) : "-"}</td><td class="num">${c.tokens ? esc(integer(c.tokens.completion)) : "-"}</td><td class="num">${v(c.searches, score)}</td></tr>`;
  })).join("");
  const perMillion = (x: string | undefined) => (x ? dollars(Number(x) * 1e6) : "-");
  const cols = ["colModel", "colTask", "colRuns", "colCost", "colRange", "colTime", "colVisible", "colChecks", "colRating", "colRetries", "colIn", "colCached", "colOut", "colSearch"] as const;
  const latest = m.suite.runs.reduce((a, r) => (r.at > a ? r.at : a), "");
  return `
    ${header(tx(m.suite.title), t("nav_method"), filters(m.suite))}
    <section class="card prose">
      <p>${esc(t("methodBody"))}</p>
      <pre class="cmd">${esc(t("howTo"))}</pre>
      <p class="hint">${esc(t("latestRun", { date: date(latest) }))}</p>
    </section>
    <section class="card">
      <header class="card-h"><div><h2>${esc(t("prices"))}</h2><p class="hint">${esc(t("pricesHint"))}</p></div></header>
      <div class="scroll"><table class="table"><thead><tr><th>${esc(t("colModel"))}</th><th class="num">${esc(t("colIn"))}</th><th class="num">${esc(t("colCached"))}</th><th class="num">${esc(t("colOut"))}</th></tr></thead><tbody>
        ${m.ranked.map((s) => {
          const p = m.suite.runs.filter((r) => r.model === s.id && r.pricing).at(-1)?.pricing;
          return `<tr><td>${rankBadge(s)} ${esc(s.name)}</td><td class="num">${esc(perMillion(p?.prompt))}</td><td class="num">${esc(perMillion(p?.input_cache_read))}</td><td class="num">${esc(perMillion(p?.completion))}</td></tr>`;
        }).join("")}
      </tbody></table></div>
    </section>
    <section class="card">
      <header class="card-h"><h2>${esc(t("table"))}</h2></header>
      <div class="scroll"><table class="table dense"><thead><tr>${cols.map((c) => `<th class="${c === "colModel" || c === "colTask" ? "" : "num"}">${esc(t(c))}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div>
    </section>`;
}

// ----------------------------------------------------------------- render

let lastView = "";

function render(): void {
  const { suite, view } = parseRoute();
  const m = suite && suite.runs.length ? build(suite) : null;
  let body: string;
  if (!suite || !m) body = `<div class="empty">${esc(t("empty"))}</div>`;
  else if (view.name === "task") {
    body = taskView(m, view.id, view.model);
    // The model from the heatmap is chosen once; afterwards it can be
    // unticked like any other.
    if (view.model) history.replaceState(null, "", location.hash.split("?")[0]);
  } else if (view.name === "library") body = libraryView(suite);
  else if (view.name === "method") body = methodView(m);
  else body = overviewView(m);
  app.innerHTML = `<div class="shell">${sidebar(m, suite, view)}<main class="main" id="main"><div class="view">${body}</div></main></div>`;
  const key = location.hash.split("?")[0];
  if (key !== lastView) {
    document.getElementById("main")?.scrollTo(0, 0);
    lastView = key;
  }
}

function keepScroll(fn: () => void): void {
  const y = document.getElementById("main")?.scrollTop ?? 0;
  fn();
  document.getElementById("main")?.scrollTo(0, y);
}

app.addEventListener("click", (event) => {
  const el = (event.target as HTMLElement).closest<HTMLElement>("button");
  if (!el) return;
  const d = el.dataset;
  if (d.lang !== undefined) setLang(lang() === "de" ? "en" : "de");
  else if (d.scope) state.scope = d.scope as typeof state.scope;
  else if (d.profile !== undefined) state.profile = d.profile;
  else if (d.metric) state.metric = d.metric as Metric;
  else if (d.libprofile) state.libraryProfile = d.libprofile;
  else if (d.sort) {
    const k = d.sort as SortKey;
    state.sort = { key: k, dir: state.sort.key === k ? -state.sort.dir : k === "score" || k === "checks" ? -1 : 1 };
  } else return;
  keepScroll(render);
});

app.addEventListener("change", (event) => {
  const el = event.target as HTMLInputElement & HTMLSelectElement;
  const d = el.dataset;
  if (d.pick) state.picked.set(d.pick, el.value);
  else if (d.show) {
    if (el.checked) state.hidden.delete(d.show);
    else state.hidden.add(d.show);
  } else if (d.compare && d.task) {
    const list = (state.compare.get(d.task) ?? []).filter((x) => x !== d.compare);
    state.compare.set(d.task, el.checked ? [...list, d.compare].slice(0, MAX_COMPARE) : list);
  } else return;
  keepScroll(render);
});

app.addEventListener("pointermove", (event) => {
  const mark = (event.target as Element).closest<HTMLElement | SVGElement>("[data-tip]");
  const text = mark?.dataset.tip;
  if (!text) {
    tip.hidden = true;
    return;
  }
  tip.textContent = text;
  tip.hidden = false;
  const x = Math.min(event.clientX + 14, window.innerWidth - tip.offsetWidth - 8);
  tip.style.transform = `translate(${x}px, ${event.clientY + 14}px)`;
});
app.addEventListener("pointerleave", () => { tip.hidden = true; });

window.addEventListener("hashchange", render);
dark.addEventListener("change", () => {
  applyTheme();
  keepScroll(render);
});
document.documentElement.lang = lang();
applyTheme();
render();
