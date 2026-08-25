import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ChatImage, ChatTurn } from "./types.js";

export type AttachmentCall = (method: string, body: Record<string, unknown>) => Promise<unknown>;

export type AttachmentIo = {
  call: AttachmentCall;
  /** Fetch `https://` `image.url` with the caller's session headers already applied. */
  fetchUrl?: (url: string) => Promise<Buffer | undefined>;
  cacheDir?: string;
};

export async function fetchBytesWithHeaders(
  url: string,
  headers: Record<string, string>,
): Promise<Buffer | undefined> {
  try {
    const res = await fetch(url, { headers });
    if (!res.ok) return undefined;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length > 0 ? buf : undefined;
  } catch {
    return undefined;
  }
}

const memory = new Map<string, string>();
const failed = new Set<string>();

export function resetAttachmentCacheForTests(): void {
  memory.clear();
  failed.clear();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function isFileUrl(value: string): boolean {
  return /^file:/i.test(value);
}

/** Absolute host/fs path, not a URL. */
export function isAbsFsPath(value: string): boolean {
  if (!value || isHttpUrl(value) || isFileUrl(value)) return false;
  return value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value);
}

function hashKey(parts: string[]): string {
  const h = createHash("sha256");
  for (const part of parts) h.update(part).update("\0");
  return h.digest("hex").slice(0, 24);
}

export function attachmentCacheKey(agentId: string, image: ChatImage): string {
  const id =
    image.id ||
    image.entryId ||
    image.file_path ||
    image.fileName ||
    image.alt ||
    image.mime ||
    "image";
  const hashedUrl = image.url ? hashKey([image.url]) : "";
  return hashKey([agentId, id, hashedUrl]);
}

function cacheDir(io: AttachmentIo): string {
  return io.cacheDir ?? join(tmpdir(), "grok-tui-images");
}

function extFor(image: ChatImage, bytes?: Buffer): string {
  const named = image.fileName || image.alt || "";
  const fromName = named ? extname(named).toLowerCase() : "";
  if (fromName && /^\.(png|jpe?g|gif|webp|svg)$/i.test(fromName)) return fromName;
  const mime = image.mime?.toLowerCase() ?? "";
  if (mime.includes("jpeg") || mime.includes("jpg")) return ".jpg";
  if (mime.includes("gif")) return ".gif";
  if (mime.includes("webp")) return ".webp";
  if (mime.includes("svg")) return ".svg";
  if (bytes && bytes.subarray(0, 3).toString() === "GIF") return ".gif";
  if (bytes && bytes.subarray(0, 2).toString("hex") === "ffd8") return ".jpg";
  if (bytes && bytes.subarray(0, 4).toString() === "RIFF") return ".webp";
  return ".png";
}

export function looksLikeImageBytes(buf: Buffer): boolean {
  if (buf.length < 8) return false;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return true;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true;
  if (buf.subarray(0, 6).toString("ascii") === "GIF87a" || buf.subarray(0, 6).toString("ascii") === "GIF89a") {
    return true;
  }
  if (buf.subarray(8, 12).toString("ascii") === "WEBP" && buf.subarray(0, 4).toString("ascii") === "RIFF") {
    return true;
  }
  const head = buf.subarray(0, 64).toString("utf8").trimStart().toLowerCase();
  return head.startsWith("<svg") || head.startsWith("<?xml");
}

function decodeBase64(raw: string): Buffer | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  let payload = trimmed;
  const dataUrl = /^data:([^,;]+)?(;base64)?,([\s\S]+)$/i.exec(trimmed);
  if (dataUrl) {
    payload = dataUrl[2] ? (dataUrl[3] ?? "") : Buffer.from(dataUrl[3] ?? "", "utf8").toString("base64");
  }
  const compact = payload.replace(/\s/g, "");
  if (compact.length < 16) return undefined;
  try {
    const buf = Buffer.from(compact, "base64");
    if (buf.length < 8) return undefined;
    if (looksLikeImageBytes(buf)) return buf;
    if (dataUrl) return buf;
  } catch {
    return undefined;
  }
  return undefined;
}

