import { DEFAULT_POLL_MS, MIN_POLL_MS, parsePollMs } from "../timing.js";
import type { ChatTurn } from "../client/types.js";

export { DEFAULT_POLL_MS, MIN_POLL_MS, parsePollMs };

/** Poll while viewing chat; never while the initial load or an in-flight send is running. */
export function shouldPollTranscript(kind: string): boolean {
  return kind !== "sending" && kind !== "loading";
}

function imageSig(turn: ChatTurn): string {
  return (turn.images ?? [])
    .map((image) => `${image.alt ?? ""}\0${image.path ?? ""}\0${image.mime ?? ""}`)
    .join("\x01");
}

function turnSig(turn: ChatTurn): string {
  return `${turn.id}\0${turn.role}\0${turn.speaker}\0${turn.text}\0${imageSig(turn)}`;
}

/** True when a polled snapshot is worth replacing the on-screen turns. */
export function transcriptChanged(prev: ChatTurn[], next: ChatTurn[]): boolean {
  if (prev.length !== next.length) return true;
  for (let i = 0; i < prev.length; i++) {
    const a = prev[i];
    const b = next[i];
    if (a == null || b == null || turnSig(a) !== turnSig(b)) return true;
  }
  return false;
}
