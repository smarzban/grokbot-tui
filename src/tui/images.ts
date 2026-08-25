import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ChatImage } from "../client/types.js";

/** Reserved transcript rows per on-disk image. Caps so chat still has room. */
export const IMAGE_CELL_ROWS = 8;
/** Max Kitty/half-block width in cells. */
export const IMAGE_CELL_COLS = 28;

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|svg)$/i;
const QUOTED_PATH_RE = /(['"])((?:file:\/\/|\/|~\/)[\s\S]*?)\1/gi;
const FILE_URL_RE = /file:\/\/\S+/gi;
const BARE_PATH_RE = /(?:^|[\s])((?:\/|~\/)[^\s'"]+\.(?:png|jpe?g|gif|webp|svg))/gi;

export function imagePlaceholder(image: ChatImage): string {
  const name = image.alt?.trim();
  return name ? `[image] ${name}` : "[image]";
}

function looksHttp(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function stripQuotes(value: string): string {
  const t = value.trim();
  if (t.length >= 2) {
    const start = t[0];
    const end = t[t.length - 1];
    if ((start === "'" && end === "'") || (start === '"' && end === '"')) return t.slice(1, -1);
  }
  return t;
}

/** Finder/terminal drag-quoting: `\ ` → space. */
function unescapeDragPath(value: string): string {
  return value.replace(/\\(.)/g, "$1");
}

function existingImageFile(file: string): string | undefined {
  try {
    const resolved = resolve(file);
    if (existsSync(resolved) && statSync(resolved).isFile()) return resolved;
  } catch {
    return undefined;
  }
  return undefined;
}

/** Resolve a pasted/dragged candidate to an on-disk image file, or undefined. */
export function resolveLocalImageFile(raw: string): string | undefined {
  let value = stripQuotes(raw.trim());
  if (!value || looksHttp(value)) return undefined;
  if (/^file:/i.test(value)) {
    try {
      value = fileURLToPath(value);
    } catch {
      try {
        value = fileURLToPath(unescapeDragPath(value));
      } catch {
        return undefined;
      }
    }
  } else {
    value = unescapeDragPath(value);
  }
  if (value.startsWith("~/")) value = `${homedir()}${value.slice(1)}`;
  if (!IMAGE_EXT_RE.test(value)) return undefined;
  return existingImageFile(value);
}

function pushImage(images: ChatImage[], seen: Set<string>, file: string): boolean {
  if (seen.has(file)) return false;
  seen.add(file);
  images.push({ path: file, alt: basename(file) });
  return true;
}

function collapseWs(value: string): string {
  return value
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .trim();
}

/**
 * Pull existing local image paths out of message text (paste, drag-quote, file://).
 * Remainder is shown as the bubble caption; a path-only message leaves no body line.
 */
export function imagesFromText(text: string): { text: string; images: ChatImage[] } {
  if (!text.trim()) return { text, images: [] };
  const images: ChatImage[] = [];
  const seen = new Set<string>();
  const tryAdd = (candidate: string): boolean => {
    const file = resolveLocalImageFile(candidate);
    return file ? pushImage(images, seen, file) : false;
  };

  if (tryAdd(text)) return { text: "", images };

  const lines = text.split("\n");
  if (lines.length > 1) {
    const kept: string[] = [];
    let hit = false;
    for (const line of lines) {
      if (tryAdd(line)) hit = true;
      else kept.push(line);
    }
    if (hit) return { text: kept.join("\n").trim(), images };
  }

  let remainder = text;
  for (const match of text.matchAll(QUOTED_PATH_RE)) {
    const inner = match[2] ?? "";
    if (tryAdd(inner) || tryAdd(match[0] ?? "")) remainder = remainder.replace(match[0] ?? "", " ");
  }
  for (const match of [...remainder.matchAll(FILE_URL_RE)]) {
    if (tryAdd(match[0] ?? "")) remainder = remainder.replace(match[0] ?? "", " ");
  }
  for (const match of [...remainder.matchAll(BARE_PATH_RE)]) {
    const token = match[1];
    if (token && tryAdd(token)) remainder = remainder.replace(token, " ");
  }
  return { text: collapseWs(remainder), images };
}

export function mergeImages(base: ChatImage[], extra: ChatImage[]): ChatImage[] {
  if (extra.length === 0) return base;
  const out = [...base];
  const keys = new Set(base.map((img) => localImagePath(img) ?? img.path ?? img.alt ?? ""));
  for (const img of extra) {
    const key = localImagePath(img) ?? img.path ?? "";
    if (!key || keys.has(key)) continue;
    keys.add(key);
    out.push(img);
  }
  return out;
}

/**
 * Local file we can hand to ink-picture. HTTP `url` is never used here —
 * those often need session headers, and we do not print or fetch them.
 */
export function localImagePath(image: ChatImage): string | undefined {
  const raw = image.path?.trim();
  if (!raw || looksHttp(raw)) return undefined;
  return resolveLocalImageFile(raw);
}

export function pictureKey(turnId: string, index: number): string {
  return `${turnId}:${index}`;
}
