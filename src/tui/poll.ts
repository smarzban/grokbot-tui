import type { ChatTurn } from "../client/types.js";

export const DEFAULT_POLL_MS = 1500;
export const MIN_POLL_MS = 250;

export function parsePollMs(raw: string | undefined, fallback = DEFAULT_POLL_MS): number {
  if (raw == null || raw.trim() === "") return fallback;
  const n = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(n) || n < MIN_POLL_MS) return fallback;
  return n;
}

/** Poll while viewing chat; never while the initial load or an in-flight send is running. */
export function shouldPollTranscript(kind: string): boolean {
  return kind !== "sending" && kind !== "loading";
}

function imageSig(turn: ChatTurn): string {
  return (turn.images ?? [])
    .map((image) => `${image.alt ?? ""}\0${image.path ?? ""}\0${image.mime ?? ""}`)
    .join("\x01");
}

/** True when a polled snapshot is worth replacing the on-screen turns. */
export function transcriptChanged(prev: ChatTurn[], next: ChatTurn[]): boolean {
  if (prev.length !== next.length) return true;
  const a = prev.at(-1);
  const b = next.at(-1);
  if (a == null && b == null) return false;
  if (a == null || b == null) return true;
  return a.id !== b.id || a.text !== b.text || a.role !== b.role || imageSig(a) !== imageSig(b);
}
