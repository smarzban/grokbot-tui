export const DEFAULT_POLL_MS = 1500;
export const MIN_POLL_MS = 250;
/** Gap between completed roster polls. listAgents itself takes ~15s on desktop. */
export const DEFAULT_ROSTER_POLL_MS = 5_000;
/** After this many unchanged idle transcript polls, slow down further. */
export const IDLE_POLL_STABLE_TICKS = 4;
/** Backoff interval when the transcript has been quiet. */
export const IDLE_POLL_BACKOFF_MS = 4_000;

/** Default cap on 1:1 wait-for-reply. Esc still cancels earlier. */
export const DEFAULT_WAIT_TIMEOUT_MS = 600_000;

/** Parse `GROK_TUI_POLL_MS`. Invalid or missing values fall back to the default. */
export function parsePollMs(raw: string | undefined, fallback = DEFAULT_POLL_MS): number {
  if (raw == null || raw.trim() === "") return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < MIN_POLL_MS) return fallback;
  return n;
}

export type TranscriptPollPaceInput = {
  /** Idle baseline from config / GROK_TUI_POLL_MS. */
  idleMs: number;
  /** True while sending/waiting or the answering line is lit. */
  busy: boolean;
  /** Consecutive idle polls with no applied transcript change. */
  unchangedTicks: number;
};

/**
 * Transcript poll delay: 250ms when busy, idle baseline, then backoff after
 * IDLE_POLL_STABLE_TICKS quiet ticks. Roster poll is separate and stays fixed.
 */
export function transcriptPollDelayMs(input: TranscriptPollPaceInput): number {
  if (input.busy) return MIN_POLL_MS;
  const idle = Math.max(input.idleMs, MIN_POLL_MS);
  if (input.unchangedTicks >= IDLE_POLL_STABLE_TICKS) {
    return Math.max(idle, IDLE_POLL_BACKOFF_MS);
  }
  return idle;
}

/** Busy for adaptive transcript poll: in-flight send or answering/working line. */
export function isTranscriptPollBusy(statusKind: string, answering: boolean): boolean {
  return answering || statusKind === "sending" || statusKind === "loading";
}

/**
 * Parse `GROK_TUI_WAIT_TIMEOUT_MS`.
 * - unset/invalid → fallback (default 10 minutes)
 * - exact `0` → unlimited (returns undefined; Esc still cancels)
 * - positive integer → that many ms
 * Fractional or garbage prefixes (`0.5`, `0ms`) are invalid, not unlimited.
 */
export function parseWaitTimeoutMs(
  raw: string | undefined,
  fallback = DEFAULT_WAIT_TIMEOUT_MS,
): number | undefined {
  if (raw == null || raw.trim() === "") return fallback;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return fallback;
  const n = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(n) || n < 0) return fallback;
  if (n === 0) return undefined;
  return n;
}
