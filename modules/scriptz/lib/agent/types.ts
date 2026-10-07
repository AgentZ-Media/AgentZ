// Provider-neutral agent types.
//
// Everything above the provider layer (chat store, instructions, tools,
// learning, UI) speaks only these types. A provider (Codex app-server, the
// OpenRouter harness) maps its own wire protocol onto them, so a provider
// never touches the chat, the prompts, the tools or the memory, and every
// provider runs exactly the same agent.

/** Reasoning effort. Providers expose the subset a model supports. */
export type AgentEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh";

export const EFFORT_ORDER: readonly AgentEffort[] = ["none", "minimal", "low", "medium", "high", "xhigh"];
export const DEFAULT_EFFORT: AgentEffort = "medium";

export function isAgentEffort(value: unknown): value is AgentEffort {
  return typeof value === "string" && (EFFORT_ORDER as readonly string[]).includes(value);
}

export interface AgentModel {
  id: string;
  label: string;
  description: string;
  efforts: AgentEffort[];
  defaultEffort: AgentEffort;
  /** The provider's recommended default model. */
  isDefault: boolean;
}

/** The wanted effort if the model supports it, else the model's default. */
export function effortOrDefault(model: AgentModel | undefined, wanted: AgentEffort): AgentEffort {
  if (!model) return wanted;
  if (model.efforts.includes(wanted)) return wanted;
  return model.efforts.includes(model.defaultEffort) ? model.defaultEffort : model.efforts[0] ?? wanted;
}

export type ProviderState =
  | { state: "ready"; account: string | null }
  | { state: "missing" }
  | { state: "logged-out" }
  | { state: "error"; message: string };

/** JSON schema subset used for tool parameters. */
export type JsonSchema = {
  type?: "object" | "string" | "number" | "integer" | "boolean" | "array" | "null";
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: readonly (string | number)[];
  additionalProperties?: boolean;
};

export interface ToolResult {
  /** Text handed back to the model (usually JSON). */
  output: string;
  ok: boolean;
}

export interface AgentTool {
  name: string;
  description: string;
  parameters: JsonSchema;
  run(args: unknown): Promise<ToolResult>;
}

/** Normalized stream of what happens during one turn. */
export type AgentEvent =
  | { type: "message-delta"; itemId: string; delta: string; commentary?: boolean }
  | { type: "message"; itemId: string; text: string; commentary?: boolean }
  | { type: "reasoning-delta"; itemId: string; delta: string }
  | { type: "reasoning"; itemId: string; text: string }
  | { type: "tool-start"; itemId: string; tool: string; args: unknown }
  | { type: "tool-end"; itemId: string; tool: string; args: unknown; ok: boolean }
  | { type: "web-search"; itemId: string; query: string; status: "running" | "done" }
  | { type: "blocked"; itemId: string; what: string }
  | { type: "error"; message: string };

export interface TurnOptions {
  model: string;
  effort: AgentEffort;
}

export interface TurnResult {
  status: "completed" | "interrupted" | "failed";
  error?: string;
}

/** `TurnResult.error` when the provider process died mid-turn; the UI shows
 *  a translated hint instead of the raw code. */
export const AGENT_PROCESS_EXITED = "agent-process-exited";
/** `TurnResult.error` codes of the OpenRouter harness, also shown translated. */
export const AGENT_SIGNED_OUT = "agent-signed-out";
export const AGENT_RATE_LIMITED = "agent-rate-limited";
export const AGENT_NETWORK = "agent-network";
export const AGENT_KEY_INVALID = "agent-key-invalid";
export const AGENT_NO_CREDITS = "agent-no-credits";
/** The hosted agent is not open to this AgentZ account yet ("coming soon"). */
export const AGENT_NOT_ENABLED = "agent-not-enabled";

export interface AgentThread {
  /** Provider thread id, stored to resume the chat later. */
  readonly id: string;
  run(input: string, options: TurnOptions, onEvent: (event: AgentEvent) => void): Promise<TurnResult>;
  interrupt(): Promise<void>;
  close(): Promise<void>;
}

export interface OpenThreadOptions {
  instructions: string;
  tools: AgentTool[];
  /** Resume an earlier provider thread; falls back to a new one. */
  resumeId?: string | null;
  /** Background work (learning): not listed in the provider's history. */
  ephemeral?: boolean;
}

export interface AgentProvider {
  readonly id: string;
  check(): Promise<ProviderState>;
  listModels(): Promise<AgentModel[]>;
  openThread(options: OpenThreadOptions): Promise<AgentThread>;
  dispose(): Promise<void>;
}
