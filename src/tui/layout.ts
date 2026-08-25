import type { AgentMember, ChatImage, ChatTurn } from "../client/types.js";
import { MIN_COMPOSE_INNER } from "./compose.js";
import { IMAGE_CELL_ROWS, imagePlaceholder, imagesFromText, localImagePath, mergeImages, pictureKey } from "./images.js";

export type TranscriptAlign = "start" | "end";

export type TranscriptRow = {
  kind: "speaker" | "body" | "image" | "picture" | "empty";
  text: string;
  role?: ChatTurn["role"];
  align: TranscriptAlign;
  image?: ChatImage;
  pictureId?: string;
  pictureSlot?: number;
};

export type TranscriptBlock = {
  align: TranscriptAlign;
  role?: ChatTurn["role"];
  rows: TranscriptRow[];
};

export function turnAlign(role: ChatTurn["role"]): TranscriptAlign {
  return role === "user" ? "end" : "start";
}

/** Both user and assistant wrap to this fraction of the transcript pane. */
export const MESSAGE_WRAP_RATIO = 0.8;

/** Wrap width = 80% of the pane. User turns are then shifted as a block (see alignBlockEnd). */
export function wrapWidth(paneWidth: number): number {
  return Math.max(1, Math.floor(Math.max(0, paneWidth) * MESSAGE_WRAP_RATIO));
}

/** @deprecated Use wrapWidth. Kept so older tests that imported the 55% helper still typecheck if any remain. */
export function userColumnWidth(width: number): number {
  return wrapWidth(width);
}

/** Pad a single line so it hugs the right edge of `width`. */
export function alignEnd(text: string, width: number): string {
  return alignBlockEnd([text], width)[0] ?? text;
}

/**
 * iMessage-style user block: every line keeps its own left edge, and the
 * block as a whole is shifted so the longest line meets `width`.
 */
export function alignBlockEnd(lines: string[], width: number): string[] {
  if (width < 1 || lines.length === 0) return lines;
  let longest = 0;
  for (const line of lines) {
    if (line.length > longest) longest = line.length;
  }
  const pad = Math.max(0, width - longest);
  if (pad === 0) return lines;
  const prefix = " ".repeat(pad);
  return lines.map((line) => prefix + line);
}

/** Word-wrap a single paragraph; hard-break tokens longer than width. */
export function wrapLine(line: string, width: number): string[] {
  if (width < 1) return [line];
  if (line.length === 0) return [""];
  const out: string[] = [];
  let rest = line;
  while (rest.length > width) {
    const slice = rest.slice(0, width);
    const breakAt = slice.lastIndexOf(" ");
    if (breakAt >= Math.max(1, Math.floor(width / 4))) {
      out.push(rest.slice(0, breakAt));
      rest = rest.slice(breakAt + 1).replace(/^\s+/, "");
    } else {
      out.push(slice);
      rest = rest.slice(width).replace(/^\s+/, "");
    }
  }
  if (rest.length > 0 || out.length === 0) out.push(rest);
  return out;
}

export function wrapText(text: string, width: number): string[] {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const paragraphs = normalized.split("\n");
  const lines: string[] = [];
  for (const paragraph of paragraphs) {
    lines.push(...wrapLine(paragraph, width));
  }
  return lines.length > 0 ? lines : [""];
}

function normalizeSpeaker(speaker: string): string {
  return speaker.trim().toLowerCase().replace(/_/g, "-");
}

function isChatDeliverySpeaker(speaker: string): boolean {
  const n = normalizeSpeaker(speaker);
  return n === "send-message" || n === "sendmessage";
}

/** Tool rows such as `thinking` — not the visible SendMessage chat. */
function isNonChatToolSpeaker(speaker: string): boolean {
  const n = normalizeSpeaker(speaker);
  if (!n || isChatDeliverySpeaker(speaker)) return false;
  if (n === "user" || n === "you" || n === "assistant" || n === "bot" || n === "system" || n === "agent") {
    return false;
  }
  return n === "thinking" || n.includes("-");
}

export function isVisibleChatTurn(turn: ChatTurn): boolean {
  if ((turn.images?.length ?? 0) > 0) return true;
  if (turn.role === "user") return true;
  if (isNonChatToolSpeaker(turn.speaker) && turn.text.trim().length === 0) return false;
  return true;
}

export type SpeakerContext = {
  agentName: string;
  isGroup?: boolean;
  members?: AgentMember[];
  roster?: Array<{ id: string; name: string }>;
};

function asSpeakerContext(agentNameOrCtx: string | SpeakerContext): SpeakerContext {
  return typeof agentNameOrCtx === "string" ? { agentName: agentNameOrCtx } : agentNameOrCtx;
}

