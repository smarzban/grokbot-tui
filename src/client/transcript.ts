import { entriesFromTranscriptPayload, turnsFromTranscriptEntries } from "@adam91holt/grokbot-sdk";
import { basename } from "node:path";
import type { ChatImage, ChatTurn } from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

export function unwrapAgentList(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (isRecord(raw)) {
    if (Array.isArray(raw.agents)) return raw.agents;
    if (Array.isArray(raw.result)) return raw.result;
  }
  return [];
}

export function asAgentRow(value: unknown): {
  id: string;
  name: string;
  title?: string;
  isGroup: boolean;
  isRunning?: boolean;
} | null {
  if (!isRecord(value)) return null;
  const id = typeof value.id === "string" ? value.id : typeof value.agentId === "string" ? value.agentId : "";
  if (!id) return null;
  const name = typeof value.name === "string" && value.name.length > 0 ? value.name : id;
  const title = typeof value.title === "string" && value.title.length > 0 ? value.title : undefined;
  const memberIds = value.memberIds ?? value.memberAgentIds;
  const isGroup =
    value.isGroup === true || (value.isGroup == null && Array.isArray(memberIds) && memberIds.length > 0);
  const isRunning = typeof value.isRunning === "boolean" ? value.isRunning : undefined;
  return { id, name, ...(title ? { title } : {}), isGroup, ...(isRunning !== undefined ? { isRunning } : {}) };
}

function unwrapEntry(value: unknown): unknown {
  if (!isRecord(value)) return value;
  if (value.kind == null && "entry" in value) return value.entry;
  return value;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

/**
 * Build an image ref from documented host fields only:
 * `fileName` / `mime` / `ext` (search-index media rows) and
 * `attachmentPaths` / `attachmentNames` (sendPrompt).
 * Never treat query strings as display text.
 */
function imageFromRecord(rec: Record<string, unknown>): ChatImage | undefined {
  const names = stringList(rec.attachmentNames);
  const paths = stringList(rec.attachmentPaths);
  const fileName = typeof rec.fileName === "string" && rec.fileName.length > 0 ? rec.fileName : names[0];
  const mime = typeof rec.mime === "string" && rec.mime.length > 0 ? rec.mime : undefined;
  const pathOrUrl = paths[0];
  let path: string | undefined;
  let url: string | undefined;
  let alt = fileName;
  if (pathOrUrl) {
    if (isHttpUrl(pathOrUrl)) {
      url = pathOrUrl;
    } else {
      path = pathOrUrl;
      if (!alt) alt = basename(pathOrUrl);
    }
  }
  if (!alt && !path && !url && !mime) return undefined;
  return {
    ...(alt ? { alt } : {}),
    ...(path ? { path } : {}),
    ...(url ? { url } : {}),
    ...(mime ? { mime } : {}),
  };
}

function imagesFromContentParts(content: unknown): ChatImage[] {
  if (!Array.isArray(content)) return [];
  const images: ChatImage[] = [];
  for (const part of content) {
    if (!isRecord(part) || part.type !== "image") continue;
    const nested = imageFromRecord(part);
    images.push(nested ?? { alt: "image" });
  }
  return images;
}

/**
 * Host chat images arrive as store kind `user-attachment` or as
 * SendMessage `{ type: "attachment" }` (see grokbot-sdk SEND_MESSAGE_TYPES).
 * SDK `turnsFromTranscriptEntries` drops both because it only keeps type=text.
 */
export function imagesFromHostEntry(value: unknown): ChatImage[] {
  const entry = unwrapEntry(value);
  if (!isRecord(entry)) return [];
  const images: ChatImage[] = [];
  const kind = typeof entry.kind === "string" ? entry.kind : "";
  const message = isRecord(entry.message) ? entry.message : undefined;
  const sendAttachment = message?.type === "attachment";
  const userAttachment = kind === "user-attachment";

  images.push(...imagesFromContentParts(entry.content));
  if (message) images.push(...imagesFromContentParts(message.content));

  if (userAttachment || sendAttachment) {
    const fromMessage = message ? imageFromRecord(message) : undefined;
    const fromEntry = imageFromRecord(entry);
    const found = fromMessage ?? fromEntry;
    if (found) images.push(found);
    else if (images.length === 0) images.push({ alt: "image" });
  }
  return images;
}

function roleFromEntry(entry: Record<string, unknown>, speaker: string): ChatTurn["role"] {
  if (entry.role === "user" || speaker === "user" || entry.kind === "user-attachment") return "user";
  if (entry.role === "system") return "system";
  return "assistant";
}

export function parseHostTranscript(payload: unknown): { turns: ChatTurn[]; nextBeforeSeq?: number } {
  const entries = entriesFromTranscriptPayload(payload);
  const nextBeforeSeq =
    isRecord(payload) && typeof payload.nextBeforeSeq === "number" && Number.isFinite(payload.nextBeforeSeq)
      ? payload.nextBeforeSeq
      : undefined;
  const turns: ChatTurn[] = [];
  entries.forEach((raw, index) => {
    const entry = unwrapEntry(raw);
    const textTurns = turnsFromTranscriptEntries([raw]);
    const images = imagesFromHostEntry(raw);
    const rec = isRecord(entry) ? entry : {};
    if (textTurns.length > 0) {
      for (const turn of textTurns) {
        const role = roleFromEntry(rec, turn.speaker);
        turns.push({
          id: `${turn.timestampMs ?? "t"}-${index}-${turn.speaker}`,
          role,
          speaker: turn.speaker,
          text: turn.text,
          ...(turn.timestampMs != null ? { timestampMs: turn.timestampMs } : {}),
          ...(images.length > 0 ? { images } : {}),
        });
      }
      return;
    }
    if (images.length === 0) return;
    const speaker =
      rec.role === "user" || rec.kind === "user-attachment" ? "user" : typeof rec.kind === "string" ? rec.kind : "assistant";
    const timestampMs = typeof rec.timestampMs === "number" ? rec.timestampMs : undefined;
    turns.push({
      id: `${timestampMs ?? "t"}-${index}-${speaker}`,
      role: roleFromEntry(rec, speaker),
      speaker,
      text: "",
      ...(timestampMs != null ? { timestampMs } : {}),
      images,
    });
  });
  return { turns, ...(nextBeforeSeq != null ? { nextBeforeSeq } : {}) };
}

export function turnsFromHostTranscript(payload: unknown): ChatTurn[] {
  return parseHostTranscript(payload).turns;
}

export function lastAssistantText(turns: ChatTurn[]): string | undefined {
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    const turn = turns[i];
    if (turn?.role === "assistant" && turn.text) return turn.text;
  }
  return undefined;
}

export function assistantCount(turns: ChatTurn[]): number {
  return turns.filter((turn) => turn.role === "assistant").length;
}
