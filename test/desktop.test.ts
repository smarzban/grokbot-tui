import assert from "node:assert/strict";
import { test } from "node:test";
import { resetAttachmentCacheForTests } from "../src/client/attachments.js";
import { openHostClient } from "../src/client/factory.js";
import { HttpHostClient } from "../src/client/host.js";
import { MockHostClient } from "../src/client/mock.js";
import { HostClientError } from "../src/client/types.js";
import { readConfig } from "../src/config.js";

const ADA_ID = "11111111-1111-4111-8111-111111111111";
const BASE = "https://edge.example/v1/sand";
const TOKEN = "desk-token";
const ROUTING_HEADER = "x-anyrun-network-token";
const ROUTING_VALUE = "route-secret";

type RecordedCall = {
  method: string;
  url: string;
  hasRoutingHeader: boolean;
  hasBearer: boolean;
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function createDesktopFetch(state: { sent?: boolean; calls: RecordedCall[] }): typeof fetch {
  const impl: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = new Headers(init?.headers);
    const hasRoutingHeader = headers.get(ROUTING_HEADER) === ROUTING_VALUE;
    const hasBearer = headers.get("authorization") === `Bearer ${TOKEN}`;
    state.calls.push({ method, url, hasRoutingHeader, hasBearer });

    const parsed = new URL(url);
    if (method === "GET" && parsed.pathname.endsWith("/health")) {
      return json(404, { error: "not found" });
    }

    if (!parsed.pathname.startsWith("/v1/sand/api/")) {
      return json(404, { error: "unknown path" });
    }
    if (!hasRoutingHeader || !hasBearer) {
      return json(404, { error: "missing routing" });
    }

    const command = parsed.pathname.slice("/v1/sand/api/".length);
    if (command === "listAgents") {
      return json(200, [
        { id: ADA_ID, name: "Ada", isGroup: false, isRunning: true, isComposingMessage: false },
        {
          id: "55555555-5555-4555-8555-555555555555",
          name: "project X",
          isGroup: true,
          memberIds: [ADA_ID],
          isRunning: false,
        },
      ]);
    }
    if (command === "sendPrompt") {
      state.sent = true;
      return json(200, { accepted: true });
    }
    if (command === "getAgentTranscriptTail") {
      const entries = state.sent
        ? [
            { kind: "message", role: "user", content: "status only", timestampMs: 1 },
            { kind: "message", role: "assistant", content: "Ada reply: status only", timestampMs: 2 },
          ]
        : [];
      return json(200, { entries });
    }
    if (command === "interruptAgentRun") {
      return json(200, { hadActiveRun: false });
    }
    return json(404, { error: "unknown command" });
  };
  return impl;
}

async function withFetch<T>(impl: typeof fetch, run: () => Promise<T>): Promise<T> {
  const previous = globalThis.fetch;
  globalThis.fetch = impl;
  try {
    return await run();
  } finally {
    globalThis.fetch = previous;
  }
}

function desktopClient(): HttpHostClient {
  return new HttpHostClient({
    gatewayUrl: BASE,
    token: TOKEN,
    headers: { [ROUTING_HEADER]: ROUTING_VALUE },
    source: "desktop",
  });
}

