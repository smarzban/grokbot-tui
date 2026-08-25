/**
 * Redact secrets from strings that might be shown in the TUI or test output.
 * Never log or return the original secret.
 */
const BEARER = /Bearer\s+[A-Za-z0-9._\-]+/gi;
const TOKENISH =
  /\b(?:SAND_GATEWAY_TOKEN|GROK_BOT_GATEWAY_TOKEN|SAND_HOST_GATEWAY_TOKEN|CURSOR_ACCESS_TOKEN)\s*=\s*\S+/gi;
const ROUTING_HEADER = /x-anyrun-network-token\s*[:=]\s*\S+/gi;

export function redact(text: string, secret?: string): string {
  let out = text;
  if (secret != null && secret.length > 0) {
    out = out.split(secret).join("[redacted]");
  }
  return out
    .replace(BEARER, "Bearer [redacted]")
    .replace(TOKENISH, "[redacted]")
    .replace(ROUTING_HEADER, "x-anyrun-network-token [redacted]");
}

export function errorMessage(err: unknown, secret?: string): string {
  const raw = err instanceof Error ? err.message : String(err);
  return redact(raw, secret);
}
