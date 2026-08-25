/**
 * macOS Grok Bot desktop-app gateway session.
 *
 * Descriptor: ~/Library/Application Support/Grok Bot/gateway-descriptor.json
 * Keychain: /usr/bin/security find-generic-password -w -s "Grok Bot Safe Storage"
 * Decrypt: Chromium/Electron Safe Storage (v10 / pbkdf2 / aes-128-cbc).
 *
 * Token, descriptor payloads, and header values stay in memory. Never log them.
 */
import { execFile as execFileCb } from "node:child_process";
import { pbkdf2Sync, createDecipheriv } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { trimGatewayUrl } from "./http.js";

const execFile = promisify(execFileCb);

const SAFE_STORAGE_PREFIX = Buffer.from("v10");
const PBKDF2_SALT = "saltysalt";
const PBKDF2_ITERATIONS = 1003;
const PBKDF2_KEY_LEN = 16;
const AES_IV = Buffer.alloc(16, 32); // 16 ASCII spaces

export type DesktopSession = {
  gatewayUrl: string;
  token: string;
  headers: Record<string, string>;
};

export type DesktopSessionIo = {
  platform?: NodeJS.Platform;
  home?: string;
  readDescriptor?: (path: string) => string;
  /** Injected in tests. Default shells out to /usr/bin/security. */
  readKeychainPassword?: () => string | Promise<string>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

export function grokBotGatewayDescriptorPath(home = homedir()): string {
  return join(home, "Library/Application Support/Grok Bot/gateway-descriptor.json");
}

export async function readMacKeychainPassword(): Promise<string> {
  const { stdout } = await execFile(
    "/usr/bin/security",
    ["find-generic-password", "-w", "-s", "Grok Bot Safe Storage"],
    { encoding: "utf8" },
  );
  return stdout.trimEnd();
}

/** Chromium/Electron Safe Storage: payload starts with `v10`. */
export function decryptSafeStorageString(encryptedBase64: string, password: string): string {
  const encrypted = Buffer.from(encryptedBase64, "base64");
  if (encrypted.length < 4 || !encrypted.subarray(0, 3).equals(SAFE_STORAGE_PREFIX)) {
    throw new Error("Unsupported Grok Bot Safe Storage format.");
  }
  const key = pbkdf2Sync(password, PBKDF2_SALT, PBKDF2_ITERATIONS, PBKDF2_KEY_LEN, "sha1");
  const decipher = createDecipheriv("aes-128-cbc", key, AES_IV);
  return Buffer.concat([decipher.update(encrypted.subarray(3)), decipher.final()]).toString("utf8");
}

function encryptedFromV2Entries(entries: unknown): string {
  if (typeof entries === "string" && entries.length > 0) return entries;
  if (!isRecord(entries)) {
    throw new Error("Grok Bot gateway descriptor is missing an encrypted payload.");
  }
  const values = Object.values(entries);
  if (values.length === 0) {
    throw new Error("Grok Bot gateway descriptor has no saved gateway entries.");
  }
  if (values.length > 1) {
    throw new Error("Grok Bot gateway descriptor has multiple saved gateway entries.");
  }
  const first = values[0];
  if (typeof first === "string" && first.length > 0) return first;
  if (isRecord(first) && typeof first.encrypted === "string" && first.encrypted.length > 0) {
    return first.encrypted;
  }
  throw new Error("Grok Bot gateway descriptor is missing an encrypted payload.");
}

/** Version 1 uses `encrypted`; version 2 uses a single `entries` blob. */
export function encryptedPayloadFromDescriptor(wrapped: unknown): string {
  if (!isRecord(wrapped)) {
    throw new Error("Grok Bot gateway descriptor is missing an encrypted payload.");
  }
  const version = wrapped.version;
  if (version != null && version !== 1 && version !== 2) {
    throw new Error(`Unsupported Grok Bot gateway descriptor version ${String(version)}.`);
  }
  if (version === 2) return encryptedFromV2Entries(wrapped.entries);
  if (typeof wrapped.encrypted === "string" && wrapped.encrypted.length > 0) return wrapped.encrypted;
  throw new Error("Grok Bot gateway descriptor is missing an encrypted payload.");
}

function headersFromCleartext(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string" && item.length > 0) out[key] = item;
  }
  return out;
}

export function sessionFromCleartext(clear: string): DesktopSession {
  const descriptor = JSON.parse(clear) as unknown;
  if (!isRecord(descriptor)) {
    throw new Error("Decrypted Grok Bot gateway descriptor is incomplete.");
  }
  const baseUrl = typeof descriptor.baseUrl === "string" ? descriptor.baseUrl : "";
  const token = typeof descriptor.token === "string" ? descriptor.token : "";
  if (!baseUrl || !token) {
    throw new Error("Decrypted Grok Bot gateway descriptor is incomplete.");
  }
  return {
    gatewayUrl: trimGatewayUrl(baseUrl),
    token,
    headers: headersFromCleartext(descriptor.headers),
  };
}

export async function loadDesktopSession(io: DesktopSessionIo = {}): Promise<DesktopSession | null> {
  const platform = io.platform ?? process.platform;
  if (platform !== "darwin") return null;

  const home = io.home ?? homedir();
  const path = grokBotGatewayDescriptorPath(home);
  const readDescriptor = io.readDescriptor ?? ((file) => readFileSync(file, "utf8"));
  const readPassword = io.readKeychainPassword ?? readMacKeychainPassword;

  try {
    if (!io.readDescriptor && !existsSync(path)) return null;
    const wrapped = JSON.parse(readDescriptor(path)) as unknown;
    const encrypted = encryptedPayloadFromDescriptor(wrapped);
    const password = await readPassword();
    return sessionFromCleartext(decryptSafeStorageString(encrypted, password));
  } catch {
    return null;
  }
}
