import type { JSX } from "solid-js";
import type { Command, CommandProvider, ShellControls } from "@agentz/kit/shell";
import { api } from "../../lib/api";
import { K } from "@agentz/kit/platform";
import { scriptStages, stageLabel } from "../../lib/stages";
import type { SearchHit } from "../../lib/types";
import { navStore } from "../../stores/nav";
import { uiStore } from "../../stores/ui";
import { ideasStore } from "../../stores/ideas";
import { t } from "../../i18n";
import { Icon, type IconName } from "@agentz/kit/ui";
import { StageGlyph } from "../Common/StageGlyph";
import { library } from "../Shell/libraryData";
import { importScriptzFile, openNewScript } from "../Library/actions";
import { setStageWithUndo } from "../Script/stageActions";
import { safeSnippet } from "./snippet";
import { agentStore } from "../../stores/agent";
import { agentSettings } from "../../stores/agentSettings";
import { agentUi } from "../../stores/agentUi";
import { AGENT_JOBS } from "../../lib/agent/jobs";
import { JOB_HINT, JOB_ICON, JOB_LABEL } from "../Agent/jobLabels";
import "./commands.css";

type GroupKey = "recent" | "scripts" | "ideas" | "commands";

interface PaletteItem {
  id: string;
  group: GroupKey;
  label: string;
  /** Plain secondary line. */
  sub?: string;
  /** Escaped full-text snippet (HTML with <mark>). */
  snippetHtml?: string;
  icon: () => JSX.Element;
  hint?: string;
  /** Extra search words for commands. */
  keywords?: string;
  run: () => void;
}

const MAX_SCRIPTS = 8;
const MAX_CONTENT = 8;
const MAX_IDEAS = 6;
const MAX_RECENT = 6;

function groupLabel(g: GroupKey): string {
  if (g === "recent") return t("shell.palette.group.recent");
  if (g === "scripts") return t("shell.palette.group.scripts");
  if (g === "ideas") return t("shell.palette.group.ideas");
  return t("shell.palette.group.commands");
}

function icon(name: IconName): () => JSX.Element {
  return () => <Icon name={name} size={14} />;
}

