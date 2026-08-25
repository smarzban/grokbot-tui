import { setTimeout as delay } from "node:timers/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { HOST_DOWN_MESSAGE, MISSING_AUTH_MESSAGE } from "./errors.js";
import { DEFAULT_TRANSCRIPT_LIMIT, HostClientError } from "./types.js";
import type { Agent, ChatTurn, HostClient, SendPromptInput, SendResult } from "./types.js";

export type MockHostOptions = {
  agents?: Agent[];
  transcripts?: Record<string, ChatTurn[]>;
  replyDelayMs?: number;
  replyFor?: (prompt: string, agent: Agent) => string;
  missingAuth?: boolean;
  hostDown?: boolean;
};

export const ADA_ID = "11111111-1111-4111-8111-111111111111";
const BEA_ID = "22222222-2222-4222-8222-222222222222";
export const DEV_ID = "33333333-3333-4333-8333-333333333333";
export const CHIEF_ID = "44444444-4444-4444-8444-444444444444";
export const PROJECT_X_ID = "55555555-5555-4555-8555-555555555555";

/** Checked-in PNG so `npm start -- --mock` can draw a real picture in Ghostty. */
export function mockPhotoPath(): string {
  return fileURLToPath(new URL("../../fixtures/mock-photo.png", import.meta.url));
}

function defaultTranscripts(agents: Agent[]): Record<string, ChatTurn[]> {
  const ada = agents.find((agent) => agent.id === ADA_ID) ?? agents.find((agent) => !agent.isGroup);
  if (!ada) return {};
  const photo = mockPhotoPath();
  const turns: ChatTurn[] = [];
  if (existsSync(photo)) {
    turns.push({
      id: "mock-photo",
      role: "user",
      speaker: "you",
      text: "",
      timestampMs: 1,
      images: [{ alt: "mock-photo.png", path: photo, mime: "image/png" }],
    });
    turns.push({
      id: "mock-photo-note",
      role: "assistant",
      speaker: ada.name,
      speakerId: ada.id,
      text: "That's the mock photo. Ghostty draws it with the Kitty graphics protocol — nothing extra to install.",
      timestampMs: 2,
    });
  }
  turns.push({
    id: "mock-name-only",
    role: "user",
    speaker: "you",
    text: "",
    timestampMs: 3,
    images: [{ alt: "name-only.png" }],
  });
  turns.push({
    id: "mock-name-note",
    role: "assistant",
    speaker: ada.name,
    speakerId: ada.id,
    text: "That last turn is a filename with no bytes on disk, so it stays a placeholder.",
    timestampMs: 4,
  });
  if (existsSync(photo)) {
    turns.push({
      id: "mock-path-text",
      role: "user",
      speaker: "you",
      text: photo,
      timestampMs: 5,
    });
    turns.push({
      id: "mock-path-text-note",
      role: "assistant",
      speaker: ada.name,
      speakerId: ada.id,
      text: "Pasting a local image path as the message also draws the file — no host attachmentPaths required.",
      timestampMs: 6,
    });
  }
  return { [ada.id]: turns };
}

const DEFAULT_AGENTS: Agent[] = [
  { id: ADA_ID, name: "Ada", isGroup: false },
  { id: BEA_ID, name: "Bea", isGroup: false },
  { id: DEV_ID, name: "Dev", isGroup: false },
  { id: CHIEF_ID, name: "Chief of Staff", isGroup: false },
  {
    id: PROJECT_X_ID,
    name: "project X",
    isGroup: true,
    memberIds: [DEV_ID, CHIEF_ID],
    members: [
      { id: DEV_ID, name: "Dev" },
      { id: CHIEF_ID, name: "Chief of Staff" },
    ],
  },
];

function cloneAgent(agent: Agent): Agent {
  return {
    ...agent,
    ...(agent.memberIds ? { memberIds: [...agent.memberIds] } : {}),
    ...(agent.members ? { members: agent.members.map((member) => ({ ...member })) } : {}),
  };
}

function cloneTurns(turns: ChatTurn[]): ChatTurn[] {
  return turns.map((turn) => ({
    ...turn,
    ...(turn.images ? { images: turn.images.map((image) => ({ ...image })) } : {}),
  }));
}

function groupMembers(agent: Agent): Array<{ id: string; name: string }> {
  if (agent.members && agent.members.length > 0) return agent.members;
  return (agent.memberIds ?? []).map((id) => ({ id, name: id }));
}

