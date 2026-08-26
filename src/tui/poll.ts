import { existsSync } from "node:fs";
import { isAbsFsPath } from "../client/attachments.js";
import type { ChatImage, ChatTurn } from "../client/types.js";
import { DEFAULT_POLL_MS, MIN_POLL_MS, parsePollMs } from "../timing.js";

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

function isLocalPendingTurn(turn: ChatTurn): boolean {
  return turn.id.startsWith("local-") && turn.role === "user";
}

function splitPendingTail(prev: ChatTurn[], next: ChatTurn[]): { committed: ChatTurn[]; pending: ChatTurn[] } {
  const pending: ChatTurn[] = [];
  for (let i = prev.length - 1; i >= 0; i--) {
    const turn = prev[i];
    if (!turn || !isLocalPendingTurn(turn)) break;
    const committedOnHost = next.some((host) => host.role === "user" && host.text === turn.text);
    if (committedOnHost) break;
    pending.unshift(turn);
  }
  return { committed: prev.slice(0, prev.length - pending.length), pending };
}

/** Apply a polled host tail while keeping uncommitted optimistic user turns. */
export function mergePolledTranscript(prev: ChatTurn[], next: ChatTurn[]): ChatTurn[] {
  const { committed, pending } = splitPendingTail(prev, next);

  let mergedHost: ChatTurn[];
  if (next.length <= committed.length) {
    const prefixLen = committed.length - next.length;
    const prefix = committed.slice(0, prefixLen);
    const oldTail = committed.slice(prefixLen);
    mergedHost = [...prefix, ...mergeImagePaths(oldTail, next)];
  } else {
    mergedHost = mergeImagePaths(committed, next);
  }

  const merged = pending.length === 0 ? mergedHost : [...mergedHost, ...pending];
  if (!transcriptChanged(prev, merged)) return prev;
  return merged;
}

function mergeImagePaths(from: ChatTurn[], onto: ChatTurn[]): ChatTurn[] {
  const fromById = new Map(from.map((turn) => [turn.id, turn]));
  let anyChanged = false;
  const result = onto.map((turn) => {
    const src = fromById.get(turn.id);
    if (!src?.images?.length || !turn.images?.length) return turn;
    let turnChanged = false;
    const images = turn.images.map((image, imageIndex) => {
      if (image.path) return image;
      const priorPath = src.images?.[imageIndex]?.path;
      if (!priorPath) return image;
      turnChanged = true;
      return { ...image, path: priorPath };
    });
    if (!turnChanged) return turn;
    anyChanged = true;
    return { ...turn, images };
  });
  return anyChanged ? result : onto;
}

/** Copy local paint paths from one transcript onto another (matched by turn id only). */
export function mergeImagePathsFrom(from: ChatTurn[], onto: ChatTurn[]): ChatTurn[] {
  return mergeImagePaths(from, onto);
}

/** True when hydrateTurnImages still needs to fetch bytes for this image ref. */
export function imageNeedsHydrate(image: ChatImage): boolean {
  const hasWireRef = Boolean(image.file_path || image.url);
  if (!image.path) return hasWireRef;
  if (hasWireRef) return false;
  if (!isAbsFsPath(image.path)) return false;
  try {
    return !existsSync(image.path);
  } catch {
    return true;
  }
}

/** True when a turn has host image refs that still need hydrateTurnImages. */
export function transcriptNeedsImageHydrate(turns: ChatTurn[]): boolean {
  return turns.some((turn) => (turn.images ?? []).some((image) => imageNeedsHydrate(image)));
}

/** Stable key for images that still need hydration — skip duplicate in-flight work. */
export function imageHydrateKey(turns: ChatTurn[]): string {
  const parts: string[] = [];
  for (const turn of turns) {
    for (const image of turn.images ?? []) {
      if (!imageNeedsHydrate(image)) continue;
      parts.push(
        image.id ??
          image.entryId ??
          image.file_path ??
          image.url ??
          image.path ??
          image.alt ??
          "?",
      );
    }
  }
  return parts.join("\0");
}
