import { setTimeout as delay } from "node:timers/promises";
import assert from "node:assert/strict";
import { test } from "node:test";
import { createSdkBot, GatewayHostClient } from "../src/client/host.js";
import { CHIEF_ID, DEV_ID, MockHostClient, PROJECT_X_ID } from "../src/client/mock.js";
import { openHostClient } from "../src/client/factory.js";
import { HostClientError } from "../src/client/types.js";
import { asAgentRow, enrichRoster, turnsFromHostTranscript } from "../src/client/transcript.js";
import { transcriptChanged } from "../src/tui/poll.js";
import { readConfig } from "../src/config.js";
import { redact } from "../src/redact.js";
import { ADA_ID, ADA_NAME, createScriptedFetch, createScriptedHost } from "./scripted-host.ts";

const GATEWAY = "http://127.0.0.1:1340";

function clientFor(host: ReturnType<typeof createScriptedHost>, token = host.token) {
  const bot = createSdkBot({
    gatewayUrl: GATEWAY,
    token,
    env: {
      GROKBOT_GATEWAY_URL: GATEWAY,
      SAND_GATEWAY_TOKEN: token ?? "",
    },
    fetch: createScriptedFetch(host),
  });
  return new GatewayHostClient(bot, "gateway", token);
}

test("mock host getTranscript picks up an appended app-side turn", async () => {
  const mock = new MockHostClient();
  const ada = (await mock.listAgents())[0];
  assert.ok(ada);
  const before = await mock.getTranscript(ada.id);
  mock.appendTurn(ada.id, {
    id: "app-1",
    role: "assistant",
    speaker: "send-message",
    text: "from the Grok Bot app",
  });
  const after = await mock.getTranscript(ada.id);
  assert.equal(transcriptChanged(before, after), true);
  assert.equal(after.at(-1)?.text, "from the Grok Bot app");
});

test("mock host lists agents by name and id", async () => {
  const mock = new MockHostClient();
  const agents = await mock.listAgents();
  const bots = agents.filter((agent) => !agent.isGroup);
  const rooms = agents.filter((agent) => agent.isGroup);
  assert.ok(bots.length >= 2);
  assert.equal(bots[0]?.name, "Ada");
  assert.ok(bots[0]?.id);
  assert.equal(rooms.length, 1);
  assert.equal(rooms[0]?.name, "project X");
  assert.equal(rooms[0]?.id, PROJECT_X_ID);
  assert.deepEqual(rooms[0]?.memberIds, [DEV_ID, CHIEF_ID]);
  assert.deepEqual(
    rooms[0]?.members?.map((member) => member.name),
    ["Dev", "Chief of Staff"],
  );
});

test("mock host sendPrompt waits until a reply", async () => {
  const mock = new MockHostClient({ replyDelayMs: 5 });
  const ada = (await mock.listAgents())[0];
  assert.ok(ada);
  const result = await mock.sendPrompt({ agentId: ada.id, prompt: "status only", wait: true });
  assert.equal(result.accepted, true);
  assert.equal(result.status, "idle");
  assert.match(result.reply ?? "", /Ada here/);
  const history = await mock.getTranscript(ada.id);
  assert.equal(history.at(-1)?.role, "assistant");
  assert.equal(history.at(0)?.role, "user");
});

test("mock host cancels an in-flight wait", async () => {
  const mock = new MockHostClient({ replyDelayMs: 5_000 });
  const ada = (await mock.listAgents())[0];
  assert.ok(ada);
  const controller = new AbortController();
  const pending = mock.sendPrompt({
    agentId: ada.id,
    prompt: "long job",
    wait: true,
    signal: controller.signal,
  });
  controller.abort();
  const result = await pending;
  assert.equal(result.status, "cancelled");
});

