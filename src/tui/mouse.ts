import { applyScrollDelta, clampScrollOffset } from "./layout.js";

/** Lines per wheel tick / arrow key. Matches a typical terminal wheel mapping. */
export const WHEEL_LINE_DELTA = 3;

/** SGR button ids: 64 = wheel up / older, 65 = wheel down / newer. */
export const WHEEL_UP_BUTTON = 64;
export const WHEEL_DOWN_BUTTON = 65;

/** Enable SGR encoding first so reports are `CSI < btn ; x ; y M`, then button tracking. */
export const ENABLE_MOUSE = "\x1b[?1006h\x1b[?1000h";
/** Disable button tracking, then SGR. */
export const DISABLE_MOUSE = "\x1b[?1000l\x1b[?1006l";

export type ParsedMouse = {
  button: number;
  x: number;
  y: number;
  release: boolean;
};

const SGR_AT_START = /^(?:\x1b)?\[<(\d+);(\d+);(\d+)([Mm])/;
const X10_AT_START = /^(?:\x1b)?\[M[\s\S]{3}/;

/** Shift / Alt / Ctrl bits on SGR button codes. */
const MODIFIER_MASK = 0b11100;

export function parseSgrMouse(seq: string): ParsedMouse | null {
  const m = /^(?:\x1b)?\[<(\d+);(\d+);(\d+)([Mm])$/.exec(seq);
  if (!m || m[1] == null || m[2] == null || m[3] == null || m[4] == null) return null;
  return {
    button: Number(m[1]),
    x: Number(m[2]),
    y: Number(m[3]),
    release: m[4] === "m",
  };
}

export function parseX10Mouse(seq: string): ParsedMouse | null {
  const m = /^(?:\x1b)?\[M([\s\S]{3})$/.exec(seq);
  if (!m || m[1] == null) return null;
  const bytes = m[1];
  return {
    button: bytes.charCodeAt(0) - 32,
    x: bytes.charCodeAt(1) - 32,
    y: bytes.charCodeAt(2) - 32,
    release: false,
  };
}

/**
 * Pull complete SGR / X10 mouse reports out of a stdin chunk.
 * Ink 7 strips the leading ESC before useInput, so both `\x1b[<…M` and `[<…M` match.
 */
export function consumeMouseInput(input: string): { events: ParsedMouse[]; rest: string } {
  const events: ParsedMouse[] = [];
  let rest = "";
  let i = 0;
  while (i < input.length) {
    const slice = input.slice(i);
    const sgr = SGR_AT_START.exec(slice);
    if (sgr && sgr[1] != null && sgr[2] != null && sgr[3] != null && sgr[4] != null) {
      events.push({
        button: Number(sgr[1]),
        x: Number(sgr[2]),
        y: Number(sgr[3]),
        release: sgr[4] === "m",
      });
      i += sgr[0].length;
      continue;
    }
    const x10 = X10_AT_START.exec(slice);
    if (x10) {
      const encoded = x10[0].slice(x10[0].indexOf("M") + 1);
      events.push({
        button: encoded.charCodeAt(0) - 32,
        x: encoded.charCodeAt(1) - 32,
        y: encoded.charCodeAt(2) - 32,
        release: false,
      });
      i += x10[0].length;
      continue;
    }
    rest += input[i];
    i += 1;
  }
  return { events, rest };
}

export function isMouseInput(input: string): boolean {
  if (!input) return false;
  const { events, rest } = consumeMouseInput(input);
  return events.length > 0 && rest.length === 0;
}

/** Positive = older (increase offset). Null if this button is not a vertical wheel. */
export function scrollDeltaForButton(button: number): number | null {
  const base = button & ~MODIFIER_MASK;
  if (base === WHEEL_UP_BUTTON) return WHEEL_LINE_DELTA;
  if (base === WHEEL_DOWN_BUTTON) return -WHEEL_LINE_DELTA;
  return null;
}

export function applyWheelScroll(
  offset: number,
  direction: "up" | "down",
  rowCount: number,
  budget: number,
): number {
  const delta = direction === "up" ? WHEEL_LINE_DELTA : -WHEEL_LINE_DELTA;
  return applyScrollDelta(offset, delta, rowCount, budget);
}

export function applyWheelButton(
  offset: number,
  button: number,
  rowCount: number,
  budget: number,
): number {
  const delta = scrollDeltaForButton(button);
  if (delta == null) return clampScrollOffset(offset, rowCount, budget);
  return applyScrollDelta(offset, delta, rowCount, budget);
}
