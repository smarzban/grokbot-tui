import { GrokBot } from "@adam91holt/grokbot-sdk";
import { mapHostError } from "./errors.js";
import { asAgentRow, turnsFromHostTranscript, unwrapAgentList } from "./transcript.js";
import type { Agent, ChatTurn, Health, HostClient, HostSource, SendPromptInput, SendResult } from "./types.js";

export class GatewayHostClient implements HostClient {
  readonly source: HostSource;
  readonly bot: GrokBot;
  readonly #secret?: string;

  constructor(bot: GrokBot, source: HostSource = "gateway", secret?: string) {
    this.bot = bot;
    this.source = source;
    this.#secret = secret;
  }

  async health(): Promise<Health> {
    try {
      const health = await this.bot.health();
      return {
        ok: health.ok !== false,
        busy: health.isBusy,
        activeAgentId: health.activeAgentId ?? null,
      };
    } catch (err) {
      throw mapHostError(err, this.#secret);
    }
  }

  async listAgents(): Promise<Agent[]> {
    try {
      const raw = await this.bot.listAgents();
      const agents: Agent[] = [];
      for (const row of unwrapAgentList(raw)) {
        const agent = asAgentRow(row);
        if (agent && !agent.isGroup) agents.push(agent);
      }
      return agents;
    } catch (err) {
      throw mapHostError(err, this.#secret);
    }
  }

  async getTranscript(agentId: string, limit = 80): Promise<ChatTurn[]> {
    try {
      const payload = await this.bot.getAgentTranscriptTail({ id: agentId, limit });
      return turnsFromHostTranscript(payload);
    } catch (err) {
      throw mapHostError(err, this.#secret);
    }
  }

  async sendPrompt(input: SendPromptInput): Promise<SendResult> {
    const wait = input.wait !== false;
    const startedAt = Date.now();
    try {
      if (wait) {
        const result = await this.bot.sendPrompt({
          agentId: input.agentId,
          prompt: input.prompt,
          wait: true,
          timeoutMs: input.timeoutMs,
          intervalMs: 250,
          signal: input.signal,
        });
        const status =
          result.status === "idle" ||
          result.status === "awaiting-user" ||
          result.status === "timeout" ||
          result.status === "error"
            ? result.status
            : "idle";
        return {
          accepted: result.accepted !== false,
          status,
          ...(typeof result.reply === "string" ? { reply: result.reply } : {}),
          elapsedMs: typeof result.elapsedMs === "number" ? result.elapsedMs : Date.now() - startedAt,
        };
      }

      const sent = await this.bot.sendPrompt({
        agentId: input.agentId,
        prompt: input.prompt,
      });
      return {
        accepted: sent.accepted,
        status: "idle",
        elapsedMs: Date.now() - startedAt,
      };
    } catch (err) {
      if (input.signal?.aborted) {
        try {
          await this.bot.interruptAgentRun({ id: input.agentId });
        } catch {
          // Interrupt is best-effort; the wait is already cancelled.
        }
        return { accepted: true, status: "cancelled", elapsedMs: Date.now() - startedAt };
      }
      throw mapHostError(err, this.#secret);
    }
  }

  async interrupt(agentId: string): Promise<{ hadActiveRun: boolean }> {
    try {
      const result = await this.bot.interruptAgentRun({ id: agentId });
      return { hadActiveRun: result.hadActiveRun === true };
    } catch (err) {
      throw mapHostError(err, this.#secret);
    }
  }
}

export function createSdkBot(options: {
  gatewayUrl?: string;
  token?: string;
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
}): GrokBot {
  return new GrokBot({
    ...(options.gatewayUrl ? { gatewayUrl: options.gatewayUrl } : {}),
    ...(options.token ? { token: options.token } : {}),
    ...(options.env ? { env: options.env } : {}),
    ...(options.fetch ? { fetch: options.fetch } : {}),
    slimAvatars: true,
  });
}
