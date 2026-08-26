import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  readRosterCache,
  rosterCacheKey,
  rosterCachePath,
  writeRosterCache,
} from "../src/client/rosterCache.js";
import type { Agent } from "../src/client/types.js";

const SAMPLE: Agent[] = [
  { id: "a1", name: "Ada", isGroup: false },
  {
    id: "g1",
    name: "Project X",
    isGroup: true,
    memberIds: ["a1", "b1"],
    members: [
      { id: "a1", name: "Ada" },
      { id: "b1", name: "Bea" },
    ],
  },
];

test("rosterCacheKey is stable and ignores trailing slash", () => {
  assert.equal(rosterCacheKey("http://127.0.0.1:1340"), rosterCacheKey("http://127.0.0.1:1340/"));
  assert.notEqual(rosterCacheKey("http://127.0.0.1:1340"), rosterCacheKey("http://127.0.0.1:1341"));
});

test("rosterCacheKey differs when credential id differs on the same URL", () => {
  const url = "http://127.0.0.1:1340";
  assert.notEqual(rosterCacheKey(url, "aaa"), rosterCacheKey(url, "bbb"));
});

test("writeRosterCache round-trips agents without busy flags", () => {
  const dir = mkdtempSync(join(tmpdir(), "grok-tui-roster-"));
  try {
    const key = rosterCacheKey("http://example.test:9");
    writeRosterCache(
      key,
      [
        { ...SAMPLE[0]!, isRunning: true, isComposingMessage: true },
        SAMPLE[1]!,
      ],
      { cacheDir: dir },
    );
    const path = rosterCachePath(key, { cacheDir: dir });
    const disk = JSON.parse(readFileSync(path, "utf8")) as { agents: Agent[] };
    assert.equal(disk.agents[0]?.isRunning, undefined);
    const loaded = readRosterCache(key, { cacheDir: dir });
    assert.deepEqual(loaded, SAMPLE);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readRosterCache returns undefined for missing or corrupt files", () => {
  const dir = mkdtempSync(join(tmpdir(), "grok-tui-roster-miss-"));
  try {
    assert.equal(readRosterCache("missing", { cacheDir: dir }), undefined);
    const key = "bad";
    mkdirSync(dir, { recursive: true });
    writeFileSync(rosterCachePath(key, { cacheDir: dir }), "{not-json\n", { mode: 0o600 });
    assert.equal(readRosterCache(key, { cacheDir: dir }), undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("writeRosterCache persists an empty roster so a stale cache is cleared", () => {
  const dir = mkdtempSync(join(tmpdir(), "grok-tui-roster-empty-"));
  try {
    writeRosterCache("empty", SAMPLE, { cacheDir: dir });
    assert.equal(readRosterCache("empty", { cacheDir: dir })?.length, 2);
    writeRosterCache("empty", [], { cacheDir: dir });
    assert.deepEqual(readRosterCache("empty", { cacheDir: dir }), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readRosterCache treats all-invalid agent rows as a miss, not an empty hit", () => {
  const dir = mkdtempSync(join(tmpdir(), "grok-tui-roster-corrupt-"));
  try {
    const key = "corrupt";
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      rosterCachePath(key, { cacheDir: dir }),
      `${JSON.stringify({ version: 1, savedAtMs: 1, agents: [{ id: "", name: 42 }] })}\n`,
      { mode: 0o600 },
    );
    assert.equal(readRosterCache(key, { cacheDir: dir }), undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("writeRosterCache returns false instead of throwing on disk failure", () => {
  const ok = writeRosterCache("x", SAMPLE, {
    cacheDir: "/tmp",
    mkdirSync: () => {
      throw new Error("disk full");
    },
  });
  assert.equal(ok, false);
});

test("writeRosterCache removes a symlink roster file before writing", () => {
  const dir = mkdtempSync(join(tmpdir(), "grok-tui-roster-symlink-"));
  try {
    const key = "symlink";
    const path = rosterCachePath(key, { cacheDir: dir });
    mkdirSync(dir, { recursive: true });
    let unlinked = false;
    writeRosterCache(key, SAMPLE, {
      cacheDir: dir,
      existsSync: (p) => (p === path ? true : existsSync(p)),
      lstatSync: (p) =>
        p === path
          ? { isSymbolicLink: () => true, isDirectory: () => false }
          : lstatSync(p),
      unlinkSync: (p) => {
        if (p === path) unlinked = true;
        else unlinkSync(p);
      },
    });
    assert.equal(unlinked, true);
    assert.ok(existsSync(join(dir, `roster-${key}.json`)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
