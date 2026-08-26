import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { redact } from "../redact.js";
import { fetchBytesWithHeaders, hydrateTurnImages } from "./attachments.js";
import { isNotFoundError, mapHostError } from "./errors.js";
import { gatewayPost, trimGatewayUrl, type GatewaySession } from "./http.js";
import { rosterCacheKey } from "./rosterCache.js";
import {
  asAgentRow,
  assistantCount,
  enrichRoster,
  lastAssistantText,
  turnsFromHostTranscript,
  unwrapAgentList,
} from "./transcript.js";
import {
  DEFAULT_TRANSCRIPT_LIMIT,
  HostClientError,
  type Agent,
  type ChatTurn,
  type GetTranscriptOptions,
  type HostClient,
  type HostSource,
  type SendPromptInput,
  type SendResult,
} from "./types.js";

export type HttpHostOptions = GatewaySession & {
  source?: HostSource;
  fetch?: typeof fetch;
};

function sessionSecrets(session: GatewaySession): string[] {
  const values = [session.token];
  for (const value of Object.values(session.headers ?? {})) {
    if (value) values.push(value);
  }
  return values;
}

function mapSessionError(err: unknown, session: GatewaySession): HostClientError {
  const mapped = mapHostError(err, session.token);
  let message = mapped.message;
  for (const secret of sessionSecrets(session)) {
    message = redact(message, secret);
  }
  if (message === mapped.message) return mapped;
  return new HostClientError(mapped.kind, message, mapped.status != null ? { status: mapped.status } : undefined);
}

/**
 * Host client over our POST helper. Used for env URL+token and the desktop session.
 * Connectivity is listAgents — there is no health probe.
 */
export class HttpHostClient implements HostClient {
  readonly source: HostSource;
  readonly rosterCacheKey: string;
  readonly #session: GatewaySession;
  readonly #fetch?: typeof fetch;
  /** Coalesce concurrent listAgents calls — the gateway is slow and callers overlap. */
  #listAgentsInflight: Promise<Agent[]> | null = null;

