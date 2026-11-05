import assert from "node:assert/strict";
import test from "node:test";
import { encodeSendRequest, refusalFromResponse, sendViaBackend } from "../src/client/backendSend.js";

test("encodes the send request fields", () => {
  const body = Buffer.from(
    encodeSendRequest({ agentId: "a1", prompt: "hi", clientNonce: "n1", machineId: "m1", sentAtMs: 5 }),
  );
  assert.deepEqual([...body.subarray(0, 4)], [0x0a, 2, 0x61, 0x31]);
  assert.ok(body.includes(Buffer.from("hi")));
  assert.ok(body.includes(Buffer.from([0x68, 1]))); // field 13 = 1
});

test("refusal is read from the response", () => {
  assert.equal(refusalFromResponse(Uint8Array.from([0x08, 1, 0x20, 2])), null);
  assert.equal(refusalFromResponse(Uint8Array.from([0x20, 4])), "refused");
});

test("sendViaBackend posts proto with the account token", async () => {
  let seen: { url: string; headers: Record<string, string> } | undefined;
  const fakeFetch = (async (url: string, init: RequestInit) => {
    seen = { url, headers: init.headers as Record<string, string> };
    return new Response(Uint8Array.from([0x08, 1, 0x20, 2]), { status: 200 });
  }) as unknown as typeof fetch;
  const result = await sendViaBackend({
    agentId: "a",
    prompt: "p",
    clientNonce: "n",
    machineId: "m",
    account: { token: "tok", teamId: "7" },
    fetch: fakeFetch,
  });
  assert.equal(result.clientNonce, "n");
  assert.match(seen?.url ?? "", /SendGrokBotUserMessage$/);
  assert.equal(seen?.headers.authorization, "Bearer tok");
  assert.equal(seen?.headers["x-cursor-team-id"], "7");
});
