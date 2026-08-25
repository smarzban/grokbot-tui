/**
 * Grok Bot desktop-app session (macOS). Decrypts the local gateway descriptor
 * and talks to the host with the same POST helper as env URL+token.
 */
import { HttpHostClient } from "./host.js";
import type { DesktopSession } from "./session.js";

export type { DesktopSession } from "./session.js";
export { loadDesktopSession } from "./session.js";

export class DesktopHostClient extends HttpHostClient {
  constructor(session: DesktopSession, options?: { fetch?: typeof fetch }) {
    super({
      gatewayUrl: session.gatewayUrl,
      token: session.token,
      headers: session.headers,
      source: "desktop",
      fetch: options?.fetch,
    });
  }
}