function lookupMemberName(idOrName: string, ctx: SpeakerContext): string | undefined {
  const needle = idOrName.trim().toLowerCase();
  if (!needle) return undefined;
  const pools = [...(ctx.members ?? []), ...(ctx.roster ?? [])];
  const byId = pools.find((row) => row.id.toLowerCase() === needle);
  if (byId?.name.trim()) return byId.name.trim();
  const byName = pools.find((row) => row.name.trim().toLowerCase() === needle);
  if (byName?.name.trim()) return byName.name.trim();
  return undefined;
}

/** 1:1 chats use the selected bot name. Rooms use the member who spoke, never the room title. */
export function speakerLabel(turn: ChatTurn, agentNameOrCtx: string | SpeakerContext): string {
  if (turn.role === "user") return "you";
  const ctx = asSpeakerContext(agentNameOrCtx);
  if (ctx.isGroup) {
    const fromId = turn.speakerId ? lookupMemberName(turn.speakerId, ctx) : undefined;
    if (fromId) return fromId;
    const fromSpeaker = lookupMemberName(turn.speaker, ctx);
    if (fromSpeaker) return fromSpeaker;
    if (isChatDeliverySpeaker(turn.speaker) || turn.speaker === "assistant" || turn.speaker === "unknown") {
      return "bot";
    }
    const leftover = turn.speaker.trim();
    return leftover.length > 0 ? leftover : "bot";
  }
  const name = ctx.agentName.trim();
  return name.length > 0 ? name : "bot";
}

export { imagePlaceholder } from "./images.js";

export function turnsToRows(
  turns: ChatTurn[],
  width: number,
  agentNameOrCtx: string | SpeakerContext,
): TranscriptRow[] {
  const paneWidth = Math.max(1, width);
  const bodyWidth = wrapWidth(paneWidth);
  const ctx = asSpeakerContext(agentNameOrCtx);
  const visible = turns.filter(isVisibleChatTurn);
  const rows: TranscriptRow[] = [];
  for (let i = 0; i < visible.length; i++) {
    const turn = visible[i]!;
    const align = turnAlign(turn.role);
    const pending: TranscriptRow[] = [];
    if (ctx.isGroup === true) {
      pending.push({
        kind: "speaker",
        text: speakerLabel(turn, ctx),
        role: turn.role,
        align,
      });
    }
    const extracted = imagesFromText(turn.text);
    const bodyText = extracted.text;
    const images = mergeImages(turn.images ?? [], extracted.images);
    if (bodyText.trim().length > 0) {
      for (const line of wrapText(bodyText, bodyWidth)) {
        pending.push({
          kind: "body",
          text: line,
          role: turn.role,
          align,
        });
      }
    }
    for (const [index, image] of images.entries()) {
      const file = localImagePath(image);
      if (file) {
        const id = pictureKey(turn.id, index);
        const label = imagePlaceholder(image);
        for (let slot = 0; slot < IMAGE_CELL_ROWS; slot++) {
          pending.push({
            kind: "picture",
            text: slot === 0 ? label : "",
            role: turn.role,
            align,
            image: { ...image, path: file },
            pictureId: id,
            pictureSlot: slot,
          });
        }
      } else {
        pending.push({
          kind: "image",
          text: imagePlaceholder(image),
          role: turn.role,
          align,
          image,
        });
      }
    }
    if (align === "end") {
      const padded = alignBlockEnd(
        pending.map((row) => row.text),
        paneWidth,
      );
      for (let j = 0; j < pending.length; j++) {
        const row = pending[j];
        const text = padded[j];
        if (row && text != null) pending[j] = { ...row, text };
      }
    }
    rows.push(...pending);
    const next = visible[i + 1];
    if (!next) {
      // One blank row under the last line so it does not sit on the frame.
      rows.push({ kind: "empty", text: "", role: turn.role, align });
      continue;
    }
    if (next.role === turn.role) continue;
    // Opposite side: 1:1 needs two blank rows (no names); rooms one.
    const gap = ctx.isGroup === true ? 1 : 2;
    for (let g = 0; g < gap; g++) {
      rows.push({ kind: "empty", text: "", role: turn.role, align });
    }
  }
  return rows;
}

export function groupTranscriptRows(rows: TranscriptRow[]): TranscriptBlock[] {
  const blocks: TranscriptBlock[] = [];
  let current: TranscriptRow[] = [];
  let align: TranscriptAlign | undefined;
  let role: ChatTurn["role"] | undefined;

  const flush = () => {
    if (current.length === 0 || align == null) return;
    blocks.push({ align, role, rows: current });
    current = [];
    align = undefined;
    role = undefined;
  };

  for (const row of rows) {
    if (row.kind === "empty") {
      flush();
      continue;
    }
    if (align != null && row.align !== align) flush();
    align = row.align;
    role = row.role;
    current.push(row);
  }
  flush();
  return blocks;
}

/** Keep the latest rows so a long last reply still fits by showing its end. */
export function takeLastRows(rows: TranscriptRow[], maxLines: number): TranscriptRow[] {
  if (maxLines < 1) return [];
  if (rows.length <= maxLines) return rows;
  return rows.slice(rows.length - maxLines);
}

