import { defaultLocalGatewayUrl, type AppConfig } from "../config.js";
import { MISSING_AUTH_MESSAGE } from "./errors.js";
import { HttpHostClient } from "./host.js";
import { MockHostClient, type MockHostOptions } from "./mock.js";
import { loadDesktopSession, type DesktopSession } from "./session.js";
import { HostClientError, type HostClient } from "./types.js";

export type OpenClientOptions = {
  config: AppConfig;
  token?: string;
  env?: NodeJS.ProcessEnv;
  mock?: boolean;
  mockOptions?: MockHostOptions;
  fetch?: typeof fetch;
  loadDesktop?: () => Promise<DesktopSession | null>;
};

/**
 * Prefer env token (optional URL, else localhost). Else the macOS Grok Bot
 * desktop session. A URL without a token does not block desktop fallback.
 * Mock stays `--mock`.
 */
export async function openHostClient(options: OpenClientOptions): Promise<HostClient> {
  if (options.mock || options.config.mock) {
    return new MockHostClient(options.mockOptions);
  }

  const env = options.env ?? process.env;
  const token = options.token;
  const gatewayUrl = options.config.gatewayUrl;

  if (token) {
    return new HttpHostClient({
      gatewayUrl: gatewayUrl ?? defaultLocalGatewayUrl(env),
      token,
      source: "gateway",
      fetch: options.fetch,
    });
  }

  const loadDesktop = options.loadDesktop ?? loadDesktopSession;
  const desktop = await loadDesktop();
  if (desktop) {
    return new HttpHostClient({
      gatewayUrl: desktop.gatewayUrl,
      token: desktop.token,
      headers: desktop.headers,
      source: "desktop",
      fetch: options.fetch,
    });
  }

  throw new HostClientError("missing-auth", MISSING_AUTH_MESSAGE);
}
