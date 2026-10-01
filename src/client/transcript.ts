import { existsSync } from "node:fs";
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

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Host `getAgentTranscriptTail` is `{ entries }`; some calls return the array directly. */
export function entriesFromTranscriptPayload(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (isRecord(value) && Array.isArray(value.entries)) return value.entries;
  return [];
}

function agentRef(value: unknown): { id?: string; name?: string } {
  if (typeof value === "string" && value.length > 0) return { id: value };
  if (!isRecord(value)) return {};
  return {
    ...(asNonEmptyString(value.id) != null ? { id: asNonEmptyString(value.id) } : {}),
    ...(asNonEmptyString(value.name) != null ? { name: asNonEmptyString(value.name) } : {}),
  };
}

function speakerFromEntry(entry: Record<string, unknown>): { speaker: string; agentId?: string } {
  const author = agentRef(entry.author);
  const fromAgent = agentRef(entry.fromAgent);
  const fromUser = agentRef(entry.fromUser);
  const agentId = author.id ?? fromAgent.id;
  if (author.name != null) return { speaker: author.name, ...(agentId != null ? { agentId } : {}) };
  if (fromAgent.name != null) {
    return { speaker: fromAgent.name, ...(fromAgent.id != null ? { agentId: fromAgent.id } : {}) };
  }
  if (fromUser.name != null) return { speaker: fromUser.name };
  if (entry.role === "user" && fromAgent.id == null && author.id == null) {
    return { speaker: "user" };
  }
  if (entry.role === "assistant") return { speaker: "assistant", ...(agentId != null ? { agentId } : {}) };
  if (agentId != null) return { speaker: agentId, agentId };
  return { speaker: asNonEmptyString(entry.kind) ?? "unknown" };
}

