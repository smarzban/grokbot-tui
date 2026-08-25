declare module "grok-bot-cli/src/gateway.js" {
  export class GatewayError extends Error {
    status?: number;
    method?: string;
    constructor(message: string, options?: { status?: number; method?: string });
  }

  export type GatewaySession = {
    gatewayUrl: string;
    gatewayToken: string;
    gatewayHeaders?: Record<string, string>;
  };

  export function hasGatewayAuth(): boolean;
  export function connectGateway(): Promise<GatewaySession>;
  export function gatewayCall(session: GatewaySession, method: string, body?: unknown): Promise<unknown>;
  export function listAgents(session: GatewaySession): Promise<unknown[]>;
  export function sendPrompt(
    session: GatewaySession,
    ref: string,
    prompt: string,
    extra?: { clientNonce?: string; replyToId?: string },
  ): Promise<{ target: { id: string; name: string; isGroup?: boolean }; result: unknown }>;
  export function getTranscriptTail(
    session: GatewaySession,
    ref: string,
    limit?: number,
  ): Promise<{ target: { id: string; name: string }; transcript: unknown }>;
}

declare module "grok-bot-cli/src/app-session.js" {
  export function hasGrokBotGatewaySession(options?: {
    platform?: NodeJS.Platform;
    home?: string;
  }): boolean;
  export function inspectGrokBotGatewaySession(options?: {
    platform?: NodeJS.Platform;
    home?: string;
  }): {
    present: boolean;
    usable: boolean;
    code?: string;
    error?: string;
  };
}
