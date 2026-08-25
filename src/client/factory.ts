import { defaultLocalGatewayUrl, type AppConfig } from "../config.js";
import { DesktopHostClient, loadDesktopSession, type DesktopSession } from "./desktop.js";
import { MISSING_AUTH_MESSAGE } from "./errors.js";
import { HttpHostClient } from "./host.js";
import { MockHostClient, type MockHostOptions } from "./mock.js";
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
 * Prefer env URL+token (same POST helper as desktop). Else the macOS Grok Bot
 * app session. Mock stays `--mock`. Never probes GET /health.
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

  if (gatewayUrl || token) {
    if (!token) {
      throw new HostClientError("missing-auth", MISSING_AUTH_MESSAGE);
    }
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
    return new DesktopHostClient(desktop, { fetch: options.fetch });
  }

  throw new HostClientError("missing-auth", MISSING_AUTH_MESSAGE);
}
