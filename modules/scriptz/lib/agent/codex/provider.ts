// Codex app-server provider: one long-lived `codex app-server` process per
// app session, shared by all threads (chat + background learning). Maps the
// app-server protocol onto the provider-neutral types in ../types.ts.
//
// The agent runs read-only with approvals off: Codex' own shell and file
// tools are useless (and blocked) here; all script access goes through our
// dynamic tools, web search through Codex' built-in search.

import { RpcClient, RpcError, type CodexProcessLike } from "./rpc";
import { obj, type Obj } from "../toolArgs";
import {
  DEFAULT_EFFORT,
  isAgentEffort,
  type AgentEvent,
  type AgentModel,
  type AgentProvider,
  type AgentThread,
  type AgentTool,
  type OpenThreadOptions,
  type ProviderState,
  type TurnOptions,
  type TurnResult,
  AGENT_PROCESS_EXITED,
} from "../types";

export interface CodexHostLike {
  locate(): Promise<{ path: string; version: string | null } | null>;
  start(config?: string[]): Promise<CodexProcessLike>;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** Launch overrides (`codex app-server -c ...`). Web search always on; the
 *  user's personal Codex extras (shell, plugins, computer use, browser,
 *  sub-agents, memories, hooks ...) are switched off so a writing assistant
 *  cannot touch the machine. `code_mode_host` must stay on: dynamic tools
 *  are invoked through it. */
// Mirrored in the Rust test `accepts_the_scriptz_launch_config` (codex.rs).
const DISABLED_FEATURES = [
  "shell_tool", "unified_exec", "apps", "plugins", "multi_agent", "multi_agent_v2",
  "image_generation", "browser_use", "computer_use", "in_app_browser", "goals",
  "sleep_tool", "memories", "tool_suggest", "skill_search", "view_image", "hooks", "chronicle",
];
const LAUNCH_CONFIG = ['web_search="live"', ...DISABLED_FEATURES.map((f) => `features.${f}=false`)];

/** Abort a turn that runs away (the model can loop). */
const TURN_TIMEOUT_MS = 6 * 60 * 1000;
/** Codex acknowledges `turn/start` at once; the turn itself runs longer. */
const TURN_START_TIMEOUT_MS = 30_000;

const CLIENT_INFO = { name: "scriptz", title: "ScriptZ", version: "1.0.0" };

interface TurnWaiter {
  turnId: string | null;
  resolve(result: TurnResult): void;
  onEvent(event: AgentEvent): void;
  error: string | null;
}

class CodexThread implements AgentThread {
  waiter: TurnWaiter | null = null;
  private closed = false;
  /** Items started but not completed; closed out when a turn ends. */
  readonly openTools = new Map<string, { tool: string; args: unknown }>();

  /** agentMessage items flagged as progress notes ("commentary"). */
  private readonly commentary = new Set<string>();

  constructor(
    readonly id: string,
    private readonly provider: CodexProvider,
    readonly tools: Map<string, AgentTool>,
  ) {}

  async run(input: string, options: TurnOptions, onEvent: (event: AgentEvent) => void): Promise<TurnResult> {
    if (this.closed) return { status: "failed", error: "thread closed" };
    if (this.waiter) return { status: "failed", error: "a turn is already running" };
    const client = await this.provider.client();
    return new Promise<TurnResult>((resolve) => {
      const timeout = setTimeout(() => { void this.interrupt(); }, TURN_TIMEOUT_MS);
      const waiter: TurnWaiter = {
        turnId: null,
        error: null,
        onEvent,
        resolve: (result) => {
          if (this.waiter !== waiter) return;
          this.waiter = null;
          clearTimeout(timeout);
          this.commentary.clear();
          for (const [itemId, open] of this.openTools) onEvent({ type: "tool-end", itemId, tool: open.tool, args: open.args, ok: result.status === "completed" });
          this.openTools.clear();
          resolve(result);
        },
      };
      this.waiter = waiter;
      client.request<Obj>("turn/start", {
        threadId: this.id,
        input: [{ type: "text", text: input, text_elements: [] }],
        model: options.model || undefined,
        effort: options.effort,
        summary: "detailed",
        approvalPolicy: "never",
        sandboxPolicy: { type: "readOnly" },
      }, TURN_START_TIMEOUT_MS).then((result) => {
        const turn = obj(result.turn);
        if (typeof turn.id === "string") waiter.turnId = turn.id;
      }).catch((error: unknown) => {
        waiter.resolve({ status: "failed", error: error instanceof Error ? error.message : String(error) });
      });
    });
  }

