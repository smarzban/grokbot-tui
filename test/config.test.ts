import assert from "node:assert/strict";
import { test } from "node:test";
import {
  GATEWAY_TOKEN_KEY,
  GATEWAY_URL_KEY,
  readConfig,
  readToken,
  resetConfigWarningsForTests,
} from "../src/config.js";
import { DEFAULT_WAIT_TIMEOUT_MS, parseWaitTimeoutMs } from "../src/timing.js";

test("readConfig uses canonical gateway env names", () => {
  resetConfigWarningsForTests();
  const config = readConfig({
    [GATEWAY_URL_KEY]: "http://127.0.0.1:1999",
    [GATEWAY_TOKEN_KEY]: "secret",
    GROK_TUI_WAIT_TIMEOUT_MS: "120000",
    GROK_TUI_POLL_MS: "2000",
  });
  assert.equal(config.gatewayUrl, "http://127.0.0.1:1999");
  assert.equal(readToken({ [GATEWAY_TOKEN_KEY]: "secret" }), "secret");
  assert.equal(config.waitTimeoutMs, 120_000);
  assert.equal(config.pollIntervalMs, 2000);
});

test("readConfig defaults wait timeout to ten minutes", () => {
  const config = readConfig({});
  assert.equal(config.waitTimeoutMs, DEFAULT_WAIT_TIMEOUT_MS);
});

test("readConfig warns once on legacy gateway env names", () => {
  resetConfigWarningsForTests();
  const lines: string[] = [];
  const stderr = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: string | Uint8Array) => {
    lines.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;
  try {
    readConfig({ SAND_GATEWAY_URL: "http://127.0.0.1:1340" });
    readConfig({ SAND_GATEWAY_URL: "http://127.0.0.1:1340" });
    assert.equal(lines.filter((line) => line.includes("SAND_GATEWAY_URL")).length, 1);
    assert.match(lines[0] ?? "", /GROKBOT_GATEWAY_URL/);
  } finally {
    process.stderr.write = stderr;
    resetConfigWarningsForTests();
  }
});

test("parseWaitTimeoutMs rejects invalid values", () => {
  assert.equal(parseWaitTimeoutMs(undefined), DEFAULT_WAIT_TIMEOUT_MS);
  assert.equal(parseWaitTimeoutMs(""), DEFAULT_WAIT_TIMEOUT_MS);
  assert.equal(parseWaitTimeoutMs("nope"), DEFAULT_WAIT_TIMEOUT_MS);
  assert.equal(parseWaitTimeoutMs("0"), DEFAULT_WAIT_TIMEOUT_MS);
  assert.equal(parseWaitTimeoutMs("45000"), 45_000);
});
