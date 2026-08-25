/**
 * Ctrl+letter detection that still works when Kitty CSI-u is in play.
 *
 * `disambiguateEscapeCodes` reports Ctrl+C as CSI-u (`ESC [ 99 ; 5 u`), not
 * `\x03`. Ink's `useInput` may then pass `input` as `""`, `"c"`, `"\x03"`, or
 * the CSI-u body (`[99;5u`), with the letter sometimes only on `name`/`text`.
 */

export type CtrlKeyFlags = {
  ctrl?: boolean;
  name?: string;
  text?: string;
  sequence?: string;
};

/** Kitty encodes modifiers as (bits + 1). Bit 4 is Ctrl. */
const KITTY_CTRL_BIT = 4;
const KITTY_CSI_U = /(?:\x1b)?\[(\d+)(?:;(\d+)(?::\d+)?)?(?:;[\d:]+)?u$/;

function parseKittyCsiU(raw: string): { codepoint: number; bits: number } | undefined {
  const match = KITTY_CSI_U.exec(raw);
  if (!match) return undefined;
  const codepoint = Number(match[1]);
  if (!Number.isFinite(codepoint)) return undefined;
  const encoded = match[2] != null ? Number(match[2]) : 1;
  const bits = Math.max(0, (Number.isFinite(encoded) ? encoded : 1) - 1);
  return { codepoint, bits };
}

function letterFromCodepoint(cp: number): string | undefined {
  if (cp >= 1 && cp <= 26) return String.fromCharCode(96 + cp);
  if ((cp >= 65 && cp <= 90) || (cp >= 97 && cp <= 122)) {
    return String.fromCharCode(cp).toLowerCase();
  }
  return undefined;
}

/** Tab/LF/CR/BS are also Ctrl+I/J/M/H; do not treat them as chords unless `key.ctrl`. */
function asciiCtrlImpliesChord(code: number): boolean {
  if (code < 1 || code > 26) return false;
  return code !== 8 && code !== 9 && code !== 10 && code !== 13;
}

function letterFromChunk(chunk: string): string | undefined {
  if (!chunk) return undefined;
  if (chunk.length === 1) {
    return letterFromCodepoint(chunk.charCodeAt(0));
  }
  const kitty = parseKittyCsiU(chunk);
  if (kitty) return letterFromCodepoint(kitty.codepoint);
  return undefined;
}

function chunkImpliesCtrl(chunk: string): boolean {
  if (!chunk) return false;
  if (chunk.length === 1) {
    return asciiCtrlImpliesChord(chunk.charCodeAt(0));
  }
  const kitty = parseKittyCsiU(chunk);
  return kitty != null && (kitty.bits & KITTY_CTRL_BIT) !== 0;
}

/**
 * True when this event is Ctrl+`letter`.
 *
 * Matches `input` of `c`/`C`/`\x03` (for `"c"`), ASCII ctrl codepoints 1–26
 * for other letters, or a kitty CSI-u whose codepoint is that letter. Also
 * checks `key.name` / `key.text` / `key.sequence` when Ink leaves `input` empty.
 */
export function isCtrlKey(input: string, key: CtrlKeyFlags, letter: string): boolean {
  const want = letter.toLowerCase();
  if (want.length !== 1 || want < "a" || want > "z") return false;

  const chunks = [input, key.name ?? "", key.text ?? "", key.sequence ?? ""];
  let matched = false;
  let ctrl = Boolean(key.ctrl);

  for (const chunk of chunks) {
    if (letterFromChunk(chunk) !== want) continue;
    matched = true;
    if (chunkImpliesCtrl(chunk)) ctrl = true;
  }

  return matched && ctrl;
}

/**
 * Ink's App-level `exitOnCtrlC` only matches raw `\x03`. Rewrite kitty CSI-u
 * Ctrl+C (codepoint 99 or 3, ctrl bit set) so that fallback still fires.
 */
export function rewriteKittyCtrlCChunk(chunk: string): string {
  return chunk.replace(/\x1b\[(99|3);(\d+)(?::\d+)?(?:;[\d:]+)?u/g, (full, _cp: string, mod: string) => {
    const bits = Math.max(0, Number(mod) - 1);
    return (bits & KITTY_CTRL_BIT) !== 0 ? "\x03" : full;
  });
}

