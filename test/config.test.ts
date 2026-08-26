import assert from "node:assert/strict";
import { test } from "node:test";
import {
  GATEWAY_PORT_KEY,
  GATEWAY_TOKEN_KEY,
  GATEWAY_URL_KEY,
  defaultLocalGatewayUrl,
  readConfig,
  readToken,
} from "../src/config.js";
import { DEFAULT_WAIT_TIMEOUT_MS, parseWaitTimeoutMs } from "../src/timing.js";

test("readConfig uses canonical gateway env names", () => {
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

test("readConfig treats wait timeout 0 as unlimited", () => {
  const config = readConfig({ GROK_TUI_WAIT_TIMEOUT_MS: "0" });
  assert.equal(config.waitTimeoutMs, undefined);
});

test("legacy gateway env names are ignored", () => {
  const config = readConfig({
    SAND_GATEWAY_URL: "http://stale.example:1340",
    SAND_GATEWAY_TOKEN: "legacy-token",
    SAND_HOST_PORT: "9999",
  });
  assert.equal(config.gatewayUrl, undefined);
  assert.equal(readToken({ SAND_GATEWAY_TOKEN: "legacy-token" }), undefined);
  assert.equal(defaultLocalGatewayUrl({ SAND_HOST_PORT: "9999" }), "http://127.0.0.1:1340");
});

test("defaultLocalGatewayUrl uses GROKBOT_GATEWAY_PORT", () => {
  assert.equal(defaultLocalGatewayUrl({}), "http://127.0.0.1:1340");
  assert.equal(defaultLocalGatewayUrl({ [GATEWAY_PORT_KEY]: "1999" }), "http://127.0.0.1:1999");
});

test("canonical URL and token beat missing legacy-only config", () => {
  assert.equal(readToken({ [GATEWAY_TOKEN_KEY]: "canonical", SAND_GATEWAY_TOKEN: "legacy" }), "canonical");
  assert.equal(
    readConfig({
      [GATEWAY_URL_KEY]: "http://canonical.example:1340",
      SAND_GATEWAY_URL: "http://legacy.example:1340",
    }).gatewayUrl,
    "http://canonical.example:1340",
  );
});

test("parseWaitTimeoutMs: unset defaults, exact 0 is unlimited, invalid falls back", () => {
  assert.equal(parseWaitTimeoutMs(undefined), DEFAULT_WAIT_TIMEOUT_MS);
  assert.equal(parseWaitTimeoutMs(""), DEFAULT_WAIT_TIMEOUT_MS);
  assert.equal(parseWaitTimeoutMs("nope"), DEFAULT_WAIT_TIMEOUT_MS);
  assert.equal(parseWaitTimeoutMs("-1"), DEFAULT_WAIT_TIMEOUT_MS);
  assert.equal(parseWaitTimeoutMs("0.5"), DEFAULT_WAIT_TIMEOUT_MS);
  assert.equal(parseWaitTimeoutMs("0ms"), DEFAULT_WAIT_TIMEOUT_MS);
  assert.equal(parseWaitTimeoutMs("0oops"), DEFAULT_WAIT_TIMEOUT_MS);
  assert.equal(parseWaitTimeoutMs("0"), undefined);
  assert.equal(parseWaitTimeoutMs("45000"), 45_000);
});
