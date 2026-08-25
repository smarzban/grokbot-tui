import { setTimeout as delay } from "node:timers/promises";
import assert from "node:assert/strict";
import { test } from "node:test";
import { HttpHostClient } from "../src/client/host.js";
import { CHIEF_ID, DEV_ID, MockHostClient, PROJECT_X_ID, mockPhotoPath } from "../src/client/mock.js";
import { openHostClient } from "../src/client/factory.js";
import { HostClientError } from "../src/client/types.js";
import { asAgentRow, enrichRoster, turnsFromHostTranscript } from "../src/client/transcript.js";
import { answeringIndicator, busyMemberNames } from "../src/tui/roster.js";
import { transcriptChanged } from "../src/tui/poll.js";
import { readConfig } from "../src/config.js";
import { redact } from "../src/redact.js";
import { ADA_ID, ADA_NAME, createScriptedFetch, createScriptedHost } from "./scripted-host.ts";

const GATEWAY = "http://127.0.0.1:1340";

function clientFor(host: ReturnType<typeof createScriptedHost>, token = host.token) {
  return new HttpHostClient({
    gatewayUrl: GATEWAY,
    token,
    source: "gateway",
    fetch: createScriptedFetch(host),
  });
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

test("mock Ada transcript includes a real photo path and a name-only placeholder", async () => {
  const mock = new MockHostClient();
  const ada = (await mock.listAgents())[0];
  assert.ok(ada);
  const history = await mock.getTranscript(ada.id);
  const photo = mockPhotoPath();
  assert.ok(history.some((turn) => turn.images?.some((image) => image.path === photo)));
  assert.ok(history.some((turn) => turn.text === photo && (turn.images?.length ?? 0) === 0));
  assert.ok(history.some((turn) => turn.images?.some((image) => image.alt === "name-only.png" && !image.path)));
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

test("mock room with a running member produces answering indicator text", async () => {
  const mock = new MockHostClient();
  mock.setRunning(DEV_ID, true);
  const roster = await mock.listAgents();
  const room = roster.find((agent) => agent.isGroup);
  const dev = roster.find((agent) => agent.id === DEV_ID);
  assert.ok(room && dev);
  assert.equal(dev.isRunning, true);
  assert.equal(answeringIndicator(busyMemberNames(dev, roster)), "Dev is answering…");
  assert.equal(answeringIndicator(busyMemberNames(room, roster)), "Dev is answering…");
  mock.setRunning(DEV_ID, false);
  mock.setRunning(CHIEF_ID, true);
  const later = await mock.listAgents();
  const laterRoom = later.find((agent) => agent.isGroup);
  assert.ok(laterRoom);
  assert.equal(answeringIndicator(busyMemberNames(laterRoom, later)), "Chief of Staff is answering…");
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
  assert.ok(history.some((turn) => turn.role === "user" && turn.text === "status only"));
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
    isRunning: false,
    isComposingMessage: false,
  });
  assert.ok(row);
  assert.equal(row.isGroup, true);
  assert.equal(row.isRunning, false);
  assert.equal(row.isComposingMessage, false);
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
  await assert.rejects(() => down.listAgents(), (err: unknown) => {
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
  const agents = await client.listAgents();
  assert.equal(agents.length, 1);
  assert.equal(agents[0]?.name, ADA_NAME);
  assert.equal(agents[0]?.id, ADA_ID);
});

test("gateway client does not probe GET /health", async () => {
  const host = createScriptedHost();
  let gets = 0;
  const inner = createScriptedFetch(host);
  const fetchImpl: typeof fetch = async (input, init) => {
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "GET") gets += 1;
    return inner(input, init);
  };
  const client = new HttpHostClient({
    gatewayUrl: GATEWAY,
    token: host.token,
    source: "gateway",
    fetch: fetchImpl,
  });
  await client.listAgents();
  assert.equal(gets, 0);
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

test("gateway client abort during a hung sendPrompt POST interrupts once", async () => {
  const host = createScriptedHost();
  let interruptCalls = 0;
  const inner = createScriptedFetch(host);
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const marker = "/api/";
    const idx = url.lastIndexOf(marker);
    const command = idx >= 0 ? url.slice(idx + marker.length) : "";
    if (command === "sendPrompt") {
      await delay(60_000, undefined, { signal: init?.signal ?? undefined });
    }
    if (command === "interruptAgentRun") {
      interruptCalls += 1;
    }
    return inner(input, init);
  };
  const client = new HttpHostClient({
    gatewayUrl: GATEWAY,
    token: host.token,
    source: "gateway",
    fetch: fetchImpl,
  });
  const controller = new AbortController();
  const pending = client.sendPrompt({
    agentId: ADA_ID,
    prompt: "slow",
    wait: true,
    signal: controller.signal,
  });
  await delay(20);
  controller.abort();
  const result = await pending;
  assert.equal(result.status, "cancelled");
  assert.equal(interruptCalls, 1);
});

test("gateway client maps a down host", async () => {
  const host = createScriptedHost({ down: true });
  const client = clientFor(host);
  await assert.rejects(() => client.listAgents(), (err: unknown) => {
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

test("openHostClient uses env URL+token through the owned POST helper", async () => {
  const host = createScriptedHost();
  const client = await openHostClient({
    config: { gatewayUrl: GATEWAY, mock: false },
    token: host.token,
    env: {},
    fetch: createScriptedFetch(host),
    loadDesktop: async () => {
      throw new Error("desktop session must not load when env token is set");
    },
  });
  assert.equal(client.source, "gateway");
  const agents = await client.listAgents();
  assert.equal(agents[0]?.name, ADA_NAME);
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
        config: { mock: false },
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

test("transcript parser keeps snake_case user-attachment file_name and file_path", () => {
  const turns = turnsFromHostTranscript({
    entries: [
      {
        kind: "user-attachment",
        id: "t32ua0",
        file_path: "/home/box/sand-data/Screenshot 2026-08-25 at 11.22.58 AM.png",
        file_name: "Screenshot 2026-08-25 at 11.22.58 AM.png",
        width: 1200,
        height: 800,
        byteSize: 4096,
        batchId: "b1",
        clientNonce: "n1",
        timestampMs: 1,
      },
    ],
  });
  const image = turns[0]?.images?.[0];
  assert.equal(turns[0]?.role, "user");
  assert.equal(image?.fileName, "Screenshot 2026-08-25 at 11.22.58 AM.png");
  assert.equal(image?.alt, "Screenshot 2026-08-25 at 11.22.58 AM.png");
  assert.equal(image?.file_path, "/home/box/sand-data/Screenshot 2026-08-25 at 11.22.58 AM.png");
  assert.equal(image?.path, undefined);
  assert.equal(image?.id, "t32ua0");
  assert.equal(image?.width, 1200);
  assert.equal(image?.height, 800);
  assert.equal(image?.url, undefined);
});

test("transcript parser keeps send-message message.images file:// url", () => {
  const turns = turnsFromHostTranscript({
    entries: [
      {
        kind: "send-message",
        id: "t33s1",
        message: {
          type: "text",
          content: "here's the cat",
          images: [
            {
              url: "file:///home/box/sand-data/cat.png",
              alt: "cat",
              width: 64,
              height: 64,
            },
          ],
        },
        timestampMs: 2,
      },
    ],
  });
  const turn = turns.find((row) => row.images?.some((image) => image.alt === "cat"));
  assert.ok(turn);
  assert.equal(turn.text, "here's the cat");
  const image = turn.images?.[0];
  assert.equal(image?.url, "file:///home/box/sand-data/cat.png");
  assert.equal(image?.alt, "cat");
  assert.equal(image?.width, 64);
  assert.equal(image?.height, 64);
  assert.equal(image?.path, undefined);
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

test("transcript parser keeps local attachmentPaths and does not treat http as a path", () => {
  const turns = turnsFromHostTranscript({
    entries: [
      {
        kind: "user-attachment",
        fileName: "disk.png",
        attachmentPaths: ["/tmp/disk.png"],
        timestampMs: 1,
      },
      {
        kind: "send-message",
        message: { type: "attachment", fileName: "remote.png", attachmentPaths: ["https://example.invalid/x"] },
        timestampMs: 2,
      },
    ],
  });
  const disk = turns.find((turn) => turn.images?.some((image) => image.alt === "disk.png"));
  const remote = turns.find((turn) => turn.images?.some((image) => image.alt === "remote.png"));
  assert.equal(disk?.images?.[0]?.path, "/tmp/disk.png");
  assert.equal(disk?.images?.[0]?.url, undefined);
  assert.equal(remote?.images?.[0]?.path, undefined);
  assert.equal(remote?.images?.[0]?.url, "https://example.invalid/x");
});

test("transcript parser keeps host id, entryId, mime, and attachment names", () => {
  const turns = turnsFromHostTranscript({
    entries: [
      {
        id: "entry-abc",
        kind: "user-attachment",
        fileName: "cat.png",
        mime: "image/png",
        attachmentNames: ["cat.png"],
        attachmentPaths: ["https://example.invalid/cat.png"],
        timestampMs: 1,
      },
      {
        id: "wrap-1",
        kind: "send-message",
        message: {
          type: "attachment",
          id: "att-9",
          fileName: "out.png",
          mime: "image/png",
        },
        timestampMs: 2,
      },
    ],
  });
  const cat = turns.find((turn) => turn.images?.some((image) => image.alt === "cat.png"))?.images?.[0];
  assert.equal(cat?.fileName, "cat.png");
  assert.equal(cat?.mime, "image/png");
  assert.equal(cat?.entryId, "entry-abc");
  assert.equal(cat?.url, "https://example.invalid/cat.png");
  assert.deepEqual(cat?.attachmentNames, ["cat.png"]);
  assert.deepEqual(cat?.attachmentPaths, ["https://example.invalid/cat.png"]);
  const out = turns.find((turn) => turn.images?.some((image) => image.alt === "out.png"))?.images?.[0];
  assert.equal(out?.fileName, "out.png");
  assert.equal(out?.id, "att-9");
  assert.equal(out?.entryId, "wrap-1");
  assert.equal(out?.mime, "image/png");
});

test("redact never leaves a token in output", () => {
  const secret = "super-secret-token-value";
  const out = redact(`Authorization: Bearer ${secret} SAND_GATEWAY_TOKEN=${secret}`, secret);
  assert.doesNotMatch(out, /super-secret/);
  assert.match(out, /\[redacted\]/);
});
