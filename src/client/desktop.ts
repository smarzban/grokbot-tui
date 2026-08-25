/**
 * Desktop-app session path used by grok-bot-cli (`gbot`).
 *
 * The macOS Grok Bot app stores an encrypted gateway descriptor. After the
 * user allows Keychain ("Grok Bot Safe Storage"), grok-bot-cli decrypts it
 * to `{ gatewayUrl, gatewayToken, gatewayHeaders }`. Those headers often
 * include routing (e.g. x-anyrun-network-token). The URL may include a path.
 *
 * Do not feed this session into @adam91holt/grokbot-sdk: the SDK strips URL
 * path, omits session headers, and probes unauthenticated GET /health — all
 * of which 404 on the routed desktop gateway. Talk the same way `gbot` does:
 * POST `{gatewayUrl}/api/{method}` with Bearer + session headers.
 *
 * Token, descriptor payloads, and header values stay in memory. Never log them.
 */
import { setTimeout as delay } from "node:timers/promises";
import {
  gatewayCall,
  getTranscriptTail,
  sendPrompt as cliSendPrompt,
} from "grok-bot-cli/src/gateway.js";
import { fetchBytesWithHeaders, hydrateTurnImages } from "./attachments.js";
import { redact } from "../redact.js";
import { isNotFoundError, mapHostError } from "./errors.js";
import {
  asAgentRow,
  assistantCount,
  enrichRoster,
  lastAssistantText,
  turnsFromHostTranscript,
  unwrapAgentList,
} from "./transcript.js";
import type { Agent, ChatTurn, Health, HostClient, SendPromptInput, SendResult } from "./types.js";
import { DEFAULT_TRANSCRIPT_LIMIT, HostClientError } from "./types.js";

export type DesktopSession = {
  gatewayUrl: string;
  token: string;
  headers: Record<string, string>;
};

type CliSession = {
  gatewayUrl: string;
  gatewayToken: string;
  gatewayHeaders?: Record<string, string>;
};

function toCliSession(session: DesktopSession): CliSession {
  return {
    gatewayUrl: session.gatewayUrl.replace(/\/$/, ""),
    gatewayToken: session.token,
    gatewayHeaders: session.headers,
  };
}

function secretsOf(session: CliSession): string[] {
  const values = [session.gatewayToken];
  for (const value of Object.values(session.gatewayHeaders ?? {})) {
    if (value) values.push(value);
  }
  return values;
}

function mapDesktopError(err: unknown, session: CliSession): HostClientError {
  const mapped = mapHostError(err, session.gatewayToken);
  let message = mapped.message;
  for (const secret of secretsOf(session)) {
    message = redact(message, secret);
  }
  if (message === mapped.message) return mapped;
  return new HostClientError(mapped.kind, message, mapped.status != null ? { status: mapped.status } : undefined);
}

export async function loadDesktopSession(): Promise<DesktopSession | null> {
  try {
    const gw = await import("grok-bot-cli/src/gateway.js");
    if (typeof gw.hasGatewayAuth !== "function" || !gw.hasGatewayAuth()) {
      return null;
    }
    const session = await gw.connectGateway();
    // Same trailing-slash trim as gbot. Do not strip the URL path.
    const gatewayUrl = session.gatewayUrl?.replace(/\/$/, "");
    const token = session.gatewayToken;
    if (!gatewayUrl || !token) return null;
    return {
      gatewayUrl,
      token,
      headers: session.gatewayHeaders ?? {},
    };
  } catch {
    return null;
  }
}

export async function inspectDesktopSession(): Promise<{ present: boolean; usable: boolean }> {
  try {
    const app = await import("grok-bot-cli/src/app-session.js");
    const info = app.inspectGrokBotGatewaySession();
    return { present: Boolean(info.present), usable: Boolean(info.usable) };
  } catch {
    return { present: false, usable: false };
  }
}

/**
 * Host client for the Grok Bot desktop-app session. Uses grok-bot-cli
 * connectGateway / listAgents / sendPrompt / getTranscriptTail / gatewayCall.
 */
export class DesktopHostClient implements HostClient {
  readonly source = "desktop" as const;
  readonly #session: CliSession;

  constructor(session: DesktopSession) {
    this.#session = toCliSession(session);
  }