/** All commands; script-bound ones only while a script is open. */
function commands(shell: ShellControls): PaletteItem[] {
  const scriptId = navStore.activeScriptId();
  const list: PaletteItem[] = [
    {
      id: "cmd:new-script",
      group: "commands",
      label: t("browser.newScript"),
      icon: icon("plus"),
      hint: K("Mod+N"),
      run: () => openNewScript(),
    },
    {
      id: "cmd:new-idea",
      group: "commands",
      label: t("shell.cmd.newIdea"),
      icon: icon("bulb"),
      hint: K("Mod+I"),
      run: () => uiStore.openCapture(),
    },
    {
      id: "cmd:ideas",
      group: "commands",
      label: t("shell.cmd.openIdeas"),
      icon: () => <StageGlyph stage="idea" />,
      run: () => navStore.openIdeas(),
    },
    {
      id: "cmd:inbox",
      group: "commands",
      label: t("shell.cmd.openInbox"),
      icon: icon("inbox"),
      run: () => navStore.openInbox(),
    },
    {
      id: "cmd:all",
      group: "commands",
      label: t("shell.nav.all"),
      icon: icon("stack"),
      run: () => navStore.openScripts(),
    },
  ];
  if (scriptId) {
    const current = library.script(scriptId)?.status;
    list.push(
      {
        id: "cmd:export",
        group: "commands",
        label: t("shell.cmd.export"),
        icon: icon("export"),
        hint: K("Mod+E"),
        run: () => uiStore.openExport(scriptId),
      },
      {
        id: "cmd:timeline",
        group: "commands",
        label: t("shell.cmd.timeline"),
        icon: icon("play"),
        hint: K("Mod+J"),
        run: () => uiStore.toggleTimeline(),
      },
      {
        id: "cmd:inspector",
        group: "commands",
        label: t("shell.cmd.inspector"),
        icon: icon("inspector"),
        hint: K("Mod+Shift+\\"),
        run: () => uiStore.toggleInspector(),
      },
      {
        id: "cmd:focus",
        group: "commands",
        label: t("shell.cmd.focus"),
        icon: icon("sun"),
        hint: K("Mod+Shift+F"),
        run: () => uiStore.toggleFocus(scriptId),
      },
    );
    // Ida's jobs (only in the full script view, with the agent set up).
    if (agentStore.available() && agentSettings.enabled() && agentSettings.onboarded()) {
      for (const job of AGENT_JOBS) {
        list.push({
          id: `cmd:agent:${job}`,
          group: "commands",
          label: t("agent.job.palette", { name: agentSettings.displayName(), job: t(JOB_LABEL[job]) }),
          keywords: `${t(JOB_HINT[job])} ${t("agent.jobs.title")}`,
          icon: icon(JOB_ICON[job]),
          run: () => agentUi.ask({ scriptId, text: t(JOB_LABEL[job]), send: true, job }),
        });
      }
    }
    for (const { id: st } of scriptStages()) {
      if (st === current) continue;
      list.push({
        id: `cmd:stage:${st}`,
        group: "commands",
        label: t("shell.cmd.stage", { stage: stageLabel(st) }),
        keywords: t("shell.menu.stage"),
        icon: () => <StageGlyph stage={st} />,
        run: () => void setStageWithUndo(scriptId, st),
      });
    }
  }
  list.push(
    {
      id: "cmd:sidebar",
      group: "commands",
      label: t("shell.cmd.sidebar"),
      icon: icon("sidebar"),
      hint: K("Mod+\\"),
      run: () => shell.toggleSidebar(),
    },
    {
      id: "cmd:activity",
      group: "commands",
      label: t("shell.cmd.activity"),
      keywords: t("shell.cmd.activityKeywords"),
      icon: icon("history"),
      run: () => uiStore.openActivity(),
    },
    {
      id: "cmd:trash",
      group: "commands",
      label: t("browser.trash"),
      icon: icon("trash"),
      run: () => navStore.go({ kind: "trash" }),
    },
    {
      id: "cmd:import",
      group: "commands",
      label: t("browser.import.title"),
      icon: icon("import"),
      run: () => void importScriptzFile(),
    },
    {
      id: "cmd:settings",
      group: "commands",
      label: t("settings.title"),
      icon: icon("gear"),
      hint: K("Mod+,"),
      run: () => shell.openSettings(),
    },
    {
      id: "cmd:onboarding",
      group: "commands",
      label: t("shell.cmd.onboarding"),
      icon: icon("info"),
      run: () => shell.openOnboarding(),
    },
  );
  return list;
}

/** Commands shown with an empty query, in this order. */
const EMPTY_COMMANDS = new Set([
  "cmd:new-script",
  "cmd:new-idea",
  "cmd:ideas",
  "cmd:all",
  "cmd:export",
  "cmd:timeline",
  "cmd:focus",
  "cmd:settings",
]);

