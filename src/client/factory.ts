import { discoverGateway, GrokBotGatewayError } from "@adam91holt/grokbot-sdk";
import { defaultLocalGatewayUrl, type AppConfig } from "../config.js";
import { loadDesktopSession } from "./desktop.js";
import { HOST_DOWN_MESSAGE, MISSING_AUTH_MESSAGE } from "./errors.js";
import { createSdkBot, GatewayHostClient } from "./host.js";
import { MockHostClient, type MockHostOptions } from "./mock.js";
import { HostClientError, type HostClient } from "./types.js";

export type OpenClientOptions = {
  config: AppConfig;
  token?: string;
  env?: NodeJS.ProcessEnv;
  mock?: boolean;
  mockOptions?: MockHostOptions;
  fetch?: typeof fetch;
  loadDesktop?: () => Promise<{ gatewayUrl: string; token: string } | null>;
};

function discoveryAvailable(env: NodeJS.ProcessEnv, gatewayUrl?: string): boolean {
  try {
    discoverGateway({ env, ...(gatewayUrl ? { gatewayUrl } : {}) });
    return true;
  } catch (err) {
    if (err instanceof GrokBotGatewayError) return false;
    return false;
  }
}

/**
 * Prefer the typed SDK when a gateway URL/token or gateway.json is available.
 * Fall back to grok-bot-cli's desktop-app session so a laptop with Grok Bot
 * open does not need a tunnel.
 */
export async function openHostClient(options: OpenClientOptions): Promise<HostClient> {
  if (options.mock || options.config.mock) {
    return new MockHostClient(options.mockOptions);
  }

  const env = options.env ?? process.env;
  const token = options.token;
  let gatewayUrl = options.config.gatewayUrl;

  if (!gatewayUrl && token) {
    gatewayUrl = defaultLocalGatewayUrl(env);
  }

  const canDiscover = discoveryAvailable(env, gatewayUrl);
  if (canDiscover || gatewayUrl || token) {
    const resolvedUrl = gatewayUrl;
    const hasToken = Boolean(token) || (canDiscover && discoverGateway({ env, gatewayUrl: resolvedUrl }).hasToken);
    if (!hasToken) {
      throw new HostClientError("missing-auth", MISSING_AUTH_MESSAGE);
    }
    const bot = createSdkBot({
      gatewayUrl: resolvedUrl,
      token,
      env,
      fetch: options.fetch,
    });
    return new GatewayHostClient(bot, "gateway", token);
  }

  const loadDesktop = options.loadDesktop ?? loadDesktopSession;
  const desktop = await loadDesktop();
  if (desktop) {
    const bot = createSdkBot({
      gatewayUrl: desktop.gatewayUrl,
      token: desktop.token,
      env,
      fetch: options.fetch,
    });
    return new GatewayHostClient(bot, "desktop", desktop.token);
  }

  throw new HostClientError("missing-auth", MISSING_AUTH_MESSAGE);
}

export function hostDownError(): HostClientError {
  return new HostClientError("host-down", HOST_DOWN_MESSAGE);
}
