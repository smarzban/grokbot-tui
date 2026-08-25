import { errorMessage } from "../redact.js";
import { GatewayHttpError } from "./http.js";
import { HostClientError, type HostErrorKind } from "./types.js";

function codeOf(err: unknown): string | undefined {
  if (err != null && typeof err === "object" && "code" in err) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  const cause = err instanceof Error ? err.cause : undefined;
  if (cause != null && typeof cause === "object" && "code" in cause) {
    const code = (cause as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return undefined;
}

function httpStatus(err: unknown): number | undefined {
  if (err instanceof GatewayHttpError) return err.status;
  if (err != null && typeof err === "object" && "status" in err) {
    const status = (err as { status?: unknown }).status;
    if (typeof status === "number" && Number.isFinite(status)) return status;
  }
  return undefined;
}

export function isNotFoundError(err: unknown): boolean {
  const status = err instanceof HostClientError ? err.status : httpStatus(err);
  if (status === 404) return true;
  const message = err instanceof Error ? err.message : String(err);
  return /\b404\b/.test(message);
}

export function mapHostError(err: unknown, secret?: string): HostClientError {
  if (err instanceof HostClientError) return err;

  const message = errorMessage(err, secret);
  const code = codeOf(err);
  const status = httpStatus(err);
  const lowered = message.toLowerCase();

  let kind: HostErrorKind = "unknown";

  if (status === 401 || status === 403) {
    kind = "unauthorized";
  } else if (status != null && status >= 500) {
    kind = "host-down";
  } else if (
    code === "ECONNREFUSED" ||
    code === "ENOTFOUND" ||
    code === "ECONNRESET" ||
    code === "ETIMEDOUT" ||
    code === "UND_ERR_SOCKET" ||
    /fetch failed|econnrefused|network|socket/i.test(lowered)
  ) {
    kind = "host-down";
  } else if (/unauthorized|401|403|missing.+token|no token|not found.*gateway/i.test(lowered)) {
    kind = /401|403|unauthorized/i.test(lowered) ? "unauthorized" : "missing-auth";
  } else if (/aborted|abort/.test(lowered)) {
    kind = "unknown";
  }

  return new HostClientError(kind, message, status != null ? { status } : undefined);
}

export const MISSING_AUTH_MESSAGE =
  "No gateway token. Set SAND_GATEWAY_TOKEN (and GROKBOT_GATEWAY_URL if you are not on the Grok Bot computer), or open the Grok Bot desktop app and Allow Keychain access.";

export const HOST_DOWN_MESSAGE =
  "The Grok Bot host is not reachable. Start the host, check the tunnel, or run with --mock.";
