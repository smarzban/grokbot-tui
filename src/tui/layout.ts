import type { ChatTurn } from "../client/types.js";

export type TranscriptRow = {
  kind: "speaker" | "body" | "empty";
  text: string;
  role?: ChatTurn["role"];
};

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

export function speakerLabel(turn: ChatTurn): string {
  if (turn.role === "user") return "you";
  const name = turn.speaker.trim();
  return name.length > 0 && name !== "assistant" ? name : "bot";
}

export function turnsToRows(turns: ChatTurn[], width: number): TranscriptRow[] {
  const bodyWidth = Math.max(1, width);
  const rows: TranscriptRow[] = [];
  for (const turn of turns) {
    rows.push({ kind: "speaker", text: speakerLabel(turn), role: turn.role });
    for (const line of wrapText(turn.text, bodyWidth)) {
      rows.push({ kind: "body", text: line, role: turn.role });
    }
    rows.push({ kind: "empty", text: "" });
  }
  if (rows.length > 0 && rows[rows.length - 1]?.kind === "empty") {
    rows.pop();
  }
  return rows;
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
