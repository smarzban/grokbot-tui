import assert from "node:assert/strict";
import { createCipheriv, pbkdf2Sync } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadCursorAccount, readInstalledAppVersion } from "../src/client/cursorAccount.js";

function encryptLinux(cleartext: string): string {
  const key = pbkdf2Sync("peanuts", "saltysalt", 1, 16, "sha1");
  const cipher = createCipheriv("aes-128-cbc", key, Buffer.alloc(16, 32));
  const payload = Buffer.concat([Buffer.from("v10"), cipher.update(cleartext, "utf8"), cipher.final()]);
  return payload.toString("base64");
}

function secretsFile(token: string, teamId?: string): string {
  const account: Record<string, string> = { "cursor-access-token": encryptLinux(token) };
  if (teamId) account["cursor-selected-team-id"] = encryptLinux(teamId);
  return JSON.stringify({
    version: 1,
    "cursor-accounts": JSON.stringify({ active: "acc", accounts: { acc: account } }),
  });
}

test("loadCursorAccount reads a Linux basic-text login without the keyring", async () => {
  const home = mkdtempSync(join(tmpdir(), "grok-tui-login-"));
  const dir = join(home, ".config/Grok Bot");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "sand-secrets.json"), secretsFile("cursor-token", "42"));
  writeFileSync(join(dir, "desktop-status.json"), JSON.stringify({ appVersion: "0.79.2" }));
  let keyringReads = 0;
  const account = await loadCursorAccount({
    platform: "linux",
    home,
    env: {},
    readKeychainPassword: () => {
      keyringReads += 1;
      throw new Error("keyring");
    },
  });
  assert.deepEqual(account, { token: "cursor-token", teamId: "42" });
  assert.equal(keyringReads, 0);
  assert.equal(readInstalledAppVersion({ platform: "linux", home, env: {} }), "0.79.2");
});

test("loadCursorAccount returns null when the app has no saved login", async () => {
  const home = mkdtempSync(join(tmpdir(), "grok-tui-nologin-"));
  const account = await loadCursorAccount({
    platform: "linux",
    home,
    env: {},
    readKeychainPassword: () => {
      throw new Error("must not read the keyring");
    },
  });
  assert.equal(account, null);
});

test("loadCursorAccount ignores Windows because this client cannot decrypt DPAPI", async () => {
  const account = await loadCursorAccount({
    platform: "win32",
    home: "/tmp/unused",
    readFile: () => {
      throw new Error("must not read secrets");
    },
  });
  assert.equal(account, null);
});