  /**
   * The routed desktop gateway often has no GET /health (gbot never calls it).
   * Boot must not treat a missing health endpoint as fatal.
   */
  async health(): Promise<Health> {
    return { ok: true };
  }

  async listAgents(): Promise<Agent[]> {
    try {
      // Raw listAgents — grok-bot-cli's asRecord drops isRunning / isComposingMessage.
      const data = await gatewayCall(this.#session, "listAgents", {});
      const agents: Agent[] = [];
      for (const row of unwrapAgentList(data)) {
        const agent = asAgentRow(row);
        if (agent) agents.push(agent);
      }
      return enrichRoster(agents);
    } catch (err) {
      throw mapDesktopError(err, this.#session);
    }
  }

  async getTranscript(agentId: string, limit = DEFAULT_TRANSCRIPT_LIMIT): Promise<ChatTurn[]> {
    try {
      const out = await getTranscriptTail(this.#session, agentId, limit);
      const turns = turnsFromHostTranscript(out.transcript);
      return await hydrateTurnImages(agentId, turns, {
        call: (method, body) => gatewayCall(this.#session, method, body),
        fetchUrl: (url) =>
          fetchBytesWithHeaders(url, {
            authorization: `Bearer ${this.#session.gatewayToken}`,
            ...this.#session.gatewayHeaders,
          }),
      });
    } catch (err) {
      throw mapDesktopError(err, this.#session);
    }
  }

  async sendPrompt(input: SendPromptInput): Promise<SendResult> {
    const wait = input.wait !== false;
    const startedAt = Date.now();
    let beforeCount = 0;
    let beforeReply: string | undefined;
    try {
      if (wait) {
        const prior = await this.getTranscript(input.agentId);
        beforeCount = assistantCount(prior);
        beforeReply = lastAssistantText(prior);
      }
      const sent = await cliSendPrompt(this.#session, input.agentId, input.prompt);
      const accepted =
        sent.result != null &&
        typeof sent.result === "object" &&
        "accepted" in sent.result
          ? (sent.result as { accepted?: boolean }).accepted !== false
          : true;

      if (!wait) {
        return { accepted, status: "idle", elapsedMs: Date.now() - startedAt };
      }

      const reply = await this.#waitForReply(input, beforeCount, beforeReply);
      if (reply.status === "cancelled") {
        return { accepted: true, status: "cancelled", elapsedMs: Date.now() - startedAt };
      }
      return {
        accepted,
        status: reply.status,
        ...(reply.text ? { reply: reply.text } : {}),
        elapsedMs: Date.now() - startedAt,
      };
    } catch (err) {
      if (input.signal?.aborted) {
        await this.interrupt(input.agentId).catch(() => undefined);
        return { accepted: true, status: "cancelled", elapsedMs: Date.now() - startedAt };
      }
      throw mapDesktopError(err, this.#session);
    }
  }

  async interrupt(agentId: string): Promise<{ hadActiveRun: boolean }> {
    try {
      const result = (await gatewayCall(this.#session, "interruptAgentRun", { id: agentId })) as {
        hadActiveRun?: boolean;
      };
      return { hadActiveRun: result?.hadActiveRun === true };
    } catch (err) {
      if (isNotFoundError(err)) return { hadActiveRun: false };
      throw mapDesktopError(err, this.#session);
    }
  }

  async #waitForReply(
    input: SendPromptInput,
    beforeCount: number,
    beforeReply: string | undefined,
  ): Promise<{ status: SendResult["status"]; text?: string }> {
    const timeoutMs = input.timeoutMs;
    const startedAt = Date.now();
    while (true) {
      if (input.signal?.aborted) {
        await this.interrupt(input.agentId).catch(() => undefined);
        return { status: "cancelled" };
      }
      const turns = await this.getTranscript(input.agentId);
      const count = assistantCount(turns);
      const text = lastAssistantText(turns);
      if (count > beforeCount || (text != null && text !== beforeReply)) {
        return { status: "idle", ...(text ? { text } : {}) };
      }
      if (timeoutMs != null && Date.now() - startedAt >= timeoutMs) {
        return { status: "timeout", ...(text ? { text } : {}) };
      }
      try {
        await delay(250, undefined, { signal: input.signal });
      } catch {
        await this.interrupt(input.agentId).catch(() => undefined);
        return { status: "cancelled" };
      }
    }
  }
}
