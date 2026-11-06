/**
 * Cursor login saved by the Grok Bot desktop app. Sends need this token.
 * The gateway box token cannot call SendGrokBotUserMessage.
 */
import { execFile as execFileCb } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { decryptSafeStorageString, readMacKeychainPassword } from "./session.js";
import type { CursorAccount } from "./types.js";

const execFile = promisify(execFileCb);

const APP_VERSION = /^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/;
const TEAM_ID = /^[1-9][0-9]*$/;

export type CursorAccountIo = {
  platform?: NodeJS.Platform;
  home?: string;
  env?: NodeJS.ProcessEnv;
  readFile?: (path: string) => string;
  readKeychainPassword?: () => string | Promise<string>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

export function grokBotAppDataDir(
  home: string,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv = {},
): string {
  if (platform === "linux") {
    const configHome = env.XDG_CONFIG_HOME?.trim() || join(home, ".config");
    return join(configHome, "Grok Bot");
  }
  if (platform === "darwin") {
    return join(home, "Library/Application Support/Grok Bot");
  }
  const appData = env.APPDATA?.trim() || join(home, "AppData/Roaming");
  return join(appData, "Grok Bot");
}

function prefixOf(encrypted: string): string {
  return Buffer.from(encrypted, "base64").subarray(0, 3).toString("latin1");
}

async function readLinuxKeychainPassword(): Promise<string> {
  const { stdout } = await execFile(
    "secret-tool",
    ["lookup", "xdg:schema", "chrome_libsecret_os_crypt_password_v2", "application", "Grok Bot"],
    { encoding: "utf8" },
  );
  return stdout.trimEnd();
}

async function storagePassword(
  encrypted: string,
  platform: NodeJS.Platform,
  io: CursorAccountIo,
): Promise<string> {
  if (platform === "linux" && prefixOf(encrypted) === "v10") return "peanuts";
  if (io.readKeychainPassword) return io.readKeychainPassword();
  if (platform === "linux") return readLinuxKeychainPassword();
  return readMacKeychainPassword();
}

type StoredLogin = {
  version: unknown;
  token: string;
  team: string | undefined;
};

function storedLogin(stored: unknown): StoredLogin {
  if (!isRecord(stored)) throw new Error("Grok Bot account storage is unreadable.");
  const raw = stored["cursor-accounts"];
  if (typeof raw !== "string" || raw.length === 0) {
    throw new Error("Grok Bot has no saved Cursor login.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error("Grok Bot account storage is unreadable.");
  }
  if (!isRecord(parsed) || typeof parsed.active !== "string" || !isRecord(parsed.accounts)) {
    throw new Error("Grok Bot has no saved Cursor login.");
  }
  const account = parsed.accounts[parsed.active];
  if (!isRecord(account)) throw new Error("Grok Bot has no saved Cursor login.");
  const token = account["cursor-access-token"];
  if (typeof token !== "string" || token.length === 0) {
    throw new Error("Grok Bot has no saved Cursor login.");
  }
  const team = account["cursor-selected-team-id"];
  return {
    version: stored.version,
    token,
    team: typeof team === "string" && team.length > 0 ? team : undefined,
  };
}

export function cursorAccountFromSecrets(
  stored: unknown,
  decrypt: (encrypted: string) => string,
): CursorAccount {
  const login = storedLogin(stored);
  if (login.version != null && login.version !== 1) {
    throw new Error(`Unsupported Grok Bot account storage version ${String(login.version)}.`);
  }
  const token = decrypt(login.token).trim();
  if (!token) throw new Error("Grok Bot has no saved Cursor login.");
  if (!login.team) return { token };
  const teamId = decrypt(login.team).trim();
  if (!TEAM_ID.test(teamId)) {
    throw new Error("Grok Bot active account has an invalid selected team.");
  }
  return { token, teamId };
}

export function appVersionFromStatus(text: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
  if (!isRecord(parsed) || typeof parsed.appVersion !== "string") return undefined;
  return APP_VERSION.test(parsed.appVersion) ? parsed.appVersion : undefined;
}

function readText(path: string, io: CursorAccountIo): string | undefined {
  if (io.readFile) return io.readFile(path);
  if (!existsSync(path)) return undefined;
  return readFileSync(path, "utf8");
}

export async function loadCursorAccount(io: CursorAccountIo = {}): Promise<CursorAccount | null> {
  const platform = io.platform ?? process.platform;
  if (platform !== "darwin" && platform !== "linux") return null;
  const home = io.home ?? homedir();
  const env = io.env ?? process.env;
  const path = join(grokBotAppDataDir(home, platform, env), "sand-secrets.json");
  const text = readText(path, io);
  if (text == null) return null;
  let stored: unknown;
  try {
    stored = JSON.parse(text) as unknown;
  } catch {
    throw new Error("Grok Bot account storage is unreadable.");
  }
  if (isRecord(stored) && stored.version != null && stored.version !== 1) {
    throw new Error(`Unsupported Grok Bot account storage version ${String(stored.version)}.`);
  }
  const login = storedLogin(stored);
  let password: string;
  try {
    password = await storagePassword(login.token, platform, io);
  } catch {
    throw new Error("Grok Bot login could not be decrypted.");
  }
  try {
    return cursorAccountFromSecrets(stored, (encrypted) =>
      decryptSafeStorageString(encrypted, password, platform),
    );
  } catch (err) {
    if (err instanceof Error && /Grok Bot/.test(err.message)) throw err;
    throw new Error("Grok Bot login could not be decrypted.");
  }
}

export function readInstalledAppVersion(io: CursorAccountIo = {}): string | undefined {
  const platform = io.platform ?? process.platform;
  const home = io.home ?? homedir();
  const env = io.env ?? process.env;
  const path = join(grokBotAppDataDir(home, platform, env), "desktop-status.json");
  const text = readText(path, io);
  if (text == null) return undefined;
  return appVersionFromStatus(text);
}
