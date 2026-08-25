export const MIN_COMPOSE_INNER = 1;
export const MAX_COMPOSE_INNER = 5;

export const FOOTER_HINT = "Enter send  ·  Esc list  ·  Ctrl+c quit";

export function clampCaret(caret: number, length: number): number {
  if (!Number.isFinite(caret) || caret <= 0) return 0;
  return Math.min(Math.floor(caret), Math.max(0, length));
}

export function insertAt(text: string, caret: number, chunk: string): { text: string; caret: number } {
  const c = clampCaret(caret, text.length);
  if (!chunk) return { text, caret: c };
  return { text: text.slice(0, c) + chunk + text.slice(c), caret: c + chunk.length };
}

export function deleteBackward(text: string, caret: number): { text: string; caret: number } {
  const c = clampCaret(caret, text.length);
  if (c <= 0) return { text, caret: 0 };
  return { text: text.slice(0, c - 1) + text.slice(c), caret: c - 1 };
}

export function deleteForward(text: string, caret: number): { text: string; caret: number } {
  const c = clampCaret(caret, text.length);
  if (c >= text.length) return { text, caret: c };
  return { text: text.slice(0, c) + text.slice(c + 1), caret: c };
}

export function moveCaret(caret: number, length: number, delta: number): number {
  return clampCaret(caret + delta, length);
}

export type ComposeLayout = {
  lines: string[];
  /** Original-string index of the first displayed character on each visual line. */
  starts: number[];
  line: number;
  col: number;
};

type VisualLine = { text: string; start: number };

/** Word-wrap one paragraph; hard-break only a token longer than `width`. */
function wrapParagraph(para: string, paraStart: number, width: number): VisualLine[] {
  const w = Math.max(1, width);
  if (para.length === 0) return [{ text: "", start: paraStart }];
  const out: VisualLine[] = [];
  let s = 0;
  while (s < para.length) {
    const remaining = para.length - s;
    if (remaining <= w) {
      out.push({ text: para.slice(s), start: paraStart + s });
      break;
    }
    const window = para.slice(s, s + w);
    const sp = window.lastIndexOf(" ");
    if (sp > 0) {
      out.push({ text: para.slice(s, s + sp), start: paraStart + s });
      s = s + sp + 1;
    } else {
      out.push({ text: window, start: paraStart + s });
      s += w;
    }
    while (s < para.length && para[s] === " ") s += 1;
  }
  return out;
}

function visualLines(text: string, width: number): VisualLine[] {
  const w = Math.max(1, width);
  const out: VisualLine[] = [];
  let offset = 0;
  const parts = text.split("\n");
  for (let p = 0; p < parts.length; p++) {
    const para = parts[p] ?? "";
    out.push(...wrapParagraph(para, offset, w));
    offset += para.length + (p < parts.length - 1 ? 1 : 0);
  }
  if (out.length === 0) out.push({ text: "", start: 0 });
  const last = out[out.length - 1];
  if (
    last &&
    last.text.length === w &&
    text.length > 0 &&
    text[text.length - 1] !== "\n"
  ) {
    out.push({ text: "", start: text.length });
  }
  return out;
}

/**
 * Word-wrap `text` to `width` and map `caret` onto a line/column.
 * A caret sitting exactly on a wrap boundary (or a skipped wrap space / newline)
 * is shown at col 0 of the next line so the inverse cell stays inside the box.
 */
export function layoutCompose(text: string, caret: number, width: number): ComposeLayout {
  const w = Math.max(1, width);
  const c = clampCaret(caret, text.length);
  const vis = visualLines(text, w);
  const lines = vis.map((row) => row.text);
  const starts = vis.map((row) => row.start);

  let line = vis.length - 1;
  let col = vis[line]?.text.length ?? 0;
  for (let r = 0; r < vis.length; r++) {
    const row = vis[r];
    if (!row) continue;
    const lineEnd = row.start + row.text.length;
    if (c < row.start) {
      line = r;
      col = 0;
      break;
    }
    if (c <= lineEnd) {
      line = r;
      col = c - row.start;
      if (col === w && r + 1 < vis.length) {
        line = r + 1;
        col = 0;
      }
      break;
    }
  }
  return { lines, starts, line, col };
}

export function caretFromLineCol(layout: ComposeLayout, line: number, col: number, textLength: number): number {
  if (layout.lines.length === 0) return 0;
  const r = Math.min(Math.max(0, line), layout.lines.length - 1);
  const row = layout.lines[r] ?? "";
  const start = layout.starts[r] ?? 0;
  const c = start + clampCaret(col, row.length);
  return clampCaret(c, textLength);
}

export function lineStartCaret(layout: ComposeLayout): number {
  return layout.starts[layout.line] ?? 0;
}

export function lineEndCaret(layout: ComposeLayout, textLength: number): number {
  const row = layout.lines[layout.line] ?? "";
  const start = layout.starts[layout.line] ?? 0;
  return clampCaret(start + row.length, textLength);
}