function textFromHostEntry(entry: Record<string, unknown>): string | undefined {
  if (entry.streaming === true) return undefined;
  const kind = asNonEmptyString(entry.kind);
  if (kind === "send-message") {
    const message = isRecord(entry.message) ? entry.message : undefined;
    if (!message || message.type !== "text") return undefined;
    return asNonEmptyString(message.content);
  }
  if (kind === "message" || kind == null) {
    return typeof entry.content === "string" && entry.content.trim().length > 0 ? entry.content : undefined;
  }
  return undefined;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function isFileUrl(value: string): boolean {
  return /^file:/i.test(value);
}

function pickString(rec: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = rec[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

function pickNumber(rec: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = rec[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return undefined;
}

function localPathIfExists(value: string | undefined): string | undefined {
  if (!value || isHttpUrl(value) || isFileUrl(value)) return undefined;
  try {
    if (existsSync(value)) return value;
  } catch {
    return undefined;
  }
  return undefined;
}

/**
 * Build an image ref from host fields:
 * `file_name` / `file_path` (user-attachment), `fileName` / `attachmentPaths`,
 * `id` / `entryId` / `mime`, and `url` / `alt` / `width` / `height` on
 * `message.images[]`. Never treat query strings as display text.
 */
function imageFromRecord(rec: Record<string, unknown>): ChatImage | undefined {
  const names = stringList(rec.attachmentNames);
  const paths = stringList(rec.attachmentPaths);
  const fileName = pickString(rec, ["fileName", "file_name"]) ?? names[0];
  const hostFilePath = pickString(rec, ["file_path"]);
  const mime = pickString(rec, ["mime"]);
  const ext = pickString(rec, ["ext"]);
  const entryId = pickString(rec, ["entryId"]);
  const id = pickString(rec, ["id"]);
  const width = pickNumber(rec, ["width"]);
  const height = pickNumber(rec, ["height"]);
  const explicitUrl = pickString(rec, ["url"]);
  const pathOrUrl = paths[0];
  let path: string | undefined;
  let url: string | undefined;
  let alt = fileName ?? pickString(rec, ["alt"]);
  if (pathOrUrl) {
    if (isHttpUrl(pathOrUrl) || isFileUrl(pathOrUrl)) {
      url = pathOrUrl;
    } else {
      const existing = localPathIfExists(pathOrUrl);
      if (existing) path = existing;
      else if (!hostFilePath) {
        // CamelCase attachmentPaths that are abs but missing — keep as path
        // so hydrate can send readAttachmentImage({ path }).
        path = pathOrUrl;
      }
      if (!alt) alt = basename(pathOrUrl);
    }
  }
  if (!url && explicitUrl && (isHttpUrl(explicitUrl) || isFileUrl(explicitUrl))) url = explicitUrl;
  const existingHost = localPathIfExists(hostFilePath);
  if (existingHost && !path) path = existingHost;
  if (!alt && ext && !mime) {
    alt = `image.${ext.replace(/^\./, "")}`;
  }
  if (
    !alt &&
    !path &&
    !url &&
    !mime &&
    !entryId &&
    !id &&
    !hostFilePath &&
    names.length === 0 &&
    paths.length === 0
  ) {
    return undefined;
  }
  return {
    ...(alt ? { alt } : {}),
    ...(fileName ? { fileName } : {}),
    ...(path ? { path } : {}),
    ...(hostFilePath ? { file_path: hostFilePath } : {}),
    ...(url ? { url } : {}),
    ...(mime ? { mime } : {}),
    ...(width != null ? { width } : {}),
    ...(height != null ? { height } : {}),
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
    ...(extra.file_path ? { file_path: extra.file_path } : base.file_path ? { file_path: base.file_path } : {}),
    ...(extra.url ? { url: extra.url } : base.url ? { url: base.url } : {}),
    ...(extra.mime ? { mime: extra.mime } : base.mime ? { mime: base.mime } : {}),
    ...(extra.width != null ? { width: extra.width } : base.width != null ? { width: base.width } : {}),
    ...(extra.height != null ? { height: extra.height } : base.height != null ? { height: base.height } : {}),
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

function imagesFromMessageImages(images: unknown): ChatImage[] {
  if (!Array.isArray(images)) return [];
  const out: ChatImage[] = [];
  for (const item of images) {
    if (!isRecord(item)) continue;
    const parsed = imageFromRecord(item);
    if (parsed) out.push(parsed);
  }
  return out;
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
 * Host chat images arrive as:
 * - store kind `user-attachment` (`file_name` / `file_path`, not camelCase)
 * - SendMessage `{ type: "attachment" }` (legacy)
 * - SendMessage `{ type: "text", images: [{ url, alt, width, height }] }`
 * Non-text parts (tools, widgets) are skipped; images are collected separately.
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

  images.push(...imagesFromMessageImages(entry.images));
  if (nested) images.push(...imagesFromMessageImages(nested.images));
  if (message) images.push(...imagesFromMessageImages(message.images));

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
    ...(image.id ? {} : { id: wrapperId }),
  }));
}

const TOOL_KINDS = new Set(["tool-call", "tool-result", "tool"]);

/** Host tool / streaming rows — activity only; never dump tool names into the UI. */
export function isToolActivityEntry(entry: Record<string, unknown>): boolean {
  if (entry.role === "tool") return true;
  if (entry.streaming === true) return true;
  const kind = asNonEmptyString(entry.kind);
  return kind != null && TOOL_KINDS.has(kind);
}

function roleFromEntry(entry: Record<string, unknown>, speaker: string): ChatTurn["role"] {
  if (entry.role === "user" || speaker === "user" || entry.kind === "user-attachment") return "user";
  if (entry.role === "system") return "system";
  if (isToolActivityEntry(entry)) return "tool";
  return "assistant";
}

function pushActivityTurn(
  turns: ChatTurn[],
  rec: Record<string, unknown>,
  index: number,
  images: ChatImage[] = [],
): void {
  const { speaker, agentId } = speakerFromEntry(rec);
  const timestampMs =
    typeof rec.timestampMs === "number" && Number.isFinite(rec.timestampMs) ? rec.timestampMs : undefined;
  turns.push({
    id: `${timestampMs ?? "t"}-${index}-${speaker}`,
    role: "tool",
    speaker,
    ...(agentId ? { speakerId: agentId } : {}),
    text: "",
    ...(timestampMs != null ? { timestampMs } : {}),
    ...(images.length > 0 ? { images } : {}),
  });
}

export function parseHostTranscript(payload: unknown): ChatTurn[] {
  const entries = entriesFromTranscriptPayload(payload);
  const turns: ChatTurn[] = [];
  entries.forEach((raw, index) => {
    const entry = unwrapEntry(raw);
    const rec = isRecord(entry) ? entry : {};
    const text = isRecord(entry) ? textFromHostEntry(rec) : undefined;
    const images = imagesFromHostEntry(raw);
    if (text != null) {
      const { speaker, agentId } = speakerFromEntry(rec);
      const timestampMs = typeof rec.timestampMs === "number" && Number.isFinite(rec.timestampMs) ? rec.timestampMs : undefined;
      turns.push({
        id: `${timestampMs ?? "t"}-${index}-${speaker}`,
        role: roleFromEntry(rec, speaker),
        speaker,
        ...(agentId ? { speakerId: agentId } : {}),
        text,
        ...(timestampMs != null ? { timestampMs } : {}),
        ...(images.length > 0 ? { images } : {}),
      });
      return;
    }
    if (isToolActivityEntry(rec)) {
      pushActivityTurn(turns, rec, index, images);
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
  return turns;
}

export function turnsFromHostTranscript(payload: unknown): ChatTurn[] {
  return parseHostTranscript(payload);
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
