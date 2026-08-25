import { config as loadDotenv } from "dotenv";
import { DEFAULT_WAIT_TIMEOUT_MS, parsePollMs, parseWaitTimeoutMs } from "./timing.js";

/** Canonical gateway env names. Legacy aliases log a one-time deprecation warning. */
export const GATEWAY_URL_KEY = "GROKBOT_GATEWAY_URL";
export const GATEWAY_TOKEN_KEY = "GROKBOT_GATEWAY_TOKEN";
export const GATEWAY_PORT_KEY = "GROKBOT_GATEWAY_PORT";

const LEGACY_URL_KEYS = ["SAND_GATEWAY_URL", "GROK_BOT_GATEWAY_URL", "SAND_HOST_GATEWAY_URL"] as const;
const LEGACY_TOKEN_KEYS = ["SAND_GATEWAY_TOKEN", "GROK_BOT_GATEWAY_TOKEN", "SAND_HOST_GATEWAY_TOKEN"] as const;
const LEGACY_PORT_KEYS = ["SAND_HOST_PORT"] as const;

const deprecationWarned = new Set<string>();

function warnDeprecated(legacy: string, canonical: string): void {
  if (deprecationWarned.has(legacy)) return;
  deprecationWarned.add(legacy);
  process.stderr.write(`grok-tui: ${legacy} is deprecated; use ${canonical}\n`);
}

function firstNonEmpty(env: NodeJS.ProcessEnv, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value) return value;
  }
  return undefined;
}

function readGatewayUrl(env: NodeJS.ProcessEnv): string | undefined {
  const canonical = env[GATEWAY_URL_KEY]?.trim();
  if (canonical) return canonical;
  for (const key of LEGACY_URL_KEYS) {
    const value = env[key]?.trim();
    if (value) {
      warnDeprecated(key, GATEWAY_URL_KEY);
      return value;
    }
  }
  return undefined;
}

function readGatewayToken(env: NodeJS.ProcessEnv): string | undefined {
  const canonical = env[GATEWAY_TOKEN_KEY]?.trim();
  if (canonical) return canonical;
  for (const key of LEGACY_TOKEN_KEYS) {
    const value = env[key]?.trim();
    if (value) {
      warnDeprecated(key, GATEWAY_TOKEN_KEY);
      return value;
    }
  }
  return undefined;
}

function readGatewayPort(env: NodeJS.ProcessEnv): string {
  const canonical = env[GATEWAY_PORT_KEY]?.trim();
  if (canonical) return canonical;
  for (const key of LEGACY_PORT_KEYS) {
    const value = env[key]?.trim();
    if (value) {
      warnDeprecated(key, GATEWAY_PORT_KEY);
      return value;
    }
  }
  return "1340";
}

export type AppConfig = {
  /** Present only in memory. Never print. */
  gatewayUrl?: string;
  defaultAgent?: string;
  mock: boolean;
  waitTimeoutMs: number;
  pollIntervalMs: number;
};

export function loadDotEnvFile(): void {
  loadDotenv({ quiet: true });
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const gatewayUrl = readGatewayUrl(env);
  const defaultAgent = env.GROK_TUI_DEFAULT_AGENT?.trim() || undefined;
  const mock =
    env.GROK_TUI_MOCK === "1" ||
    env.GROK_TUI_MOCK === "true" ||
    env.GROK_TUI_MOCK === "yes";

  return {
    ...(gatewayUrl ? { gatewayUrl } : {}),
    ...(defaultAgent ? { defaultAgent } : {}),
    mock,
    waitTimeoutMs: parseWaitTimeoutMs(env.GROK_TUI_WAIT_TIMEOUT_MS, DEFAULT_WAIT_TIMEOUT_MS),
    pollIntervalMs: parsePollMs(env.GROK_TUI_POLL_MS),
  };
}

/** Token stays in-process. Callers must not log the return value. */
export function readToken(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return readGatewayToken(env);
}

export function defaultLocalGatewayUrl(env: NodeJS.ProcessEnv = process.env): string {
  const port = readGatewayPort(env);
  return `http://127.0.0.1:${port}`;
}

/** @internal Reset deprecation warnings between tests. */
export function resetConfigWarningsForTests(): void {
  deprecationWarned.clear();
}