  /** The app-server died: end the running turn now (not after the turn
   *  timeout) and refuse further turns; the session reopens a thread. */
  abandon(): void {
    this.closed = true;
    this.waiter?.resolve({ status: "failed", error: AGENT_PROCESS_EXITED });
  }

  async interrupt(): Promise<void> {
    const waiter = this.waiter;
    if (!waiter) return;
    const client = await this.provider.client().catch(() => null);
    if (!client) { waiter.resolve({ status: "interrupted" }); return; }
    // Codex cannot interrupt a queued turn before turn/started; wait briefly.
    for (let i = 0; i < 50 && !waiter.turnId && this.waiter === waiter; i++) await new Promise((r) => setTimeout(r, 100));
    if (waiter.turnId) {
      await client.request("turn/interrupt", { threadId: this.id, turnId: waiter.turnId }, 5000).catch(() => {});
    }
    // Do not hang if Codex never confirms.
    setTimeout(() => waiter.resolve({ status: "interrupted" }), 8000);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.waiter?.resolve({ status: "interrupted" });
    this.provider.forget(this);
    const client = await this.provider.client().catch(() => null);
    await client?.request("thread/unsubscribe", { threadId: this.id }, 3000).catch(() => {});
  }

  /** Notification for this thread. */
  handle(method: string, params: Obj): void {
    const waiter = this.waiter;
    if (!waiter) return;
    const emit = waiter.onEvent;
    const item = obj(params.item);
    const itemId = str(item.id) || str(params.itemId);
    switch (method) {
      case "turn/started": {
        const turn = obj(params.turn);
        if (typeof turn.id === "string") waiter.turnId = turn.id;
        return;
      }
      case "item/agentMessage/delta":
        emit({ type: "message-delta", itemId, delta: str(params.delta), commentary: this.commentary.has(itemId) });
        return;
      case "item/reasoning/summaryTextDelta":
        emit({ type: "reasoning-delta", itemId, delta: str(params.delta) });
        return;
      case "item/reasoning/summaryPartAdded":
        emit({ type: "reasoning-delta", itemId, delta: "\n\n" });
        return;
      case "item/started":
        this.itemStarted(item, emit);
        return;
      case "item/completed":
        this.itemCompleted(item, emit);
        return;
      case "error": {
        if (params.willRetry === true) return;
        const error = obj(params.error);
        waiter.error = str(error.message) || "Codex error";
        return;
      }
      case "turn/completed": {
        const turn = obj(params.turn);
        const status = str(turn.status);
        const error = obj(turn.error);
        if (status === "interrupted") waiter.resolve({ status: "interrupted" });
        else if (status === "failed") waiter.resolve({ status: "failed", error: str(error.message) || waiter.error || "turn failed" });
        else waiter.resolve({ status: "completed" });
        return;
      }
    }
  }

  private itemStarted(item: Obj, emit: (e: AgentEvent) => void): void {
    const itemId = str(item.id);
    switch (str(item.type)) {
      case "agentMessage":
        if (str(item.phase) === "commentary") this.commentary.add(itemId);
        return;
      case "dynamicToolCall": {
        const tool = str(item.tool);
        const args = item.arguments ?? {};
        this.openTools.set(itemId, { tool, args });
        emit({ type: "tool-start", itemId, tool, args });
        return;
      }
      case "webSearch":
        emit({ type: "web-search", itemId, query: webQuery(item), status: "running" });
        return;
      case "commandExecution":
      case "fileChange":
        emit({ type: "blocked", itemId, what: str(item.type) });
        return;
    }
  }

