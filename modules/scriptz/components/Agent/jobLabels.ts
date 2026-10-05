// Labels, hints and icons of the agent's fixed jobs (lib/agent/jobs.ts),
// shared by the empty chat, the command palette and the chips on the paper.

import type { IconName } from "@agentz/kit/ui";
import type { TranslationKey } from "../../i18n";
import type { AgentJobId } from "../../lib/agent/jobs";

export const JOB_LABEL: Record<AgentJobId, TranslationKey> = {
  hook: "agent.job.hook",
  cut: "agent.job.cut",
  tempo: "agent.job.tempo",
  ending: "agent.job.ending",
  facts: "agent.job.facts",
  feedback: "agent.job.feedback",
};

export const JOB_HINT: Record<AgentJobId, TranslationKey> = {
  hook: "agent.job.hook.hint",
  cut: "agent.job.cut.hint",
  tempo: "agent.job.tempo.hint",
  ending: "agent.job.ending.hint",
  facts: "agent.job.facts.hint",
  feedback: "agent.job.feedback.hint",
};

export const JOB_ICON: Record<AgentJobId, IconName> = {
  hook: "timer",
  cut: "scissors",
  tempo: "bolt",
  ending: "marker",
  facts: "search",
  feedback: "pen",
};
