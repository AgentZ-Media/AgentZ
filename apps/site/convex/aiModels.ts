// Models of the hosted agent (ai.ts): the chat model for everything and a
// lighter one for fact checks (one turn of a chat or a background check).
// The server decides both; an app may only ask for the check model, any
// other request runs on the chat model. Same ids as
// modules/scriptz/lib/agent/openrouter/config.ts.

/** Fallbacks when OPENROUTER_MODEL / OPENROUTER_CHECK_MODEL are not set. */
export const DEFAULT_MODEL = "openai/gpt-6.1-sol";
export const DEFAULT_CHECK_MODEL = "openai/gpt-6-luna";

const LABELS: Record<string, string> = {
  "openai/gpt-6.1-sol": "GPT-6.1 Sol",
  "openai/gpt-6-luna": "GPT-6 Luna",
  "google/gemini-3.8-flash": "Gemini 3.8 Flash",
};

export interface AiModel { id: string; label: string }

const named = (id: string): AiModel => ({ id, label: LABELS[id] ?? id });

export function chatModel(env: string | undefined = process.env.OPENROUTER_MODEL): AiModel {
  return named(env?.trim() || DEFAULT_MODEL);
}

export function checkModel(env: string | undefined = process.env.OPENROUTER_CHECK_MODEL): AiModel {
  return named(env?.trim() || DEFAULT_CHECK_MODEL);
}

/** The model a request runs on: the check model if the app asks for it,
 *  else the chat model. */
export function modelFor(requested: unknown, chat: AiModel = chatModel(), check: AiModel = checkModel()): string {
  return requested === check.id ? check.id : chat.id;
}
