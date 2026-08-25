/**
 * Desktop-app session path used by grok-bot-cli (`gbot`).
 * Reads the Grok Bot macOS app's encrypted gateway descriptor — we never
 * invent that protocol; we call the published package.
 *
 * The returned token stays in memory. Do not log it.
 */
export type DesktopSession = {
  gatewayUrl: string;
  token: string;
};

export async function loadDesktopSession(): Promise<DesktopSession | null> {
  try {
    const gw = await import("grok-bot-cli/src/gateway.js");
    if (typeof gw.hasGatewayAuth !== "function" || !gw.hasGatewayAuth()) {
      return null;
    }
    const session = await gw.connectGateway();
    const gatewayUrl = session.gatewayUrl?.replace(/\/$/, "");
    const token = session.gatewayToken;
    if (!gatewayUrl || !token) return null;
    return { gatewayUrl, token };
  } catch {
    return null;
  }
}

export async function inspectDesktopSession(): Promise<{ present: boolean; usable: boolean }> {
  try {
    const app = await import("grok-bot-cli/src/app-session.js");
    const info = app.inspectGrokBotGatewaySession();
    return { present: Boolean(info.present), usable: Boolean(info.usable) };
  } catch {
    return { present: false, usable: false };
  }
}
