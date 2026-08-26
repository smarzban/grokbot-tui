import { config as loadDotenv } from "dotenv";
import { DEFAULT_WAIT_TIMEOUT_MS, parsePollMs, parseWaitTimeoutMs } from "./timing.js";

/** Canonical gateway env names. Only these are read. */
export const GATEWAY_URL_KEY = "GROKBOT_GATEWAY_URL";
export const GATEWAY_TOKEN_KEY = "GROKBOT_GATEWAY_TOKEN";
export const GATEWAY_PORT_KEY = "GROKBOT_GATEWAY_PORT";

export type AppConfig = {
  /** Present only in memory. Never print. */
  gatewayUrl?: string;
  defaultAgent?: string;
  mock: boolean;
  /** Cap on 1:1 wait-for-reply. Absent means wait until Esc. Default 10 minutes. */
  waitTimeoutMs?: number;
  pollIntervalMs: number;
};

export function loadDotEnvFile(): void {
  loadDotenv({ quiet: true });
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const gatewayUrl = env[GATEWAY_URL_KEY]?.trim() || undefined;
  const defaultAgent = env.GROK_TUI_DEFAULT_AGENT?.trim() || undefined;
  const mock =
    env.GROK_TUI_MOCK === "1" ||
    env.GROK_TUI_MOCK === "true" ||
    env.GROK_TUI_MOCK === "yes";
  const waitTimeoutMs = parseWaitTimeoutMs(env.GROK_TUI_WAIT_TIMEOUT_MS, DEFAULT_WAIT_TIMEOUT_MS);

  return {
    ...(gatewayUrl ? { gatewayUrl } : {}),
    ...(defaultAgent ? { defaultAgent } : {}),
    mock,
    ...(waitTimeoutMs != null ? { waitTimeoutMs } : {}),
    pollIntervalMs: parsePollMs(env.GROK_TUI_POLL_MS),
  };
}

/** Token stays in-process. Callers must not log the return value. */
export function readToken(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const token = env[GATEWAY_TOKEN_KEY]?.trim();
  return token || undefined;
}

export function defaultLocalGatewayUrl(env: NodeJS.ProcessEnv = process.env): string {
  const port = env[GATEWAY_PORT_KEY]?.trim() || "1340";
  return `http://127.0.0.1:${port}`;
}
