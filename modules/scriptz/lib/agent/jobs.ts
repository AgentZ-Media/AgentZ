// Fixed jobs for the agent ("Einstieg prüfen", "Kürzen", ...). The chat
// shows only the job's short label as the user's message; the model gets the
// full instruction below. Every job ends in cards (propose_options or
// report_fact_check), so the writer decides what lands on the paper.
//
// Instructions are model-facing and therefore English, like prompt.ts. The
// agent answers in the user's language anyway.

export type AgentJobId = "hook" | "cut" | "tempo" | "ending" | "facts" | "feedback";

/** Order of the job cards in the empty chat and in the command palette. */
export const AGENT_JOBS: readonly AgentJobId[] = ["hook", "cut", "tempo", "ending", "facts", "feedback"];

export function isAgentJob(value: unknown): value is AgentJobId {
  return typeof value === "string" && (AGENT_JOBS as readonly string[]).includes(value);
}

export interface JobContext {
  /** Target range as text ("0:45-1:05"), empty when none is set. */
  range: string;
  /** Current runtime as the app shows it ("m:ss"). */
  runtime: string;
  wpm: number;
}

const SPAN_RULE =
  "Use one replace target that spans every block any of your options changes; each option holds the complete new text of that whole span (repeat unchanged lines inside it).";

export function jobInstruction(id: AgentJobId, ctx: JobContext): string {
  switch (id) {
    case "hook":
      return [
        "Job: check the opening (\"Einstieg prüfen\").",
        "First read the whole script with get_current_script and understand what it is about and where its core conflict lies.",
        "Then judge the opening honestly. The clock starts with the first line of dialog; stage directions before it do not count. What is said in the first 3, 5 and 10 seconds, and how long does it take until the conflict is clear?",
        "Reply with two or three short sentences: what the script is about, and what the opening does today.",
        `Then call propose_options with 2-3 alternative openings that get to the point faster and hold attention: cut small talk and greetings, start inside the conflict, lead with the strongest line or a question. Keep the characters' voices and the rest of the script intact. ${SPAN_RULE}`,
        "Set current_conflict_block to the script index of the block where the conflict becomes clear today, and for every option set conflict_block to the index (0-based, within that option's blocks) of the block where it becomes clear in that version.",
        "If the opening is already strong, say so and offer at most one sharper variant.",
      ].join("\n");
    case "cut":
      return [
        "Job: shorten the script (\"Kürzen\").",
        `The app measures ${ctx.runtime} at ${ctx.wpm} words per minute${ctx.range ? `; the target range is ${ctx.range}` : ""}.`,
        "Read the whole script with get_current_script. Look at all of it, not only the longest lines: beats that repeat what we already know, two lines that can become one, wording that can be tighter, a detour that can go.",
        `Propose 2-3 genuinely different ways with propose_options (for example: cut a passage, merge lines, tighten throughout). Give each a short title naming the approach. Keep the punchline and the characters' voices. ${SPAN_RULE}`,
        "One short sentence before the cards.",
      ].join("\n");
    case "tempo":
      return [
        "Job: raise the tempo (\"Tempo erhöhen\").",
        "Read the whole script with get_current_script and find long lines and monologues.",
        "Break them into back-and-forth: the other character interjects short reactions (\"Ja.\", \"Hmm.\", \"Hä?\"), or a long line becomes a list the other character confirms point by point. More speaker changes mean more cuts in the video.",
        `Keep the meaning, the punchline and the voices; the runtime may grow by a few seconds at most. Propose 2-3 options with propose_options. ${SPAN_RULE}`,
        "One short sentence before the cards.",
      ].join("\n");
    case "ending":
      return [
        "Job: a harder ending.",
        "Read the whole script with get_current_script, then propose 2-3 alternative endings with propose_options that land harder: a sharper last line, an unexpected turn or a silent final image.",
        `Replace the closing beat (use a replace target over the last blocks you change). ${SPAN_RULE}`,
      ].join("\n");
    case "facts":
      return [
        "Job: fact-check the whole script.",
        "Read it with get_current_script, find every checkable real-world claim, search the web and call report_fact_check. If there is no checkable claim, say so in one sentence.",
      ].join("\n");
    case "feedback":
      return [
        "Job: honest feedback on the whole script.",
        "Read it with get_current_script. Say in a few short sentences what works, what does not land yet and the one change that would help most. Only show cards when you propose concrete text.",
      ].join("\n");
  }
}

/** Rewrite the selected passage in a character's voice (context menu). */
export function voiceInstruction(name: string): string {
  return [
    `Rewrite the selected passage so it sounds more like ${name}, the way this character speaks in this folder.`,
    "Use your memory of the character (the folder's version first, then the base profile) and other scripts of the folder if useful.",
    "Keep what happens and the length roughly the same. Offer 2-3 options with propose_options, replacing the selected blocks.",
  ].join("\n");
}