export class MockHostClient implements HostClient {
  readonly source = "mock" as const;
  readonly #agents: Agent[];
  readonly #transcripts: Map<string, ChatTurn[]>;
  readonly #replyDelayMs: number;
  readonly #replyFor: (prompt: string, agent: Agent) => string;
  readonly #missingAuth: boolean;
  readonly #hostDown: boolean;
  #seq = 0;

  constructor(options: MockHostOptions = {}) {
    this.#agents = (options.agents ?? DEFAULT_AGENTS).map(cloneAgent);
    this.#transcripts = new Map();
    const seeded = options.transcripts ?? defaultTranscripts(this.#agents);
    for (const agent of this.#agents) {
      this.#transcripts.set(agent.id, cloneTurns(seeded[agent.id] ?? []));
    }
    this.#replyDelayMs = options.replyDelayMs ?? 40;
    this.#replyFor =
      options.replyFor ??
      ((prompt, agent) => `${agent.name} here. I received: ${prompt}`);
    this.#missingAuth = options.missingAuth === true;
    this.#hostDown = options.hostDown === true;
  }

  #guard(): void {
    if (this.#missingAuth) {
      throw new HostClientError("missing-auth", MISSING_AUTH_MESSAGE);
    }
    if (this.#hostDown) {
      throw new HostClientError("host-down", HOST_DOWN_MESSAGE);
    }
  }

  async listAgents(): Promise<Agent[]> {
    this.#guard();
    return this.#agents.map(cloneAgent);
  }

  async getTranscript(agentId: string, limit = DEFAULT_TRANSCRIPT_LIMIT): Promise<ChatTurn[]> {
    this.#guard();
    const turns = this.#transcripts.get(agentId) ?? [];
    return cloneTurns(turns.slice(-limit));
  }

  /** Simulate a bot starting or finishing a run from the Grok Bot app. */
  setRunning(agentId: string, running: boolean): void {
    this.#guard();
    const agent = this.#agents.find((row) => row.id === agentId || row.name === agentId);
    if (agent) agent.isRunning = running;
  }
  appendTurn(agentId: string, turn: ChatTurn): void {
    this.#guard();
    const agent = this.#agents.find((row) => row.id === agentId || row.name === agentId);
    const id = agent?.id ?? agentId;
    const existing = this.#transcripts.get(id) ?? [];
    existing.push({ ...turn });
    this.#transcripts.set(id, existing);
  }

  #pushAssistant(agent: Agent, speaker: { id: string; name: string }, text: string): void {
    const existing = this.#transcripts.get(agent.id) ?? [];
    existing.push({
      id: `mock-bot-${++this.#seq}`,
      role: "assistant",
      speaker: speaker.name,
      speakerId: speaker.id,
      text,
      timestampMs: Date.now(),
    });
    this.#transcripts.set(agent.id, existing);
  }

  #scheduleGroupReplies(agent: Agent, prompt: string): void {
    const members = groupMembers(agent);
    for (const member of members) {
      const row = this.#agents.find((item) => item.id === member.id);
      if (row) row.isRunning = true;
    }
    void (async () => {
      try {
        await delay(this.#replyDelayMs);
      } catch {
        return;
      }
      for (const member of members) {
        const row = this.#agents.find((item) => item.id === member.id);
        if (row) row.isRunning = false;
        this.#pushAssistant(agent, member, `${member.name} here. I received: ${prompt}`);
      }
    })();
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
      if (agent.isGroup) this.#scheduleGroupReplies(agent, input.prompt);
      return { accepted: true, status: "idle", elapsedMs: Date.now() - startedAt };
    }

    try {
      await delay(this.#replyDelayMs, undefined, { signal: input.signal });
    } catch {
      agent.isRunning = false;
      return { accepted: true, status: "cancelled", elapsedMs: Date.now() - startedAt };
    }

    if (agent.isGroup) {
      const members = groupMembers(agent);
      let reply = "";
      for (const member of members) {
        reply = `${member.name} here. I received: ${input.prompt}`;
        this.#pushAssistant(agent, member, reply);
      }
      agent.isRunning = false;
      return {
        accepted: true,
        status: "idle",
        reply,
        elapsedMs: Date.now() - startedAt,
      };
    }

    const reply = this.#replyFor(input.prompt, agent);
    this.#pushAssistant(agent, { id: agent.id, name: agent.name }, reply);
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
