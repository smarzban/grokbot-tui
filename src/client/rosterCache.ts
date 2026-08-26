/**
 * Disk cache of the last successful listAgents roster so the lobby can open
 * before the slow gateway round-trip finishes. Never stores tokens.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { trimGatewayUrl } from "./http.js";
import type { Agent } from "./types.js";

const VERSION = 1;

export type RosterCacheIo = {
  home?: string;
  cacheDir?: string;
  readFileSync?: (path: string, encoding: "utf8") => string;
  writeFileSync?: (path: string, data: string, options: { mode: number }) => void;
  mkdirSync?: (path: string, options: { recursive: boolean; mode: number }) => void;
  existsSync?: (path: string) => boolean;
  unlinkSync?: (path: string) => void;
};

type CacheFile = {
  version: number;
  savedAtMs: number;
  agents: Agent[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function asCachedAgent(row: unknown): Agent | undefined {
  if (!isRecord(row)) return undefined;
  if (typeof row.id !== "string" || !row.id.trim()) return undefined;
  if (typeof row.name !== "string") return undefined;
  const agent: Agent = {
    id: row.id.trim(),
    name: row.name.trim() || row.id.trim(),
    isGroup: row.isGroup === true,
  };
  if (typeof row.title === "string" && row.title.trim()) agent.title = row.title.trim();
  if (Array.isArray(row.memberIds)) {
    const ids = row.memberIds.filter((id): id is string => typeof id === "string" && id.trim().length > 0);
    if (ids.length) agent.memberIds = ids;
  }
  if (Array.isArray(row.members)) {
    const members = [];
    for (const m of row.members) {
      if (!isRecord(m)) continue;
      if (typeof m.id !== "string" || !m.id.trim()) continue;
      if (typeof m.name !== "string") continue;
      members.push({ id: m.id.trim(), name: m.name.trim() || m.id.trim() });
    }
    if (members.length) agent.members = members;
  }
  return agent;
}

/** Stable key for a gateway URL. Never include the token. */
export function rosterCacheKey(gatewayUrl: string): string {
  const trimmed = trimGatewayUrl(gatewayUrl.trim());
  return createHash("sha256").update(trimmed).digest("hex").slice(0, 16);
}

export function rosterCacheDir(io: RosterCacheIo = {}): string {
  if (io.cacheDir) return io.cacheDir;
  const home = io.home ?? homedir();
  const xdg = process.env.XDG_CACHE_HOME?.trim();
  if (xdg) return join(xdg, "grok-tui");
  return join(home, ".cache", "grok-tui");
}

export function rosterCachePath(key: string, io: RosterCacheIo = {}): string {
  return join(rosterCacheDir(io), `roster-${key}.json`);
}

/**
 * Last successful roster for this gateway key.
 * `undefined` = miss/corrupt. Empty array = host had no agents (clears stale cache).
 */
export function readRosterCache(key: string, io: RosterCacheIo = {}): Agent[] | undefined {
  const path = rosterCachePath(key, io);
  const exists = io.existsSync ?? existsSync;
  if (!exists(path)) return undefined;
  try {
    const read = io.readFileSync ?? readFileSync;
    const raw = JSON.parse(read(path, "utf8")) as unknown;
    if (!isRecord(raw) || raw.version !== VERSION || !Array.isArray(raw.agents)) return undefined;
    const agents: Agent[] = [];
    for (const row of raw.agents) {
      const agent = asCachedAgent(row);
      if (agent) agents.push(agent);
    }
    // Legit empty host roster is a cache hit; rows that all fail validation is a miss.
    if (agents.length === 0 && raw.agents.length > 0) return undefined;
    return agents;
  } catch {
    return undefined;
  }
}

/**
 * Persist a roster (including empty). Never throws — disk failures must not
 * look like a gateway error to the caller.
 */
export function writeRosterCache(key: string, agents: Agent[], io: RosterCacheIo = {}): boolean {
  try {
    const dir = rosterCacheDir(io);
    const mkdir = io.mkdirSync ?? mkdirSync;
    mkdir(dir, { recursive: true, mode: 0o700 });
    const payload: CacheFile = {
      version: VERSION,
      savedAtMs: Date.now(),
      // Empty array clears a stale non-empty cache after the host removed everyone.
      agents: agents.map((agent) => ({
        id: agent.id,
        name: agent.name,
        isGroup: agent.isGroup,
        ...(agent.title ? { title: agent.title } : {}),
        ...(agent.memberIds?.length ? { memberIds: agent.memberIds } : {}),
        ...(agent.members?.length ? { members: agent.members } : {}),
      })),
    };
    const write = io.writeFileSync ?? writeFileSync;
    write(rosterCachePath(key, io), `${JSON.stringify(payload)}\n`, { mode: 0o600 });
    return true;
  } catch {
    return false;
  }
}

/** Optional cleanup helper for tests. */
export function clearRosterCache(key: string, io: RosterCacheIo = {}): void {
  const path = rosterCachePath(key, io);
  try {
    const unlink = io.unlinkSync ?? unlinkSync;
    unlink(path);
  } catch {
    // ignore
  }
}