function rankedItems(query: string, hits: SearchHit[], shell: ShellControls): PaletteItem[] {
  const q = query.trim().toLowerCase();
  if (!q) {
    const recent: PaletteItem[] = navStore
      .recent()
      .filter((r) => r.scriptId !== navStore.activeScriptId())
      .slice(0, MAX_RECENT)
      .map((r) => {
        const s = library.script(r.scriptId);
        const title = s?.title || r.title || t("common.untitled");
        return {
          id: `recent:${r.scriptId}`,
          group: "recent" as const,
          label: title,
          sub: s ? (library.folder(s.folder_id)?.name ?? undefined) : undefined,
          icon: s ? () => <StageGlyph stage={s.status} /> : icon("doc"),
          run: () => navStore.openScript(r.scriptId, title),
        };
      });
    return [...recent, ...commands(shell).filter((c) => EMPTY_COMMANDS.has(c.id))];
  }

  // Scripts by title (prefix matches first), then full-text hits.
  const titleMatches = library
    .scripts()
    .filter((s) => s.title.toLowerCase().includes(q))
    .sort((a, b) => {
      const pa = a.title.toLowerCase().startsWith(q) ? 0 : 1;
      const pb = b.title.toLowerCase().startsWith(q) ? 0 : 1;
      return pa - pb || b.updated_at - a.updated_at;
    })
    .slice(0, MAX_SCRIPTS);
  const seen = new Set(titleMatches.map((s) => s.id));
  const scripts: PaletteItem[] = titleMatches.map((s) => ({
    id: `script:${s.id}`,
    group: "scripts",
    label: s.title || t("common.untitled"),
    sub: library.folder(s.folder_id)?.name,
    icon: () => <StageGlyph stage={s.status} />,
    run: () => navStore.openScript(s.id, s.title),
  }));
  let content = 0;
  for (const h of hits) {
    if (seen.has(h.id) || content >= MAX_CONTENT) continue;
    const s = library.script(h.id);
    if (!s) continue; // archived or gone
    seen.add(h.id);
    content++;
    scripts.push({
      id: `hit:${h.id}`,
      group: "scripts",
      label: h.title || t("common.untitled"),
      snippetHtml: h.snippet ? safeSnippet(h.snippet) : undefined,
      icon: () => <StageGlyph stage={s.status} />,
      run: () => navStore.openScript(h.id, h.title),
    });
  }

  const ideas: PaletteItem[] = (ideasStore.ideas() ?? [])
    .filter((i) => !i.used_at)
    .filter((i) => i.title.toLowerCase().includes(q) || (i.notes ?? "").toLowerCase().includes(q))
    .slice(0, MAX_IDEAS)
    .map((i) => ({
      id: `idea:${i.id}`,
      group: "ideas",
      label: i.title,
      sub: (i.notes ?? "").split(/\r?\n/).find((l) => l.trim().length > 0)?.trim(),
      icon: () => <StageGlyph stage="idea" />,
      run: () => {
        // The ideas page selects + reveals it (clearing filters that hide it).
        uiStore.revealIdea(i.id);
        if (!navStore.isIdeas()) void navStore.openIdeas(i.folder_id);
      },
    }));

  const cmds = commands(shell).filter((c) =>
    `${c.label} ${c.keywords ?? ""}`.toLowerCase().includes(q),
  );

  // A command whose label starts with the query ("neue idee", "zeitl")
  // is what the writer is typing out - lead with the commands so ⏎ runs
  // it instead of a full-text hit that merely contains the word.
  const cmdLeads = cmds.some((c) => c.label.toLowerCase().startsWith(q));
  return cmdLeads ? [...cmds, ...scripts, ...ideas] : [...scripts, ...ideas, ...cmds];
}

function toCommand(item: PaletteItem): Command {
  const { snippetHtml, group, ...command } = item;
  return {
    ...command,
    group: { id: group, label: groupLabel(group) },
    description: snippetHtml
      ? () => <small class="pal-snip" innerHTML={snippetHtml} />
      : undefined,
  };
}

/** Local ranking and domain search stay with the product; the shell schedules requests. */
export function createScriptzCommands(shell: ShellControls): CommandProvider {
  const local = (query: string) => rankedItems(query, [], shell).map(toCommand);
  const provider: CommandProvider = async (query, signal) => {
    if (signal.aborted) return [];
    if (query.trim().length < 2) return local(query);
    let hits: SearchHit[] = [];
    try {
      hits = await api.globalSearch(query.trim(), 30);
    } catch {
      // A full-text failure must not hide matching local titles or commands.
    }
    return signal.aborted ? [] : rankedItems(query, hits, shell).map(toCommand);
  };
  provider.immediate = local;
  return provider;
}
