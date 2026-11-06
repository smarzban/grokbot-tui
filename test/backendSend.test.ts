import assert from "node:assert/strict";
import { test } from "node:test";
import { HttpHostClient } from "../src/client/host.js";

const GATEWAY = "http://127.0.0.1:1340";
const BOX_TOKEN = "box-session-token";
const CURSOR_TOKEN = "cursor-access-token";

type Seen = {
  url: string;
  authorization: string | null;
  contentType: string | null;
  clientType: string | null;
  clientVersion: string | null;
  teamId: string | null;
  body: Buffer;
};

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function bodyBytes(body: NonNullable<Parameters<typeof fetch>[1]>["body"]): Buffer {
  if (body == null) return Buffer.alloc(0);
  if (typeof body === "string") return Buffer.from(body);
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  throw new Error("unexpected request body");
}

test("sendPrompt with a Cursor account posts SendGrokBotUserMessage and skips the gateway send", async () => {
  const calls: Seen[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = requestUrl(input);
    const headers = new Headers(init?.headers);
    calls.push({
      url,
      authorization: headers.get("authorization"),
      contentType: headers.get("content-type"),
      clientType: headers.get("x-cursor-client-type"),
      clientVersion: headers.get("x-cursor-client-version"),
      teamId: headers.get("x-cursor-team-id"),
      body: bodyBytes(init?.body),
    });
    if (url.includes("SendGrokBotUserMessage")) {
      return new Response(Uint8Array.from([0x08, 1, 0x20, 2]), {
        status: 200,
        headers: { "content-type": "application/proto" },
      });
    }
    if (url.endsWith("/api/sendPrompt")) {
      return new Response(
        JSON.stringify({ message: "A Sand box session is not permitted on this endpoint." }),
        { status: 502, headers: { "content-type": "application/json" } },
      );
    }
    return new Response(JSON.stringify({ error: "unexpected" }), { status: 404 });
  };

  const client = new HttpHostClient({
    gatewayUrl: GATEWAY,
    token: BOX_TOKEN,
    source: "gateway",
    fetch: fetchImpl,
    cursorAccount: async () => ({ token: CURSOR_TOKEN, teamId: "7" }),
    clientVersion: () => "0.79.2",
  });

  const result = await client.sendPrompt({
    agentId: "ada",
    prompt: "hi",
    wait: false,
  });

  assert.equal(result.accepted, true);
  assert.equal(result.status, "idle");
  assert.equal(calls.some((call) => call.url.endsWith("/api/sendPrompt")), false);
  const sent = calls.find((call) => call.url.endsWith("SendGrokBotUserMessage"));
  assert.ok(sent);
  assert.equal(sent.authorization, `Bearer ${CURSOR_TOKEN}`);
  assert.equal(sent.authorization?.includes(BOX_TOKEN), false);
  assert.equal(sent.contentType, "application/proto");
  assert.equal(sent.clientType, "sand");
  assert.equal(sent.clientVersion, "0.79.2");
  assert.equal(sent.teamId, "7");
  assert.ok(sent.body.includes(Buffer.from("ada")));
  assert.ok(sent.body.includes(Buffer.from("hi")));
  assert.ok(sent.body.includes(Buffer.from([0x68, 1])));
  assert.ok(sent.body.includes(Buffer.from([0xa8, 1])));
});

test("sendPrompt keeps the gateway path when no Cursor account is saved", async () => {
  const urls: string[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = requestUrl(input);
    urls.push(url);
    if (url.endsWith("/api/sendPrompt")) {
      return new Response(JSON.stringify({ accepted: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ error: "unexpected" }), { status: 404 });
  };
  const client = new HttpHostClient({
    gatewayUrl: GATEWAY,
    token: BOX_TOKEN,
    source: "gateway",
    fetch: fetchImpl,
    cursorAccount: async () => null,
  });
  const result = await client.sendPrompt({ agentId: "ada", prompt: "hi", wait: false });
  assert.equal(result.accepted, true);
  assert.ok(urls.some((url) => url.endsWith("/api/sendPrompt")));
  assert.equal(urls.some((url) => url.includes("SendGrokBotUserMessage")), false);
});

test("a refused backend send surfaces the refusal and does not fall back to the gateway", async () => {
  const urls: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    const url = requestUrl(input);
    urls.push(url);
    const refusal = Buffer.from([0x12, 4, 0x6e, 0x6f, 0x70, 0x65]);
    return new Response(Buffer.concat([Buffer.from([0x20, 4, 0x2a, refusal.length]), refusal]), {
      status: 200,
      headers: { "content-type": "application/proto" },
    });
  };
  const client = new HttpHostClient({
    gatewayUrl: GATEWAY,
    token: BOX_TOKEN,
    source: "gateway",
    fetch: fetchImpl,
    cursorAccount: async () => ({ token: CURSOR_TOKEN }),
  });
  await assert.rejects(
    () => client.sendPrompt({ agentId: "ada", prompt: "hi", wait: false }),
    /SendGrokBotUserMessage refused: nope/,
  );
  assert.equal(urls.some((url) => url.endsWith("/api/sendPrompt")), false);
});

test("a backend 401 names the login error and does not fall back to the gateway", async () => {
  const urls: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    urls.push(requestUrl(input));
    return new Response(
      JSON.stringify({
        code: "unauthenticated",
        message: "Error",
        details: [{ debug: { error: "ERROR_NOT_LOGGED_IN" } }],
      }),
      { status: 401, headers: { "content-type": "application/json" } },
    );
  };
  const client = new HttpHostClient({
    gatewayUrl: GATEWAY,
    token: BOX_TOKEN,
    source: "gateway",
    fetch: fetchImpl,
    cursorAccount: async () => ({ token: CURSOR_TOKEN }),
  });
  await assert.rejects(
    () => client.sendPrompt({ agentId: "ada", prompt: "hi", wait: false }),
    /SendGrokBotUserMessage failed: 401 ERROR_NOT_LOGGED_IN/,
  );
  assert.equal(urls.some((url) => url.endsWith("/api/sendPrompt")), false);
});
