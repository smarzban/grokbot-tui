import type { ChatTurn } from "../client/types.js";

export type TranscriptAlign = "start" | "end";

export type TranscriptRow = {
  kind: "speaker" | "body" | "empty";
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

/** Right-side column for user bubbles; assistant uses the full inner width. */
export function userColumnWidth(width: number): number {
  return Math.max(8, Math.floor(width * 0.72));
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
  if (turn.role === "user") return true;
  if (isNonChatToolSpeaker(turn.speaker) && turn.text.trim().length === 0) return false;
  return true;
}

export function speakerLabel(turn: ChatTurn, agentName: string): string {
  if (turn.role === "user") return "you";
  const name = agentName.trim();
  return name.length > 0 ? name : "bot";
}

export function turnsToRows(turns: ChatTurn[], width: number, agentName: string): TranscriptRow[] {
  const assistantWidth = Math.max(1, width);
  const userWidth = userColumnWidth(width);
  const rows: TranscriptRow[] = [];
  for (const turn of turns) {
    if (!isVisibleChatTurn(turn)) continue;
    const align = turnAlign(turn.role);
    const bodyWidth = align === "end" ? userWidth : assistantWidth;
    rows.push({ kind: "speaker", text: speakerLabel(turn, agentName), role: turn.role, align });
    for (const line of wrapText(turn.text, bodyWidth)) {
      rows.push({ kind: "body", text: line, role: turn.role, align });
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

export type VisibleTranscript = {
  rows: TranscriptRow[];
  clipped: boolean;
};

/** Clip to a wrapped-line budget, leaving room for a leading ellipsis when truncated. */
export function visibleTranscript(rows: TranscriptRow[], budget: number): VisibleTranscript {
  if (budget <= 0) return { rows: [], clipped: rows.length > 0 };
  if (rows.length <= budget) return { rows, clipped: false };
  if (budget === 1) return { rows: takeLastRows(rows, 1), clipped: true };
  return { rows: takeLastRows(rows, budget - 1), clipped: true };
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

export function chromeRows(): number {
  // header box (3) + compose box (3) + footer (1)
  return 7;
}

export function transcriptInnerHeight(terminalRows: number): number {
  const outer = Math.max(4, terminalRows - chromeRows());
  return Math.max(1, outer - 2);
}

export function innerWidth(terminalColumns: number, paddingX = 1): number {
  return Math.max(8, terminalColumns - 2 - paddingX * 2);
}