test("desktop client preserves gateway URL path and sends session headers", async () => {
  const state = { calls: [] as RecordedCall[] };
  await withFetch(createDesktopFetch(state), async () => {
    const agents = await desktopClient().listAgents();
    assert.equal(agents.length, 2);
    assert.equal(agents[0]?.name, "Ada");
    assert.equal(agents[0]?.id, ADA_ID);
    assert.equal(agents[0]?.isRunning, true);
    const room = agents.find((agent) => agent.isGroup);
    assert.ok(room);
    assert.equal(room.name, "project X");
    assert.deepEqual(room.memberIds, [ADA_ID]);
    assert.equal(room.members?.[0]?.name, "Ada");
  });
  assert.ok(state.calls.length >= 1);
  for (const call of state.calls) {
    assert.equal(call.hasRoutingHeader, true);
    assert.equal(call.hasBearer, true);
    assert.match(call.url, /https:\/\/edge\.example\/v1\/sand\/api\//);
    assert.doesNotMatch(call.url, /https:\/\/edge\.example\/api\//);
    assert.equal(call.method, "POST");
  }
  assert.equal(state.calls[0]?.url, `${BASE}/api/listAgents`);
});

test("desktop client does not probe GET /health", async () => {
  const state = { calls: [] as RecordedCall[] };
  await withFetch(createDesktopFetch(state), async () => {
    await desktopClient().listAgents();
  });
  assert.equal(state.calls.some((call) => call.method === "GET"), false);
  assert.equal(state.calls.some((call) => call.url.includes("/health")), false);
});

test("desktop client sendPrompt polls transcript until a reply", async () => {
  const state = { calls: [] as RecordedCall[], sent: false };
  const result = await withFetch(createDesktopFetch(state), () =>
    desktopClient().sendPrompt({ agentId: ADA_ID, prompt: "status only", wait: true, timeoutMs: 5_000 }),
  );
  assert.equal(result.accepted, true);
  assert.equal(result.status, "idle");
  assert.equal(result.reply, "Ada reply: status only");
  assert.ok(state.calls.some((call) => call.url.endsWith("/api/sendPrompt")));
  assert.ok(state.calls.every((call) => call.hasRoutingHeader && call.hasBearer));
});

test("desktop getTranscript writes a local file from readAttachmentImage", async () => {
  resetAttachmentCacheForTests();
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  let imageCalls = 0;
  const impl: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = new Headers(init?.headers);
    const hasRoutingHeader = headers.get(ROUTING_HEADER) === ROUTING_VALUE;
    const hasBearer = headers.get("authorization") === `Bearer ${TOKEN}`;
    if (method === "GET") return json(404, { error: "not found" });
    const parsed = new URL(url);
    if (!parsed.pathname.startsWith("/v1/sand/api/")) {
      return json(404, { error: "not the gateway" });
    }
    if (!hasRoutingHeader || !hasBearer) return json(404, { error: "missing routing" });
    const command = parsed.pathname.slice("/v1/sand/api/".length);
    if (command === "listAgents") {
      return json(200, [{ id: ADA_ID, name: "Ada", isGroup: false }]);
    }
    if (command === "getAgentTranscriptTail") {
      return json(200, {
        entries: [
          {
            id: "t-ui-pass-ua0",
            kind: "user-attachment",
            file_name: "ui-pass.png",
            file_path: "/home/box/sand-data/ui-pass.png",
            width: 8,
            height: 8,
            timestampMs: 1,
          },
        ],
      });
    }
    if (command === "readAttachmentImage") {
      imageCalls += 1;
      const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : {};
      assert.equal(body.path, "/home/box/sand-data/ui-pass.png");
      assert.ok(!String(body.path).startsWith("file:"));
      return json(200, { dataUrl: `data:image/png;base64,${png.toString("base64")}`, width: 8, height: 8 });
    }
    return json(404, { error: "unknown command" });
  };
  const turns = await withFetch(impl, () => desktopClient().getTranscript(ADA_ID));
  const image = turns[0]?.images?.[0];
  assert.equal(image?.fileName, "ui-pass.png");
  assert.equal(image?.file_path, "/home/box/sand-data/ui-pass.png");
  assert.ok(image?.path);
  const { readFileSync, existsSync } = await import("node:fs");
  assert.equal(existsSync(image.path), true);
  assert.deepEqual(readFileSync(image.path), png);
  const firstCalls = imageCalls;
  assert.ok(firstCalls >= 1);
  await withFetch(impl, () => desktopClient().getTranscript(ADA_ID));
  assert.equal(imageCalls, firstCalls, "idle poll must not re-download");
});

test("desktop 404 without routing headers", async () => {
  const state = { calls: [] as RecordedCall[] };
  await withFetch(createDesktopFetch(state), async () => {
    const client = new HttpHostClient({
      gatewayUrl: BASE,
      token: TOKEN,
      headers: {},
      source: "desktop",
    });
    await assert.rejects(() => client.listAgents(), (err: unknown) => {
      assert.ok(err instanceof HostClientError);
      assert.equal(err.status, 404);
      assert.doesNotMatch(err.message, /route-secret/);
      assert.doesNotMatch(err.message, /desk-token/);
      return true;
    });
  });
});

test("openHostClient uses desktop source for a desktop session", async () => {
  const client = await openHostClient({
    config: readConfig({}),
    env: {},
    loadDesktop: async () => ({
      gatewayUrl: BASE,
      token: TOKEN,
      headers: { [ROUTING_HEADER]: ROUTING_VALUE },
    }),
  });
  assert.equal(client.source, "desktop");
  const state = { calls: [] as RecordedCall[] };
  await withFetch(createDesktopFetch(state), async () => {
    const agents = await client.listAgents();
    assert.equal(agents[0]?.name, "Ada");
  });
});

test("openHostClient ignores a URL without a token and uses desktop", async () => {
  const client = await openHostClient({
    config: { ...readConfig({}), gatewayUrl: "http://stale.example:1340", mock: false },
    env: {},
    loadDesktop: async () => ({
      gatewayUrl: BASE,
      token: TOKEN,
      headers: { [ROUTING_HEADER]: ROUTING_VALUE },
    }),
  });
  assert.equal(client.source, "desktop");
  const state = { calls: [] as RecordedCall[] };
  await withFetch(createDesktopFetch(state), async () => {
    const agents = await client.listAgents();
    assert.equal(agents[0]?.name, "Ada");
  });
  assert.ok(state.calls.some((call) => call.url.startsWith(`${BASE}/api/`)));
  assert.equal(state.calls.some((call) => call.url.includes("stale.example")), false);
});

test("listAgents fails host-down on the mock path", async () => {
  const mock = new MockHostClient({ hostDown: true });
  await assert.rejects(() => mock.listAgents(), (err: unknown) => {
    assert.ok(err instanceof HostClientError);
    assert.equal(err.kind, "host-down");
    return true;
  });
});
