import { GATEWAY_API_PREFIX, GATEWAY_AUTH_SCHEME, GATEWAY_HEALTH_PATH } from "@adam91holt/grokbot-sdk";
import type { AgentSummary, TranscriptTailResult } from "@adam91holt/grokbot-sdk";

export type ScriptedAgent = {
  id: string;
  name: string;
  isGroup?: boolean;
  isRunning?: boolean;
  isComposingMessage?: boolean;
  awaitingUserResponse?: unknown;
};

export type ScriptedHost = {
  token: string;
  down?: boolean;
  rejectAuth?: boolean;
  agents: ScriptedAgent[];
  transcripts: Map<string, unknown[]>;
  busyPollsRemaining: Map<string, number>;
};

const ADA: ScriptedAgent = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Ada",
  isGroup: false,
  isRunning: false,
  isComposingMessage: false,
  awaitingUserResponse: null,
};

export function createScriptedHost(overrides: Partial<ScriptedHost> = {}): ScriptedHost {
  return {
    token: "test-gateway-token",
    agents: [{ ...ADA }],
    transcripts: new Map([[ADA.id, []]]),
    busyPollsRemaining: new Map(),
    ...overrides,
    agents: (overrides.agents ?? [{ ...ADA }]).map((agent) => ({ ...agent })),
    transcripts: overrides.transcripts ?? new Map([[ADA.id, []]]),
    busyPollsRemaining: overrides.busyPollsRemaining ?? new Map(),
  };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function commandName(url: string): string {
  const parsed = new URL(url);
  const prefix = GATEWAY_API_PREFIX.endsWith("/") ? GATEWAY_API_PREFIX : `${GATEWAY_API_PREFIX}/`;
  if (parsed.pathname.startsWith(prefix)) {
    return parsed.pathname.slice(prefix.length);
  }
  return parsed.pathname;
}

function summary(agent: ScriptedAgent): AgentSummary {
  return {
    id: agent.id,
    name: agent.name,
    description: "",
    title: "",
    avatarDataUrl: null,
    avatarVersion: null,
    avatarShape: null,
    avatarColor: null,
    createdAt: 0,
    updatedAt: 0,
    path: "",
    isActive: false,
    isRunning: agent.isRunning === true,
    isComposingMessage: agent.isComposingMessage === true,
    lastEntry: null,
    lastMessageId: null,
    lastMessagePreview: null,
    lastMessageAuthorId: null,
    newestEntryId: null,
    hasUnread: false,
    unreadCount: 0,
    awaitingUserResponse: agent.awaitingUserResponse ?? null,
    notificationsEnabled: false,
    notifyOnUpdatesEnabled: false,
    isHiddenFromSidebar: false,
    origin: "user",
    isGroup: agent.isGroup === true,
    memberIds: [],
    conversationPartnerIds: [],
  };
}

export function createScriptedFetch(host: ScriptedHost): typeof fetch {
  const impl: typeof fetch = async (input, init) => {
    if (host.down) {
      const err = new TypeError("fetch failed");
      Object.assign(err, { cause: { code: "ECONNREFUSED" } });
      throw err;
    }

    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = new Headers(init?.headers);
    const parsed = new URL(url);

    if (method === "GET" && parsed.pathname === GATEWAY_HEALTH_PATH) {
      return json(200, {
        ok: true,
        pid: 1,
        isBusy: false,
        activeAgentId: null,
        startedAt: 0,
        lastBusyAtMs: null,
      });
    }

    const expectedAuth = `${GATEWAY_AUTH_SCHEME} ${host.token}`;
    if (host.rejectAuth || headers.get("authorization") !== expectedAuth) {
      return json(401, { error: "unauthorized" });
    }

    const command = commandName(url);
    const bodyText = typeof init?.body === "string" ? init.body : "";
    const body = bodyText ? (JSON.parse(bodyText) as Record<string, unknown>) : {};

    if (command === "listAgents") {
      for (const agent of host.agents) {
        const left = host.busyPollsRemaining.get(agent.id) ?? 0;
        if (left > 0) {
          agent.isRunning = true;
          host.busyPollsRemaining.set(agent.id, left - 1);
        } else {
          agent.isRunning = false;
        }
      }
      return json(200, host.agents.map(summary));
    }

    if (command === "getAsyncTasks" || command === "getSubagents") {
      return json(200, []);
    }

    if (command === "sendPrompt") {
      const agentId = String(body.agentId ?? "");
      const prompt = String(body.prompt ?? "");
      const agent = host.agents.find((row) => row.id === agentId);
      if (!agent) return json(404, { error: "unknown agent" });
      const entries = host.transcripts.get(agent.id) ?? [];
      entries.push({ kind: "message", role: "user", content: prompt, timestampMs: Date.now() });
      entries.push({
        kind: "message",
        role: "assistant",
        content: `Ada reply: ${prompt}`,
        timestampMs: Date.now(),
      });
      host.transcripts.set(agent.id, entries);
      host.busyPollsRemaining.set(agent.id, 1);
      agent.isRunning = true;
      return json(200, { accepted: true });
    }

    if (command === "getAgentTranscriptTail" || command === "getAgentTranscript") {
      const id = String(body.id ?? "");
      const entries = host.transcripts.get(id) ?? [];
      const payload: TranscriptTailResult = { entries };
      return json(200, payload);
    }

    if (command === "interruptAgentRun") {
      const id = String(body.id ?? "");
      const agent = host.agents.find((row) => row.id === id);
      const had = agent?.isRunning === true;
      if (agent) {
        agent.isRunning = false;
        host.busyPollsRemaining.set(agent.id, 0);
      }
      return json(200, { hadActiveRun: had });
    }

    return json(404, { error: `unknown command ${command}` });
  };
  return impl;
}

export const ADA_ID = ADA.id;
export const ADA_NAME = ADA.name;