  constructor(options: HttpHostOptions) {
    this.source = options.source ?? "gateway";
    const gatewayUrl = trimGatewayUrl(options.gatewayUrl);
    this.#session = {
      gatewayUrl,
      token: options.token,
      headers: options.headers ?? {},
    };
    const credentialId = createHash("sha256").update(options.token).digest("hex").slice(0, 16);
    this.rosterCacheKey = rosterCacheKey(gatewayUrl, credentialId);
    this.#fetch = options.fetch;
  }

  #fetchImpl(): typeof fetch {
    return this.#fetch ?? ((input, init) => globalThis.fetch(input, init));
  }

  #call(method: string, body: unknown = {}, signal?: AbortSignal): Promise<unknown> {
    return gatewayPost(this.#session, method, body, this.#fetchImpl(), signal);
  }

  async listAgents(): Promise<Agent[]> {
    if (this.#listAgentsInflight) return this.#listAgentsInflight;
    this.#listAgentsInflight = this.#fetchAgents().finally(() => {
      this.#listAgentsInflight = null;
    });
    return this.#listAgentsInflight;
  }

  async #fetchAgents(): Promise<Agent[]> {
    try {
      const data = await this.#call("listAgents", {});
      const agents: Agent[] = [];
      for (const row of unwrapAgentList(data)) {
        const agent = asAgentRow(row);
        if (agent) agents.push(agent);
      }
      return enrichRoster(agents);
    } catch (err) {
      throw mapSessionError(err, this.#session);
    }
  }

  async getTranscript(
    agentId: string,
    limit = DEFAULT_TRANSCRIPT_LIMIT,
    options: GetTranscriptOptions = {},
  ): Promise<ChatTurn[]> {
    try {
      const payload = await this.#call("getAgentTranscriptTail", { id: agentId, limit });
      const turns = turnsFromHostTranscript(payload);
      if (options.hydrate === false) return turns;
      return await this.hydrateTranscript(agentId, turns);
    } catch (err) {
      throw mapSessionError(err, this.#session);
    }
  }

  async hydrateTranscript(agentId: string, turns: ChatTurn[]): Promise<ChatTurn[]> {
    try {
      const token = this.#session.token;
      const extra = this.#session.headers ?? {};
      return await hydrateTurnImages(agentId, turns, {
        call: (method, body) => this.#call(method, body),
        fetchUrl: (url) =>
          fetchBytesWithHeaders(url, {
            authorization: `Bearer ${token}`,
            ...extra,
          }),
      });
    } catch (err) {
      throw mapSessionError(err, this.#session);
    }
  }

  async sendPrompt(input: SendPromptInput): Promise<SendResult> {
    const wait = input.wait !== false;
    const startedAt = Date.now();
    let beforeCount = 0;
    let beforeReply: string | undefined;
    let interruptIssued = false;
    const maybeInterrupt = async (): Promise<void> => {
      if (interruptIssued) return;
      interruptIssued = true;
      await this.interrupt(input.agentId).catch(() => undefined);
    };
    const onAbort = (): void => {
      void maybeInterrupt();
    };
    input.signal?.addEventListener("abort", onAbort, { once: true });
    try {
      if (wait) {
        const prior = await this.getTranscript(input.agentId, DEFAULT_TRANSCRIPT_LIMIT, {
          hydrate: false,
        });
        beforeCount = assistantCount(prior);
        beforeReply = lastAssistantText(prior);
        if (input.signal?.aborted) {
          await maybeInterrupt();
          return { accepted: true, status: "cancelled", elapsedMs: Date.now() - startedAt };
        }
      }
      const sent = await this.#call(
        "sendPrompt",
        {
          agentId: input.agentId,
          prompt: input.prompt,
          clientNonce: randomUUID(),
        },
        input.signal,
      );
      const accepted =
        sent != null && typeof sent === "object" && "accepted" in sent
          ? (sent as { accepted?: boolean }).accepted !== false
          : true;

      if (!wait) {
        return { accepted, status: "idle", elapsedMs: Date.now() - startedAt };
      }

      if (input.signal?.aborted) {
        await maybeInterrupt();
        return { accepted: true, status: "cancelled", elapsedMs: Date.now() - startedAt };
      }

      const reply = await this.#waitForReply(input, beforeCount, beforeReply, maybeInterrupt);
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
        await maybeInterrupt();
        return { accepted: true, status: "cancelled", elapsedMs: Date.now() - startedAt };
      }
      throw mapSessionError(err, this.#session);
    } finally {
      input.signal?.removeEventListener("abort", onAbort);
    }
  }

  async interrupt(agentId: string): Promise<{ hadActiveRun: boolean }> {
    try {
      const result = (await this.#call("interruptAgentRun", { id: agentId })) as {
        hadActiveRun?: boolean;
      };
      return { hadActiveRun: result?.hadActiveRun === true };
    } catch (err) {
      if (isNotFoundError(err)) return { hadActiveRun: false };
      throw mapSessionError(err, this.#session);
    }
  }

  async #waitForReply(
    input: SendPromptInput,
    beforeCount: number,
    beforeReply: string | undefined,
    maybeInterrupt: () => Promise<void>,
  ): Promise<{ status: SendResult["status"]; text?: string }> {
    const timeoutMs = input.timeoutMs;
    const startedAt = Date.now();
    const cancel = async (): Promise<{ status: "cancelled" }> => {
      await maybeInterrupt();
      return { status: "cancelled" };
    };
    while (true) {
      if (input.signal?.aborted) return cancel();
      const turns = await this.getTranscript(input.agentId, DEFAULT_TRANSCRIPT_LIMIT, {
        hydrate: false,
      });
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
        return cancel();
      }
    }
  }
}
