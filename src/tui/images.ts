import { existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ChatImage } from "../client/types.js";

/** Reserved transcript rows per on-disk image. Caps so chat still has room. */
export const IMAGE_CELL_ROWS = 8;
/** Max Kitty/half-block width in cells. */
export const IMAGE_CELL_COLS = 28;

export function imagePlaceholder(image: ChatImage): string {
  const name = image.alt?.trim();
  return name ? `[image] ${name}` : "[image]";
}

function looksHttp(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

/**
 * Local file we can hand to ink-picture. HTTP `url` is never used here —
 * those often need session headers, and we do not print or fetch them.
 */
export function localImagePath(image: ChatImage): string | undefined {
  const raw = image.path?.trim();
  if (!raw || looksHttp(raw)) return undefined;
  let file = raw;
  if (raw.startsWith("file:")) {
    try {
      file = fileURLToPath(raw);
    } catch {
      return undefined;
    }
  }
  try {
    if (existsSync(file) && statSync(file).isFile()) return file;
  } catch {
    return undefined;
  }
  return undefined;
}

export function pictureKey(turnId: string, index: number): string {
  return `${turnId}:${index}`;
}