  private itemCompleted(item: Obj, emit: (e: AgentEvent) => void): void {
    const itemId = str(item.id);
    switch (str(item.type)) {
      case "agentMessage":
        emit({ type: "message", itemId, text: str(item.text), commentary: str(item.phase) === "commentary" || this.commentary.has(itemId) });
        return;
      case "reasoning": {
        const summary = Array.isArray(item.summary) ? item.summary.filter((s): s is string => typeof s === "string") : [];
        emit({ type: "reasoning", itemId, text: summary.join("\n\n") });
        return;
      }
      case "dynamicToolCall": {
        const open = this.openTools.get(itemId);
        this.openTools.delete(itemId);
        emit({ type: "tool-end", itemId, tool: str(item.tool) || open?.tool || "", args: item.arguments ?? open?.args ?? {}, ok: item.success !== false && str(item.status) !== "failed" });
        return;
      }
      case "webSearch":
        emit({ type: "web-search", itemId, query: webQuery(item), status: "done" });
        return;
    }
  }
}

const PLAN_LABELS: Record<string, string> = {
  free: "Free", go: "Go", plus: "Plus", pro: "Pro", prolite: "Pro Lite", team: "Team",
  business: "Business", enterprise: "Enterprise", edu: "Edu",
};

/** ChatGPT plan ids ("prolite") as product names ("Pro Lite"). */
export function planLabel(raw: string): string {
  if (!raw || raw === "unknown") return "";
  return PLAN_LABELS[raw.toLowerCase()] ?? raw.charAt(0).toUpperCase() + raw.slice(1);
}

function webQuery(item: Obj): string {
  const action = obj(item.action);
  const queries = Array.isArray(action.queries) ? action.queries.filter((q): q is string => typeof q === "string") : [];
  return str(action.query) || queries.join(", ") || str(item.query) || str(action.url);
}

export class CodexProvider implements AgentProvider {
  readonly id = "codex";
  private rpc: Promise<RpcClient> | null = null;
  private readonly threads = new Map<string, CodexThread>();
  /** From the user's Codex config: the model they use, MCP servers to mute. */
  private configuredModel = "";
  private mcpServers: string[] = [];

  constructor(private readonly host: CodexHostLike) {}

  /** Running client; starts (or restarts after a crash) the app-server. */
  client(): Promise<RpcClient> {
    if (this.rpc) {
      return this.rpc.then((client) => {
        if (!client.isClosed) return client;
        this.rpc = null;
        return this.client();
      });
    }
    const starting = this.boot();
    this.rpc = starting;
    starting.catch(() => { if (this.rpc === starting) this.rpc = null; });
    return starting;
  }

  private async boot(): Promise<RpcClient> {
    const process = await this.host.start(LAUNCH_CONFIG);
    const client = new RpcClient(process);
    client.onClose(() => {
      // Threads live inside the dead process; a fresh one starts on demand.
      for (const thread of [...this.threads.values()]) thread.abandon();
      this.threads.clear();
    });
    client.onNotification((method, params) => {
      const threadId = str(params.threadId) || str(obj(params.thread).id);
      const thread = threadId ? this.threads.get(threadId) : undefined;
      thread?.handle(method, params);
    });
    client.setRequestHandler((method, params) => this.serverRequest(method, params));
    try {
      await client.request("initialize", { clientInfo: CLIENT_INFO, capabilities: { experimentalApi: true } }, 20000);
      await client.notify("initialized");
    } catch (error) {
      // Do not leave a half-started app-server running.
      await client.close().catch(() => {});
      throw error;
    }
    try {
      const config = obj(obj(await client.request("config/read", {}, 10000)).config);
      this.configuredModel = str(config.model);
      this.mcpServers = Object.keys(obj(config.mcp_servers));
    } catch (error) {
      console.warn("[agent] codex config/read failed", error);
    }
    return client;
  }

  private async serverRequest(method: string, params: Obj): Promise<unknown> {
    if (method === "item/tool/call") {
      const thread = this.threads.get(str(params.threadId));
      const tool = thread?.tools.get(str(params.tool));
      if (!tool) return { success: false, contentItems: [{ type: "inputText", text: `unknown tool ${str(params.tool)}` }] };
      try {
        const result = await tool.run(params.arguments ?? {});
        return { success: result.ok, contentItems: [{ type: "inputText", text: result.output }] };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { success: false, contentItems: [{ type: "inputText", text: JSON.stringify({ error: message }) }] };
      }
    }
    if (method === "item/commandExecution/requestApproval" || method === "item/fileChange/requestApproval") return { decision: "decline" };
    if (method === "item/permissions/requestApproval") return { permissions: {}, scope: "turn" };
    if (method === "execCommandApproval" || method === "applyPatchApproval") return { decision: "denied" };
    throw new RpcError(`unsupported request ${method}`, -32601);
  }

