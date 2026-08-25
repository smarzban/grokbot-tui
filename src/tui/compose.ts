export const MIN_COMPOSE_INNER = 1;
export const MAX_COMPOSE_INNER = 5;

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
  line: number;
  col: number;
};

/**
 * Hard-wrap `text` to `width` and map `caret` onto a line/column.
 * A caret sitting exactly on a wrap boundary is shown at col 0 of the next line
 * so the inverse cell stays inside the compose box.
 */
export function layoutCompose(text: string, caret: number, width: number): ComposeLayout {
  const w = Math.max(1, width);
  const c = clampCaret(caret, text.length);
  const lines: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") {
      lines.push(text.slice(start, i));
      start = i + 1;
      continue;
    }
    if (i - start + 1 === w) {
      lines.push(text.slice(start, i + 1));
      start = i + 1;
    }
  }
  lines.push(text.slice(start));
  if (lines.length === 0) lines.push("");

  const last = lines[lines.length - 1] ?? "";
  if (c === text.length && last.length === w && (text.length === 0 || text[text.length - 1] !== "\n")) {
    lines.push("");
  }

  let line = 0;
  let col = 0;
  let index = 0;
  for (let r = 0; r < lines.length; r++) {
    const row = lines[r] ?? "";
    const next = index + row.length;
    const newlineAfter = text[next] === "\n";
    if (c >= index && c <= next) {
      line = r;
      col = c - index;
      if (col === w && r + 1 < lines.length) {
        line = r + 1;
        col = 0;
      }
      break;
    }
    index = next + (newlineAfter ? 1 : 0);
    if (r === lines.length - 1) {
      line = r;
      col = row.length;
    }
  }
  return { lines, line, col };
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
