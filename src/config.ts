import { config as loadDotenv } from "dotenv";

const URL_KEYS = [
  "GROKBOT_GATEWAY_URL",
  "SAND_GATEWAY_URL",
  "GROK_BOT_GATEWAY_URL",
  "SAND_HOST_GATEWAY_URL",
] as const;

const TOKEN_KEYS = [
  "SAND_GATEWAY_TOKEN",
  "GROK_BOT_GATEWAY_TOKEN",
  "SAND_HOST_GATEWAY_TOKEN",
] as const;

function firstNonEmpty(env: NodeJS.ProcessEnv, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value) return value;
  }
  return undefined;
}

export type AppConfig = {
  /** Present only in memory. Never print. */
  gatewayUrl?: string;
  hasToken: boolean;
  defaultAgent?: string;
  mock: boolean;
  waitTimeoutMs?: number;
};

export type ResolvedSecrets = {
  token?: string;
};

export function loadDotEnvFile(): void {
  loadDotenv();
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const gatewayUrl = firstNonEmpty(env, URL_KEYS);
  const token = firstNonEmpty(env, TOKEN_KEYS);
  const defaultAgent = env.GROK_TUI_DEFAULT_AGENT?.trim() || undefined;
  const mock =
    env.GROK_TUI_MOCK === "1" ||
    env.GROK_TUI_MOCK === "true" ||
    env.GROK_TUI_MOCK === "yes";
  const waitRaw = env.GROK_TUI_WAIT_TIMEOUT_MS?.trim();
  const waitTimeoutMs = waitRaw ? Number.parseInt(waitRaw, 10) : undefined;

  return {
    ...(gatewayUrl ? { gatewayUrl } : {}),
    hasToken: Boolean(token),
    ...(defaultAgent ? { defaultAgent } : {}),
    mock,
    ...(waitTimeoutMs != null && Number.isFinite(waitTimeoutMs) && waitTimeoutMs > 0
      ? { waitTimeoutMs }
      : {}),
  };
}

/** Token stays in-process. Callers must not log the return value. */
export function readToken(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return firstNonEmpty(env, TOKEN_KEYS);
}

export function defaultLocalGatewayUrl(env: NodeJS.ProcessEnv = process.env): string {
  const port = env.SAND_HOST_PORT?.trim() || "1340";
  return `http://127.0.0.1:${port}`;
}
