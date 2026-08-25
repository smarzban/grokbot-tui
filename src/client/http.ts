/**
 * Owned POST to `{gatewayUrl}/api/{method}`.
 * Keeps the URL path; only a trailing slash is trimmed. Never logs tokens or headers.
 */

export type GatewaySession = {
  gatewayUrl: string;
  token: string;
  headers?: Record<string, string>;
};

export class GatewayHttpError extends Error {
  readonly status?: number;
  readonly method?: string;

  constructor(message: string, options?: { status?: number; method?: string }) {
    super(message);
    this.name = "GatewayHttpError";
    if (options?.status != null) this.status = options.status;
    if (options?.method) this.method = options.method;
  }
}

export function trimGatewayUrl(url: string): string {
  return url.replace(/\/$/, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { raw: text };
  }
}

function errorDetail(data: unknown, fallback: string): string {
  if (typeof data === "string" && data.length > 0) return data;
  if (isRecord(data)) {
    if (typeof data.message === "string" && data.message.length > 0) return data.message;
    if (typeof data.error === "string" && data.error.length > 0) return data.error;
    if (typeof data.raw === "string" && data.raw.length > 0) return data.raw;
  }
  return fallback;
}

export async function gatewayPost(
  session: GatewaySession,
  method: string,
  body: unknown = {},
  fetchImpl: typeof fetch = globalThis.fetch,
  signal?: AbortSignal,
): Promise<unknown> {
  const url = `${trimGatewayUrl(session.gatewayUrl)}/api/${method}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${session.token}`,
    "Content-Type": "application/json",
    ...(session.headers ?? {}),
  };
  const res = await fetchImpl(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body ?? {}),
    ...(signal ? { signal } : {}),
  });
  const data = await readJson(res);
  if (!res.ok) {
    const detail = errorDetail(data, res.statusText);
    throw new GatewayHttpError(`${method} failed: ${res.status} ${String(detail).slice(0, 300)}`, {
      status: res.status,
      method,
    });
  }
  return data;
}
