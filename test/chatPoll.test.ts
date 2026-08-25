import assert from "node:assert/strict";
import { test } from "node:test";
import type { Agent, ChatTurn, HostClient } from "../src/client/types.js";
import { pollChatSnapshot } from "../src/tui/chatPoll.js";

const ROOM_ID = "55555555-5555-4555-8555-555555555555";

function fakeClient(options: {
  transcript: ChatTurn[] | (() => ChatTurn[]);
  roster?: Agent[];
}): HostClient {
  const roster = options.roster ?? [{ id: ROOM_ID, name: "project X", isGroup: true }];
  return {
    source: "mock",
    async listAgents() {
      return roster;
    },
    async getTranscript() {
      return typeof options.transcript === "function" ? options.transcript() : options.transcript;
    },
    async sendPrompt() {
      return { accepted: true, status: "idle", elapsedMs: 0 };
    },
    async interrupt() {
      return { hadActiveRun: false };
    },
  };
}

test("pollChatSnapshot keeps room optimistic turns when host tail is stale", async () => {
  const beforeSend: ChatTurn[] = [{ id: "1", role: "assistant", speaker: "Dev", text: "earlier" }];
  const optimistic: ChatTurn = { id: "local-42", role: "user", speaker: "you", text: "@Dev go" };
  const client = fakeClient({ transcript: beforeSend });
  const snapshot = await pollChatSnapshot({
    client,
    agentId: ROOM_ID,
    turns: [...beforeSend, optimistic],
    statusKind: "idle",
  });
  assert.ok(snapshot.turns.some((turn) => turn.text === "@Dev go"));
  assert.equal(snapshot.turns.length, 2);
});

test("pollChatSnapshot skips transcript fetch while sending", async () => {
  let transcriptCalls = 0;
  const beforeSend: ChatTurn[] = [{ id: "1", role: "assistant", speaker: "Dev", text: "earlier" }];
  const optimistic: ChatTurn = { id: "local-1", role: "user", speaker: "you", text: "wait" };
  const client = fakeClient({
    transcript: () => {
      transcriptCalls += 1;
      return beforeSend;
    },
  });
  const snapshot = await pollChatSnapshot({
    client,
    agentId: ROOM_ID,
    turns: [...beforeSend, optimistic],
    statusKind: "sending",
  });
  assert.equal(transcriptCalls, 0);
  assert.deepEqual(snapshot.turns, [...beforeSend, optimistic]);
});

test("pollChatSnapshot returns roster for App onRoster handoff", async () => {
  const roster: Agent[] = [
    { id: "11111111-1111-4111-8111-111111111111", name: "Ada", isGroup: false },
    { id: ROOM_ID, name: "project X", isGroup: true, memberIds: ["11111111-1111-4111-8111-111111111111"] },
  ];
  const client = fakeClient({ transcript: [], roster });
  const seen: Agent[][] = [];
  const snapshot = await pollChatSnapshot({
    client,
    agentId: ROOM_ID,
    turns: [],
    statusKind: "idle",
  });
  seen.push(snapshot.roster);
  assert.equal(seen.length, 1);
  assert.deepEqual(
    seen[0]?.map((agent) => agent.name),
    ["Ada", "project X"],
  );
});
