export const DEFAULT_POLL_MS = 1500;
export const MIN_POLL_MS = 250;

/** Default cap on 1:1 wait-for-reply. Esc still cancels earlier. */
export const DEFAULT_WAIT_TIMEOUT_MS = 600_000;

/** Parse `GROK_TUI_POLL_MS`. Invalid or missing values fall back to the default. */
export function parsePollMs(raw: string | undefined, fallback = DEFAULT_POLL_MS): number {
  if (raw == null || raw.trim() === "") return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < MIN_POLL_MS) return fallback;
  return n;
}

/**
 * Parse `GROK_TUI_WAIT_TIMEOUT_MS`.
 * - unset/invalid → fallback (default 10 minutes)
 * - `0` → unlimited (returns undefined; Esc still cancels)
 * - positive → that many ms
 */
export function parseWaitTimeoutMs(
  raw: string | undefined,
  fallback = DEFAULT_WAIT_TIMEOUT_MS,
): number | undefined {
  if (raw == null || raw.trim() === "") return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return fallback;
  if (n === 0) return undefined;
  return n;
}