export function maxScrollOffset(rowCount: number, budget: number): number {
  return Math.max(0, rowCount - Math.max(1, budget));
}

export function clampScrollOffset(offset: number, rowCount: number, budget: number): number {
  const max = maxScrollOffset(rowCount, budget);
  if (!Number.isFinite(offset) || offset <= 0) return 0;
  return Math.min(Math.floor(offset), max);
}

/** Shift offset by `delta` lines (positive = older / up). Clamped to 0..max. */
export function applyScrollDelta(
  offset: number,
  delta: number,
  rowCount: number,
  budget: number,
): number {
  return clampScrollOffset(offset + delta, rowCount, budget);
}

/**
 * Offset is lines from the bottom. 0 means pinned to latest.
 * When new rows append and the user is scrolled up, grow the offset so the
 * same history stays on screen (idle poll must not yank to the bottom).
 */
export function adjustScrollOffset(input: {
  offset: number;
  prevRowCount: number;
  nextRowCount: number;
  budget: number;
}): number {
  if (input.offset <= 0) return 0;
  const grown = Math.max(0, input.nextRowCount - input.prevRowCount);
  return clampScrollOffset(input.offset + grown, input.nextRowCount, input.budget);
}

export type VisibleTranscript = {
  rows: TranscriptRow[];
  clipped: boolean;
  moreBelow: boolean;
  offset: number;
  maxOffset: number;
  pinned: boolean;
};

/** Clip to a wrapped-line budget. offset is how many rows above the bottom to shift. */
export function visibleTranscript(
  rows: TranscriptRow[],
  budget: number,
  offsetFromBottom = 0,
): VisibleTranscript {
  if (budget <= 0) {
    return { rows: [], clipped: rows.length > 0, moreBelow: false, offset: 0, maxOffset: 0, pinned: true };
  }
  if (rows.length <= budget) {
    return { rows, clipped: false, moreBelow: false, offset: 0, maxOffset: 0, pinned: true };
  }
  const maxOffset = maxScrollOffset(rows.length, budget);
  const offset = clampScrollOffset(offsetFromBottom, rows.length, budget);
  const end = rows.length - offset;
  const moreBelow = end < rows.length;
  const moreAbove = end - budget > 0;
  let take = budget;
  if (moreAbove) take -= 1;
  if (moreBelow && take > 1) take -= 1;
  const start = Math.max(0, end - take);
  return {
    rows: rows.slice(start, end),
    clipped: start > 0,
    moreBelow,
    offset,
    maxOffset,
    pinned: offset === 0,
  };
}

export function shortIdPrefix(id: string): string {
  const compact = id.replace(/-/g, "");
  return compact.slice(0, 6);
}

export function agentLabel(agent: { id: string; name: string }, roster: Array<{ id: string; name: string }>): string {
  const name = agent.name.trim() || "agent";
  const dup = roster.filter((row) => row.name.trim().toLowerCase() === name.toLowerCase()).length > 1;
  if (!dup) return name;
  return `${name} · ${shortIdPrefix(agent.id)}`;
}

/** True when `start` is a complete reserved picture block (safe for Kitty). */
export function isFullPictureRun(
  rows: TranscriptRow[],
  start: number,
  height = IMAGE_CELL_ROWS,
): boolean {
  const lead = rows[start];
  if (lead?.kind !== "picture" || lead.pictureSlot !== 0 || !lead.pictureId) return false;
  if (start + height > rows.length) return false;
  for (let i = 0; i < height; i++) {
    const row = rows[start + i];
    if (row?.kind !== "picture" || row.pictureId !== lead.pictureId || row.pictureSlot !== i) {
      return false;
    }
  }
  return true;
}

export function composeVisible(draft: string, width: number): { prefix: string; caret: boolean } {
  const max = Math.max(1, width - 1);
  if (draft.length <= max) return { prefix: draft, caret: true };
  return { prefix: draft.slice(draft.length - max), caret: true };
}

/** Blank row inside the transcript frame, above the bottom border. */
export const TRANSCRIPT_PAD_BOTTOM = 1;

export function chromeRows(composeInner = MIN_COMPOSE_INNER): number {
  const inner = Math.max(MIN_COMPOSE_INNER, composeInner);
  // header box (3) + compose box (border 2 + inner lines) + footer (1)
  return 3 + (2 + inner) + 1;
}

export function transcriptInnerHeight(terminalRows: number, composeInner = MIN_COMPOSE_INNER): number {
  const outer = Math.max(4, terminalRows - chromeRows(composeInner));
  return Math.max(1, outer - 2 - TRANSCRIPT_PAD_BOTTOM);
}

export function innerWidth(terminalColumns: number, paddingX = 1): number {
  return Math.max(8, terminalColumns - 2 - paddingX * 2);
}
