import { entriesFromTranscriptPayload, turnsFromTranscriptEntries } from "@adam91holt/grokbot-sdk";
import { basename } from "node:path";
import type { Agent, AgentMember, ChatImage, ChatTurn } from "./types.js";

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

function stringIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

function namedMembers(value: unknown): AgentMember[] {
  if (!Array.isArray(value)) return [];
  const out: AgentMember[] = [];
  for (const row of value) {
    if (!isRecord(row)) continue;
    const id = typeof row.id === "string" ? row.id : typeof row.agentId === "string" ? row.agentId : "";
    const name = typeof row.name === "string" && row.name.length > 0 ? row.name : "";
    if (id && name) out.push({ id, name });
  }
  return out;
}

export function asAgentRow(value: unknown): Agent | null {
  if (!isRecord(value)) return null;
  const id = typeof value.id === "string" ? value.id : typeof value.agentId === "string" ? value.agentId : "";
  if (!id) return null;
  const name = typeof value.name === "string" && value.name.length > 0 ? value.name : id;
  const title = typeof value.title === "string" && value.title.length > 0 ? value.title : undefined;
  const memberIds = stringIds(value.memberIds ?? value.memberAgentIds);
  const members = namedMembers(value.remoteMembers ?? value.members);
  const isGroup =
    value.isGroup === true || (value.isGroup == null && memberIds.length > 0);
  const isRunning = typeof value.isRunning === "boolean" ? value.isRunning : undefined;
  const isComposingMessage =
    typeof value.isComposingMessage === "boolean" ? value.isComposingMessage : undefined;
  return {
    id,
    name,
    ...(title ? { title } : {}),
    isGroup,
    ...(isRunning !== undefined ? { isRunning } : {}),
    ...(isComposingMessage !== undefined ? { isComposingMessage } : {}),
    ...(memberIds.length > 0 ? { memberIds } : {}),
    ...(members.length > 0 ? { members } : {}),
  };
}