function stringList(value: unknown): string[] {
  if (typeof value === "string" && value.length > 0) return [value];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

/**
 * Host paths for `readAttachmentImage({ path })`. Never a `file://` string —
 * convert those with `fileURLToPath` first. Live host 400s without `path`.
 */
export function attachmentReadPaths(image: ChatImage): string[] {
  const out: string[] = [];
  const add = (value: string | undefined) => {
    if (!value || !isAbsFsPath(value)) return;
    if (out.includes(value)) return;
    out.push(value);
  };
  add(image.file_path);
  add(image.path);
  if (image.url && isFileUrl(image.url)) {
    try {
      add(fileURLToPath(image.url));
    } catch {
      // skip malformed file URL; do not log
    }
  }
  return out;
}

/**
 * Pull image bytes or a local path out of a host JSON result.
 * Does not log; payloads may contain URLs, dataUrls, or raw bytes.
 */
export function decodeAttachmentResult(raw: unknown): { bytes?: Buffer; path?: string } | undefined {
  if (raw == null) return undefined;
  if (Buffer.isBuffer(raw) && looksLikeImageBytes(raw)) return { bytes: raw };
  if (raw instanceof Uint8Array) {
    const buf = Buffer.from(raw);
    if (looksLikeImageBytes(buf)) return { bytes: buf };
  }
  if (typeof raw === "string") {
    if (!isHttpUrl(raw) && !isFileUrl(raw) && existsSync(raw)) return { path: raw };
    const bytes = decodeBase64(raw);
    if (bytes) return { bytes };
    return undefined;
  }
  if (!isRecord(raw)) return undefined;

  if (typeof raw.dataUrl === "string") {
    const bytes = decodeBase64(raw.dataUrl);
    if (bytes) return { bytes };
  }

  const nested = raw.result ?? raw.payload ?? raw.attachment ?? raw.image ?? raw.data;
  if (nested != null && nested !== raw) {
    const inner = decodeAttachmentResult(nested);
    if (inner) return inner;
  }

  const pathValue = raw.path;
  if (typeof pathValue === "string" && pathValue.length > 0 && isAbsFsPath(pathValue) && existsSync(pathValue)) {
    return { path: pathValue };
  }
  for (const path of stringList(raw.attachmentPaths)) {
    if (isAbsFsPath(path) && existsSync(path)) return { path };
  }

  for (const key of ["dataUrl", "data", "bytes", "content", "base64", "body", "png", "chunk"] as const) {
    const value = raw[key];
    if (typeof value === "string") {
      const bytes = decodeBase64(value);
      if (bytes) return { bytes };
    }
    if (Buffer.isBuffer(value) && looksLikeImageBytes(value)) return { bytes: value };
    if (value instanceof Uint8Array) {
      const buf = Buffer.from(value);
      if (looksLikeImageBytes(buf)) return { bytes: buf };
    }
  }
  return undefined;
}

function writeCache(dir: string, key: string, image: ChatImage, bytes: Buffer): string {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const dest = join(dir, `${key}${extFor(image, bytes)}`);
  writeFileSync(dest, bytes, { mode: 0o600 });
  memory.set(key, dest);
  return dest;
}

async function tryGateway(image: ChatImage, io: AttachmentIo, key: string): Promise<string | undefined> {
  const paths = attachmentReadPaths(image);
  for (const path of paths) {
    try {
      const raw = await io.call("readAttachmentImage", { path });
      const decoded = decodeAttachmentResult(raw);
      if (decoded?.bytes) return writeCache(cacheDir(io), key, image, decoded.bytes);
      if (decoded?.path && existsSync(decoded.path)) {
        memory.set(key, decoded.path);
        return decoded.path;
      }
    } catch {
      // Next host path. Do not log (paths / dataUrls / tokens).
    }
  }
  return undefined;
}

async function tryHttpsUrl(image: ChatImage, io: AttachmentIo, key: string): Promise<string | undefined> {
  if (!image.url || !io.fetchUrl || !isHttpUrl(image.url)) return undefined;
  try {
    const bytes = await io.fetchUrl(image.url);
    if (bytes && (looksLikeImageBytes(bytes) || image.mime?.startsWith("image/"))) {
      return writeCache(cacheDir(io), key, image, bytes);
    }
  } catch {
    return undefined;
  }
  return undefined;
}

async function hydrateOne(agentId: string, image: ChatImage, io: AttachmentIo): Promise<ChatImage> {
  if (image.path) {
    try {
      if (existsSync(image.path)) return image;
    } catch {
      // continue
    }
  }
  const key = attachmentCacheKey(agentId, image);
  const cached = memory.get(key);
  if (cached && existsSync(cached)) return { ...image, path: cached };
  const onDisk = join(cacheDir(io), `${key}${extFor(image)}`);
  if (existsSync(onDisk)) {
    memory.set(key, onDisk);
    return { ...image, path: onDisk };
  }
  if (failed.has(key)) return image;

  const fromHost = await tryGateway(image, io, key);
  if (fromHost) return { ...image, path: fromHost };

  const fromUrl = await tryHttpsUrl(image, io, key);
  if (fromUrl) return { ...image, path: fromUrl };

  failed.add(key);
  return image;
}

/** Download missing host attachments to a temp file. Skips images that already have bytes. */
export async function hydrateTurnImages(
  agentId: string,
  turns: ChatTurn[],
  io: AttachmentIo,
): Promise<ChatTurn[]> {
  const out: ChatTurn[] = [];
  for (const turn of turns) {
    const images = turn.images;
    if (!images || images.length === 0) {
      out.push(turn);
      continue;
    }
    const next: ChatImage[] = [];
    for (const image of images) {
      next.push(await hydrateOne(agentId, image, io));
    }
    out.push({ ...turn, images: next });
  }
  return out;
}