test("mock room send does not wait; poll sees member speaker names", async () => {
  const mock = new MockHostClient({ replyDelayMs: 15 });
  const room = (await mock.listAgents()).find((agent) => agent.isGroup);
  assert.ok(room);
  const result = await mock.sendPrompt({
    agentId: room.id,
    prompt: "@Dev ship it",
    wait: false,
  });
  assert.equal(result.accepted, true);
  assert.equal(result.status, "idle");
  const immediately = await mock.getTranscript(room.id);
  assert.equal(immediately.at(0)?.role, "user");
  assert.equal(immediately.at(0)?.text, "@Dev ship it");
  assert.equal(
    immediately.some((turn) => turn.role === "assistant"),
    false,
  );
  await delay(40);
  const later = await mock.getTranscript(room.id);
  const members = later.filter((turn) => turn.role === "assistant");
  assert.equal(members.length, 2);
  assert.deepEqual(
    members.map((turn) => turn.speaker).sort(),
    ["Chief of Staff", "Dev"],
  );
  assert.ok(members.every((turn) => turn.speaker !== "project X"));
});

test("asAgentRow keeps group memberIds and enrichRoster fills names from the bot roster", () => {
  const row = asAgentRow({
    id: PROJECT_X_ID,
    name: "project X",
    isGroup: true,
    memberIds: [DEV_ID, CHIEF_ID],
  });
  assert.ok(row);
  assert.equal(row.isGroup, true);
  assert.deepEqual(row.memberIds, [DEV_ID, CHIEF_ID]);
  const roster = enrichRoster([
    { id: DEV_ID, name: "Dev", isGroup: false },
    { id: CHIEF_ID, name: "Chief of Staff", isGroup: false },
    row,
  ]);
  const room = roster.find((agent) => agent.isGroup);
  assert.deepEqual(
    room?.members?.map((member) => member.name),
    ["Dev", "Chief of Staff"],
  );
});

test("mock host-down and missing-auth", async () => {
  const down = new MockHostClient({ hostDown: true });
  await assert.rejects(() => down.health(), (err: unknown) => {
    assert.ok(err instanceof HostClientError);
    assert.equal(err.kind, "host-down");
    return true;
  });

  const auth = new MockHostClient({ missingAuth: true });
  await assert.rejects(() => auth.listAgents(), (err: unknown) => {
    assert.ok(err instanceof HostClientError);
    assert.equal(err.kind, "missing-auth");
    assert.doesNotMatch(err.message, /Bearer\s+[A-Za-z0-9]/);
    return true;
  });
});

test("gateway client lists agents through a mock host", async () => {
  const host = createScriptedHost();
  const client = clientFor(host);
  const health = await client.health();
  assert.equal(health.ok, true);
  const agents = await client.listAgents();
  assert.equal(agents.length, 1);
  assert.equal(agents[0]?.name, ADA_NAME);
  assert.equal(agents[0]?.id, ADA_ID);
});

test("gateway client includes groups and resolves member names from the bot roster", async () => {
  const host = createScriptedHost({
    agents: [
      { id: ADA_ID, name: ADA_NAME, isGroup: false },
      { id: DEV_ID, name: "Dev", isGroup: false },
      { id: CHIEF_ID, name: "Chief of Staff", isGroup: false },
      { id: PROJECT_X_ID, name: "project X", isGroup: true, memberIds: [DEV_ID, CHIEF_ID] },
    ],
    transcripts: new Map([
      [ADA_ID, []],
      [DEV_ID, []],
      [CHIEF_ID, []],
      [PROJECT_X_ID, []],
    ]),
  });
  const client = clientFor(host);
  const agents = await client.listAgents();
  const room = agents.find((agent) => agent.isGroup);
  assert.ok(room);
  assert.equal(room.name, "project X");
  assert.deepEqual(room.memberIds, [DEV_ID, CHIEF_ID]);
  assert.deepEqual(
    room.members?.map((member) => member.name),
    ["Dev", "Chief of Staff"],
  );
});

test("gateway client sendPrompt polls until idle and returns the last reply", async () => {
  const host = createScriptedHost();
  const client = clientFor(host);
  const result = await client.sendPrompt({
    agentId: ADA_ID,
    prompt: "status only",
    wait: true,
    timeoutMs: 5_000,
  });
  assert.equal(result.accepted, true);
  assert.equal(result.status, "idle");
  assert.equal(result.reply, "Ada reply: status only");
  const history = await client.getTranscript(ADA_ID);
  assert.equal(history.length, 2);
  assert.equal(history[0]?.role, "user");
  assert.equal(history[1]?.role, "assistant");
});