/** Fill group member names from host remoteMembers, then from 1:1 roster rows. */
export function enrichRoster(agents: Agent[]): Agent[] {
  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  return agents.map((agent) => {
    const ids = agent.memberIds ?? [];
    if (!agent.isGroup && ids.length === 0) return { ...agent };
    const named = new Map((agent.members ?? []).map((member) => [member.id, member.name]));
    const members: AgentMember[] = ids.map((memberId) => {
      const fromHost = named.get(memberId);
      const fromRoster = byId.get(memberId)?.name;
      return { id: memberId, name: fromHost || fromRoster || memberId };
    });
    return {
      ...agent,
      memberIds: ids,
      ...(members.length > 0 ? { members } : {}),
    };
  });
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

function pickString(rec: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = rec[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

/**
 * Build an image ref from documented host fields:
 * `id` / `entryId`, `fileName` / `mime` / `ext` (search-index media rows),
 * `attachmentPaths` / `attachmentNames` (sendPrompt).
 * Never treat query strings as display text.
 */
function imageFromRecord(rec: Record<string, unknown>): ChatImage | undefined {
  const names = stringList(rec.attachmentNames);
  const paths = stringList(rec.attachmentPaths);
  const fileName = pickString(rec, ["fileName"]) ?? names[0];
  const mime = pickString(rec, ["mime"]);
  const ext = pickString(rec, ["ext"]);
  const entryId = pickString(rec, ["entryId"]);
  const id = pickString(rec, ["id"]);
  const explicitUrl = pickString(rec, ["url"]);
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
  if (!url && explicitUrl && isHttpUrl(explicitUrl)) url = explicitUrl;
  if (!alt && ext && !mime) {
    alt = `image.${ext.replace(/^\./, "")}`;
  }
  if (!alt && !path && !url && !mime && !entryId && !id && names.length === 0 && paths.length === 0) {
    return undefined;
  }
  return {
    ...(alt ? { alt } : {}),
    ...(fileName ? { fileName } : {}),
    ...(path ? { path } : {}),
    ...(url ? { url } : {}),
    ...(mime ? { mime } : {}),
    ...(entryId ? { entryId } : {}),
    ...(id ? { id } : {}),
    ...(names.length ? { attachmentNames: names } : {}),
    ...(paths.length ? { attachmentPaths: paths } : {}),
  };
}

function mergeChatImage(base: ChatImage | undefined, extra: ChatImage | undefined): ChatImage | undefined {
  if (!base) return extra;
  if (!extra) return base;
  return {
    ...(extra.alt ? { alt: extra.alt } : base.alt ? { alt: base.alt } : {}),
    ...(extra.fileName ? { fileName: extra.fileName } : base.fileName ? { fileName: base.fileName } : {}),
    ...(extra.path ? { path: extra.path } : base.path ? { path: base.path } : {}),
    ...(extra.url ? { url: extra.url } : base.url ? { url: base.url } : {}),
    ...(extra.mime ? { mime: extra.mime } : base.mime ? { mime: base.mime } : {}),
    ...(extra.entryId ? { entryId: extra.entryId } : base.entryId ? { entryId: base.entryId } : {}),
    ...(extra.id ? { id: extra.id } : base.id ? { id: base.id } : {}),
    ...(extra.attachmentNames?.length
      ? { attachmentNames: extra.attachmentNames }
      : base.attachmentNames?.length
        ? { attachmentNames: base.attachmentNames }
        : {}),
    ...(extra.attachmentPaths?.length
      ? { attachmentPaths: extra.attachmentPaths }
      : base.attachmentPaths?.length
        ? { attachmentPaths: base.attachmentPaths }
        : {}),
  };
}

function recordsForImages(entry: Record<string, unknown>): Record<string, unknown>[] {
  const records: Record<string, unknown>[] = [entry];
  if (isRecord(entry.entry)) records.push(entry.entry);
  const message = isRecord(entry.message)
    ? entry.message
    : isRecord(entry.entry) && isRecord(entry.entry.message)
      ? entry.entry.message
      : undefined;
  if (message) {
    records.push(message);
    if (isRecord(message.attachment)) records.push(message.attachment);
  }
  if (isRecord(entry.attachment)) records.push(entry.attachment);
  return records;
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
  const nested = isRecord(entry.entry) ? entry.entry : undefined;
  const message = isRecord(entry.message)
    ? entry.message
    : isRecord(nested?.message)
      ? nested.message
      : undefined;
  const sendAttachment = message?.type === "attachment";
  const userAttachment = kind === "user-attachment" || nested?.kind === "user-attachment";

  images.push(...imagesFromContentParts(entry.content));
  if (nested) images.push(...imagesFromContentParts(nested.content));
  if (message) images.push(...imagesFromContentParts(message.content));

  if (userAttachment || sendAttachment) {
    let found: ChatImage | undefined;
    for (const rec of recordsForImages(entry)) {
      found = mergeChatImage(found, imageFromRecord(rec));
    }
    if (found) images.push(found);
    else if (images.length === 0) images.push({ alt: "image" });
  }

  const wrapperId = pickString(entry, ["id", "entryId"]) ?? (nested ? pickString(nested, ["id", "entryId"]) : undefined);
  if (!wrapperId) return images;
  return images.map((image) => ({
    ...image,
    ...(image.entryId ? {} : { entryId: wrapperId }),
  }));
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
          ...(turn.agentId ? { speakerId: turn.agentId } : {}),
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
    const authorId =
      isRecord(rec.author) && typeof rec.author.id === "string"
        ? rec.author.id
        : isRecord(rec.fromAgent) && typeof rec.fromAgent.id === "string"
          ? rec.fromAgent.id
          : undefined;
    turns.push({
      id: `${timestampMs ?? "t"}-${index}-${speaker}`,
      role: roleFromEntry(rec, speaker),
      speaker,
      ...(authorId ? { speakerId: authorId } : {}),
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
