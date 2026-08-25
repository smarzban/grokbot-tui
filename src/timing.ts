export const DEFAULT_POLL_MS = 1500;
export const MIN_POLL_MS = 250;

/** Parse `GROK_TUI_POLL_MS`. Invalid or missing values fall back to the default. */
export function parsePollMs(raw: string | undefined, fallback = DEFAULT_POLL_MS): number {
  if (raw == null || raw.trim() === "") return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < MIN_POLL_MS) return fallback;
  return n;
}