test("gateway client maps a down host", async () => {
  const host = createScriptedHost({ down: true });
  const client = clientFor(host);
  await assert.rejects(() => client.health(), (err: unknown) => {
    assert.ok(err instanceof HostClientError);
    assert.equal(err.kind, "host-down");
    assert.doesNotMatch(err.message, /test-gateway-token/);
    return true;
  });
});

test("gateway client maps missing/wrong auth", async () => {
  const host = createScriptedHost();
  const client = clientFor(host, "wrong-token");
  await assert.rejects(() => client.listAgents(), (err: unknown) => {
    assert.ok(err instanceof HostClientError);
    assert.equal(err.kind, "unauthorized");
    assert.doesNotMatch(err.message, /wrong-token/);
    assert.doesNotMatch(err.message, /test-gateway-token/);
    return true;
  });
});

test("openHostClient uses mock when asked", async () => {
  const client = await openHostClient({
    config: readConfig({}),
    mock: true,
  });
  assert.equal(client.source, "mock");
  const agents = await client.listAgents();
  assert.ok(agents.length >= 1);
});

test("openHostClient reports missing-auth without a gateway", async () => {
  await assert.rejects(
    () =>
      openHostClient({
        config: { hasToken: false, mock: false },
        env: {},
        loadDesktop: async () => null,
      }),
    (err: unknown) => {
      assert.ok(err instanceof HostClientError);
      assert.equal(err.kind, "missing-auth");
      assert.doesNotMatch(err.message, /Bearer /);
      return true;
    },
  );
});

test("transcript parser reads host message and send-message rows", () => {
  const turns = turnsFromHostTranscript({
    entries: [
      { kind: "message", role: "user", content: "hi", timestampMs: 1 },
      { kind: "send-message", message: { type: "text", content: "hello from Ada" }, timestampMs: 2 },
      { kind: "tool-call", name: "ignored" },
    ],
  });
  assert.equal(turns.length, 2);
  assert.equal(turns[0]?.role, "user");
  assert.equal(turns[1]?.text, "hello from Ada");
});

test("transcript parser keeps group send-message author id and name", () => {
  const turns = turnsFromHostTranscript({
    entries: [
      {
        kind: "send-message",
        author: { id: DEV_ID, name: "Dev" },
        message: { type: "text", content: "from the room" },
        timestampMs: 2,
      },
    ],
  });
  assert.equal(turns.length, 1);
  assert.equal(turns[0]?.speaker, "Dev");
  assert.equal(turns[0]?.speakerId, DEV_ID);
  assert.equal(turns[0]?.text, "from the room");
});

test("transcript parser keeps user-attachment and send-message attachment", () => {
  const turns = turnsFromHostTranscript({
    entries: [
      { kind: "user-attachment", fileName: "cat.png", mime: "image/png", timestampMs: 1 },
      {
        kind: "send-message",
        message: { type: "attachment", fileName: "out.png" },
        timestampMs: 2,
      },
      { kind: "send-message", message: { type: "text", content: "hello from Ada" }, timestampMs: 3 },
    ],
  });
  const cats = turns.filter((turn) => turn.images?.some((image) => image.alt === "cat.png"));
  const outs = turns.filter((turn) => turn.images?.some((image) => image.alt === "out.png"));
  assert.equal(cats.length, 1);
  assert.equal(cats[0]?.role, "user");
  assert.equal(outs.length, 1);
  assert.ok(turns.some((turn) => turn.text === "hello from Ada" && (turn.images?.length ?? 0) === 0));
});

test("redact never leaves a token in output", () => {
  const secret = "super-secret-token-value";
  const out = redact(`Authorization: Bearer ${secret} SAND_GATEWAY_TOKEN=${secret}`, secret);
  assert.doesNotMatch(out, /super-secret/);
  assert.match(out, /\[redacted\]/);
});