  async check(): Promise<ProviderState> {
    try {
      const location = await this.host.locate();
      if (!location) return { state: "missing" };
      const client = await this.client();
      const result = obj(await client.request("account/read", {}, 15000));
      const account = obj(result.account);
      if (!result.account && result.requiresOpenaiAuth !== false) return { state: "logged-out" };
      const email = str(account.email);
      const plan = planLabel(str(account.planType));
      return { state: "ready", account: [email, plan].filter(Boolean).join(" · ") || null };
    } catch (error) {
      return { state: "error", message: error instanceof Error ? error.message : String(error) };
    }
  }

  async listModels(): Promise<AgentModel[]> {
    const client = await this.client();
    const out: AgentModel[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 10; page++) {
      const result = obj(await client.request("model/list", cursor ? { cursor } : {}, 15000));
      const data = Array.isArray(result.data) ? result.data : [];
      for (const raw of data) {
        const m = obj(raw);
        if (m.hidden === true) continue;
        const id = str(m.model) || str(m.id);
        if (!id) continue;
        const efforts = (Array.isArray(m.supportedReasoningEfforts) ? m.supportedReasoningEfforts : [])
          .map((e) => str(obj(e).reasoningEffort))
          .filter(isAgentEffort);
        const defaultEffort = isAgentEffort(m.defaultReasoningEffort) ? m.defaultReasoningEffort : DEFAULT_EFFORT;
        out.push({
          id,
          label: str(m.displayName) || id,
          description: str(m.description),
          efforts: efforts.length ? efforts : [defaultEffort],
          defaultEffort,
          isDefault: m.isDefault === true,
        });
      }
      cursor = typeof result.nextCursor === "string" && result.nextCursor ? result.nextCursor : null;
      if (!cursor) break;
    }
    // The model the user runs Codex with beats the catalog default.
    if (this.configuredModel && out.some((m) => m.id === this.configuredModel)) {
      for (const m of out) m.isDefault = m.id === this.configuredModel;
    }
    return out;
  }

  async openThread(options: OpenThreadOptions): Promise<AgentThread> {
    const client = await this.client();
    const tools = new Map(options.tools.map((tool) => [tool.name, tool]));
    const dynamicTools = options.tools.map((tool) => ({
      type: "function",
      name: tool.name,
      description: tool.description,
      inputSchema: tool.parameters,
    }));
    // No execution environment = no shell / apply_patch tools at all; the
    // user's MCP servers are muted for ScriptZ threads.
    const config: Record<string, unknown> = {};
    for (const name of this.mcpServers) config[`mcp_servers.${name}.enabled`] = false;
    const base = {
      approvalPolicy: "never",
      sandbox: "read-only",
      environments: [],
      developerInstructions: options.instructions,
      dynamicTools,
      config,
    };
    let threadId = "";
    if (options.resumeId) {
      try {
        const result = obj(await client.request("thread/resume", { threadId: options.resumeId, ...base }, 20000));
        threadId = str(obj(result.thread).id);
      } catch (error) {
        console.warn("[agent] thread resume failed, starting fresh", error);
      }
    }
    if (!threadId) {
      const result = obj(await client.request("thread/start", { ...base, ephemeral: options.ephemeral === true }, 20000));
      threadId = str(obj(result.thread).id);
    }
    if (!threadId) throw new Error("codex returned no thread id");
    const thread = new CodexThread(threadId, this, tools);
    this.threads.set(threadId, thread);
    return thread;
  }

  forget(thread: CodexThread): void {
    if (this.threads.get(thread.id) === thread) this.threads.delete(thread.id);
  }

  async dispose(): Promise<void> {
    for (const thread of [...this.threads.values()]) thread.waiter?.resolve({ status: "interrupted" });
    this.threads.clear();
    const rpc = this.rpc;
    this.rpc = null;
    if (rpc) await rpc.then((client) => client.close()).catch(() => {});
  }
}