/**
 * Move the caret up/down among visual/hard compose lines.
 * Returns null when the draft is a single visual line (caller may scroll the transcript).
 */
export function moveCaretVertical(
  text: string,
  caret: number,
  width: number,
  dir: -1 | 1,
): number | null {
  const laid = layoutCompose(text, caret, width);
  if (laid.lines.length <= 1) return null;
  const nextLine = laid.line + dir;
  if (nextLine < 0 || nextLine >= laid.lines.length) return caret;
  const nextRow = laid.lines[nextLine] ?? "";
  return caretFromLineCol(laid, nextLine, Math.min(laid.col, nextRow.length), text.length);
}

export function composeInnerHeight(lineCount: number): number {
  return Math.min(MAX_COMPOSE_INNER, Math.max(MIN_COMPOSE_INNER, lineCount));
}

export function visibleComposeWindow(
  lines: string[],
  caretLine: number,
  inner: number,
): { lines: string[]; line: number } {
  const cap = Math.max(1, inner);
  if (lines.length <= cap) return { lines, line: caretLine };
  const maxStart = Math.max(0, lines.length - cap);
  const start = Math.min(Math.max(0, caretLine - cap + 1), maxStart);
  return { lines: lines.slice(start, start + cap), line: caretLine - start };
}

/** Split a wrapped compose line so the inverse cell sits on `col`. */
export function splitLineAtCaret(
  line: string,
  col: number,
): { before: string; cell: string; after: string } {
  const i = clampCaret(col, line.length);
  if (i >= line.length) return { before: line, cell: " ", after: "" };
  return { before: line.slice(0, i), cell: line.slice(i, i + 1), after: line.slice(i + 1) };
}

/** Subset of Ink `Key` used by compose editing. Ghostty on Mac: `meta` is Command. */
export type ComposeKey = {
  return?: boolean;
  shift?: boolean;
  meta?: boolean;
  super?: boolean;
  ctrl?: boolean;
  leftArrow?: boolean;
  rightArrow?: boolean;
  upArrow?: boolean;
  downArrow?: boolean;
  backspace?: boolean;
  delete?: boolean;
};

export type Draft = { text: string; caret: number };

export type ComposeCommand =
  | { type: "send" }
  | { type: "set"; draft: Draft }
  | { type: "scrollTranscript"; dir: "up" | "down" }
  | { type: "unhandled" };

function isCommand(key: ComposeKey): boolean {
  return key.meta === true || key.super === true;
}

/**
 * Compose-box keys. Mention-menu ↑↓/Enter are handled by the caller first.
 * Home/End are not handled here (they still scroll history).
 */
export function handleComposeKey(key: ComposeKey, draft: Draft, width: number): ComposeCommand {
  const laid = layoutCompose(draft.text, draft.caret, width);

  if (isCommand(key) && (key.backspace || key.delete)) {
    return { type: "set", draft: { text: "", caret: 0 } };
  }
  if (isCommand(key) && key.leftArrow) {
    return { type: "set", draft: { text: draft.text, caret: lineStartCaret(laid) } };
  }
  if (isCommand(key) && key.rightArrow) {
    return { type: "set", draft: { text: draft.text, caret: lineEndCaret(laid, draft.text.length) } };
  }
  if (key.upArrow && !key.ctrl && !isCommand(key)) {
    const next = moveCaretVertical(draft.text, draft.caret, width, -1);
    if (next == null) return { type: "scrollTranscript", dir: "up" };
    return { type: "set", draft: { text: draft.text, caret: next } };
  }
  if (key.downArrow && !key.ctrl && !isCommand(key)) {
    const next = moveCaretVertical(draft.text, draft.caret, width, 1);
    if (next == null) return { type: "scrollTranscript", dir: "down" };
    return { type: "set", draft: { text: draft.text, caret: next } };
  }
  if (key.leftArrow && !key.ctrl && !isCommand(key)) {
    return { type: "set", draft: { text: draft.text, caret: moveCaret(draft.caret, draft.text.length, -1) } };
  }
  if (key.rightArrow && !key.ctrl && !isCommand(key)) {
    return { type: "set", draft: { text: draft.text, caret: moveCaret(draft.caret, draft.text.length, 1) } };
  }
  if (key.ctrl && !key.shift && !key.leftArrow && !key.rightArrow && !key.upArrow && !key.downArrow) {
    return { type: "unhandled" };
  }
  if (key.return && key.shift) {
    return { type: "set", draft: insertAt(draft.text, draft.caret, "\n") };
  }
  if (key.return) {
    return { type: "send" };
  }
  if (key.backspace) {
    return { type: "set", draft: deleteBackward(draft.text, draft.caret) };
  }
  if (key.delete) {
    return { type: "set", draft: deleteForward(draft.text, draft.caret) };
  }
  return { type: "unhandled" };
}
