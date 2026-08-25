import assert from "node:assert/strict";
import { createCipheriv, pbkdf2Sync } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  decryptSafeStorageString,
  encryptedPayloadFromDescriptor,
  grokBotGatewayDescriptorPath,
  loadDesktopSession,
  sessionFromCleartext,
} from "../src/client/session.js";

const PASSWORD = "keychain-test-password";
const TOKEN = "desk-session-token";
const ROUTING = "route-secret";

function encryptSafeStorage(cleartext: string, password: string): string {
  const key = pbkdf2Sync(password, "saltysalt", 1003, 16, "sha1");
  const cipher = createCipheriv("aes-128-cbc", key, Buffer.alloc(16, 32));
  const payload = Buffer.concat([Buffer.from("v10"), cipher.update(cleartext, "utf8"), cipher.final()]);
  return payload.toString("base64");
}

function descriptorCleartext(baseUrl = "https://edge.example/v1/sand/"): string {
  return JSON.stringify({
    baseUrl,
    token: TOKEN,
    headers: { "x-anyrun-network-token": ROUTING },
  });
}

test("decryptSafeStorageString round-trips Chromium v10 payloads", () => {
  const clear = descriptorCleartext();
  const encrypted = encryptSafeStorage(clear, PASSWORD);
  assert.equal(decryptSafeStorageString(encrypted, PASSWORD), clear);
});

test("version 1 descriptor uses encrypted; version 2 uses a single entries blob", () => {
  const blob = encryptSafeStorage(descriptorCleartext(), PASSWORD);
  assert.equal(encryptedPayloadFromDescriptor({ version: 1, encrypted: blob }), blob);
  assert.equal(encryptedPayloadFromDescriptor({ encrypted: blob }), blob);
  assert.equal(encryptedPayloadFromDescriptor({ version: 2, entries: blob }), blob);
  assert.equal(
    encryptedPayloadFromDescriptor({ version: 2, entries: { only: { encrypted: blob } } }),
    blob,
  );
  assert.throws(() => encryptedPayloadFromDescriptor({ version: 2, entries: {} }));
  assert.throws(() =>
    encryptedPayloadFromDescriptor({
      version: 2,
      entries: { a: { encrypted: blob }, b: { encrypted: blob } },
    }),
  );
});

test("sessionFromCleartext keeps the URL path and only trims a trailing slash", () => {
  const session = sessionFromCleartext(descriptorCleartext("https://edge.example/v1/sand/"));
  assert.equal(session.gatewayUrl, "https://edge.example/v1/sand");
  assert.equal(session.token, TOKEN);
  assert.equal(session.headers["x-anyrun-network-token"], ROUTING);
});

test("loadDesktopSession decrypts with an injected keychain read and never calls security", async () => {
  let keychainCalls = 0;
  const home = mkdtempSync(join(tmpdir(), "grok-tui-session-"));
  const dir = join(home, "Library/Application Support/Grok Bot");
  mkdirSync(dir, { recursive: true });
  const blob = encryptSafeStorage(descriptorCleartext(), PASSWORD);
  writeFileSync(join(dir, "gateway-descriptor.json"), JSON.stringify({ version: 1, encrypted: blob }));

  const session = await loadDesktopSession({
    platform: "darwin",
    home,
    readKeychainPassword: () => {
      keychainCalls += 1;
      return PASSWORD;
    },
  });
  assert.ok(session);
  assert.equal(session.gatewayUrl, "https://edge.example/v1/sand");
  assert.equal(session.token, TOKEN);
  assert.equal(session.headers["x-anyrun-network-token"], ROUTING);
  assert.equal(keychainCalls, 1);
  assert.equal(grokBotGatewayDescriptorPath(home), join(dir, "gateway-descriptor.json"));
});

test("loadDesktopSession returns null off macOS without reading the keychain", async () => {
  const session = await loadDesktopSession({
    platform: "linux",
    readKeychainPassword: () => {
      throw new Error("must not call security");
    },
  });
  assert.equal(session, null);
});

test("loadDesktopSession v2 single entries blob", async () => {
  const home = mkdtempSync(join(tmpdir(), "grok-tui-session-v2-"));
  const blob = encryptSafeStorage(descriptorCleartext(), PASSWORD);
  const session = await loadDesktopSession({
    platform: "darwin",
    home,
    readDescriptor: () => JSON.stringify({ version: 2, entries: { gw: { encrypted: blob } } }),
    readKeychainPassword: () => PASSWORD,
  });
  assert.ok(session);
  assert.equal(session.token, TOKEN);
});
