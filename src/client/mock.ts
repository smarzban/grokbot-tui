import { setTimeout as delay } from "node:timers/promises";
import { HOST_DOWN_MESSAGE, MISSING_AUTH_MESSAGE } from "./errors.js";
import { HostClientError } from "./types.js";
import type { Agent, ChatTurn, Health, HostClient, SendPromptInput, SendResult } from "./types.js";

export type MockHostOptions = {
  agents?: Agent[];
  transcripts?: Record<string, ChatTurn[]>;
  replyDelayMs?: number;
  replyFor?: (prompt: string, agent: Agent) => string;
  healthOk?: boolean;
  missingAuth?: boolean;
  hostDown?: boolean;
};

const DEFAULT_AGENTS: Agent[] = [
  { id: "11111111-1111-4111-8111-111111111111", name: "Ada", isGroup: false },
  { id: "22222222-2222-4222-8222-222222222222", name: "Bea", isGroup: false },
];

function cloneTurns(turns: ChatTurn[]): ChatTurn[] {
  return turns.map((turn) => ({ ...turn }));
}

export class MockHostClient implements HostClient {
  readonly source = "mock" as const;
  readonly #agents: Agent[];
  readonly #transcripts: Map<string, ChatTurn[]>;
  readonly #replyDelayMs: number;
  readonly #replyFor: (prompt: string, agent: Agent) => string;
  readonly #healthOk: boolean;
  readonly #missingAuth: boolean;
  readonly #hostDown: boolean;
  #seq = 0;

  constructor(options: MockHostOptions = {}) {
    this.#agents = (options.agents ?? DEFAULT_AGENTS).map((agent) => ({ ...agent }));
    this.#transcripts = new Map();
    for (const agent of this.#agents) {
      this.#transcripts.set(agent.id, cloneTurns(options.transcripts?.[agent.id] ?? []));
    }
    this.#replyDelayMs = options.replyDelayMs ?? 40;
    this.#replyFor =
      options.replyFor ??
      ((prompt, agent) => `${agent.name} here. I received: ${prompt}`);
    this.#healthOk = options.healthOk !== false;
    this.#missingAuth = options.missingAuth === true;
    this.#hostDown = options.hostDown === true;
  }

  #guard(): void {
    if (this.#missingAuth) {
      throw new HostClientError("missing-auth", MISSING_AUTH_MESSAGE);
    }
    if (this.#hostDown || !this.#healthOk) {
      throw new HostClientError("host-down", HOST_DOWN_MESSAGE);
    }
  }

  async health(): Promise<Health> {
    this.#guard();
    return { ok: true, busy: false, activeAgentId: null };
  }

  async listAgents(): Promise<Agent[]> {
    this.#guard();
    return this.#agents.filter((agent) => !agent.isGroup).map((agent) => ({ ...agent }));
  }

  async getTranscript(agentId: string, limit = 80): Promise<ChatTurn[]> {
    this.#guard();
    const turns = this.#transcripts.get(agentId) ?? [];
    return cloneTurns(turns.slice(-limit));
  }

  /** Simulate a turn that arrived from the Grok Bot app, not from this TUI. */
  appendTurn(agentId: string, turn: ChatTurn): void {
    this.#guard();
    const agent = this.#agents.find((row) => row.id === agentId || row.name === agentId);
    const id = agent?.id ?? agentId;
    const existing = this.#transcripts.get(id) ?? [];
    existing.push({ ...turn });
    this.#transcripts.set(id, existing);
  }

  async sendPrompt(input: SendPromptInput): Promise<SendResult> {
    this.#guard();
    const agent = this.#agents.find((row) => row.id === input.agentId || row.name === input.agentId);
    if (!agent) {
      throw new HostClientError("unknown", `No agent named "${input.agentId}".`);
    }

    const startedAt = Date.now();
    const userTurn: ChatTurn = {
      id: `mock-user-${++this.#seq}`,
      role: "user",
      speaker: "you",
      text: input.prompt,
      timestampMs: Date.now(),
    };
    const existing = this.#transcripts.get(agent.id) ?? [];
    existing.push(userTurn);
    this.#transcripts.set(agent.id, existing);
    agent.isRunning = true;

    if (input.wait === false) {
      agent.isRunning = false;
      return { accepted: true, status: "idle", elapsedMs: Date.now() - startedAt };
    }

    try {
      await delay(this.#replyDelayMs, undefined, { signal: input.signal });
    } catch {
      agent.isRunning = false;
      return { accepted: true, status: "cancelled", elapsedMs: Date.now() - startedAt };
    }

    const reply = this.#replyFor(input.prompt, agent);
    existing.push({
      id: `mock-bot-${++this.#seq}`,
      role: "assistant",
      speaker: agent.name,
      text: reply,
      timestampMs: Date.now(),
    });
    agent.isRunning = false;
    return {
      accepted: true,
      status: "idle",
      reply,
      elapsedMs: Date.now() - startedAt,
    };
  }

  async interrupt(agentId: string): Promise<{ hadActiveRun: boolean }> {
    this.#guard();
    const agent = this.#agents.find((row) => row.id === agentId || row.name === agentId);
    const had = agent?.isRunning === true;
    if (agent) agent.isRunning = false;
    return { hadActiveRun: had };
  }
}
