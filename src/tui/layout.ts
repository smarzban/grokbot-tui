import type { AgentMember, ChatImage, ChatTurn } from "../client/types.js";
import { MIN_COMPOSE_INNER } from "./compose.js";

export type TranscriptAlign = "start" | "end";

export type TranscriptRow = {
  kind: "speaker" | "body" | "image" | "empty";
  text: string;
  role?: ChatTurn["role"];
  align: TranscriptAlign;
};

export type TranscriptBlock = {
  align: TranscriptAlign;
  role?: ChatTurn["role"];
  rows: TranscriptRow[];
};

export function turnAlign(role: ChatTurn["role"]): TranscriptAlign {
  return role === "user" ? "end" : "start";
}

/** Wrap to the full pane. User lines are then padStart'd to this same width. */
export function wrapWidth(paneWidth: number): number {
  return Math.max(1, paneWidth);
}

/** @deprecated Use wrapWidth. Kept so older tests that imported the 55% helper still typecheck if any remain. */
export function userColumnWidth(width: number): number {
  return wrapWidth(width);
}

/** Pad `text` so it hugs the right edge of `width`. Does not truncate shorter labels. */
export function alignEnd(text: string, width: number): string {
  if (width < 1) return text;
  if (text.length >= width) return text;
  return text.padStart(width, " ");
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

export function imagePlaceholder(image: ChatImage): string {
  const name = image.alt?.trim();
  return name ? `[image] ${name}` : "[image]";
}

function paint(text: string, align: TranscriptAlign, paneWidth: number): string {
  return align === "end" ? alignEnd(text, paneWidth) : text;
}

export function turnsToRows(
  turns: ChatTurn[],
  width: number,
  agentNameOrCtx: string | SpeakerContext,
): TranscriptRow[] {
  const paneWidth = Math.max(1, width);
  const bodyWidth = wrapWidth(paneWidth);
  const ctx = asSpeakerContext(agentNameOrCtx);
  const rows: TranscriptRow[] = [];
  for (const turn of turns) {
    if (!isVisibleChatTurn(turn)) continue;
    const align = turnAlign(turn.role);
    const label = speakerLabel(turn, ctx);
    rows.push({
      kind: "speaker",
      text: paint(label, align, paneWidth),
      role: turn.role,
      align,
    });
    if (turn.text.trim().length > 0) {
      for (const line of wrapText(turn.text, bodyWidth)) {
        rows.push({
          kind: "body",
          text: paint(line, align, paneWidth),
          role: turn.role,
          align,
        });
      }
    }
    for (const image of turn.images ?? []) {
      rows.push({
        kind: "image",
        text: paint(imagePlaceholder(image), align, paneWidth),
        role: turn.role,
        align,
      });
    }
    rows.push({ kind: "empty", text: "", role: turn.role, align });
  }
  if (rows.length > 0 && rows[rows.length - 1]?.kind === "empty") {
    rows.pop();
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

export function composeVisible(draft: string, width: number): { prefix: string; caret: boolean } {
  const max = Math.max(1, width - 1);
  if (draft.length <= max) return { prefix: draft, caret: true };
  return { prefix: draft.slice(draft.length - max), caret: true };
}

export function chromeRows(composeInner = MIN_COMPOSE_INNER): number {
  const inner = Math.max(MIN_COMPOSE_INNER, composeInner);
  // header box (3) + compose box (border 2 + inner lines) + footer (1)
  return 3 + (2 + inner) + 1;
}

export function transcriptInnerHeight(terminalRows: number, composeInner = MIN_COMPOSE_INNER): number {
  const outer = Math.max(4, terminalRows - chromeRows(composeInner));
  return Math.max(1, outer - 2);
}

export function innerWidth(terminalColumns: number, paddingX = 1): number {
  return Math.max(8, terminalColumns - 2 - paddingX * 2);
}
