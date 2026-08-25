import assert from "node:assert/strict";
import { test } from "node:test";
import type { Agent, ChatTurn, HostClient } from "../src/client/types.js";
import { pollChatSnapshot } from "../src/tui/chatPoll.js";
import { mergePolledTranscript } from "../src/tui/poll.js";

const ROOM_ID = "55555555-5555-4555-8555-555555555555";
const ADA_ID = "11111111-1111-4111-8111-111111111111";

function fakeClient(options: {
  transcript?: ChatTurn[] | ((agentId: string) => ChatTurn[]);
  roster?: Agent[] | (() => Promise<Agent[]>);
  listAgents?: () => Promise<Agent[]>;
  getTranscript?: (agentId: string) => Promise<ChatTurn[]>;
}): HostClient {
  const roster =
    options.roster ??
    ([{ id: ROOM_ID, name: "project X", isGroup: true }] satisfies Agent[]);
  return {
    source: "mock",
    async listAgents() {
      if (options.listAgents) return options.listAgents();
      return typeof roster === "function" ? roster() : roster;
    },
    async getTranscript(agentId: string) {
      if (options.getTranscript) return options.getTranscript(agentId);
      const transcript = options.transcript ?? [];
      return typeof transcript === "function" ? transcript(agentId) : transcript;
    },
    async sendPrompt() {
      return { accepted: true, status: "idle", elapsedMs: 0 };
    },
    async interrupt() {
      return { hadActiveRun: false };
    },
  };
}

/** Mirror Chat.tick transcript apply: merge host tail against current UI state. */
function applyPollTurns(prev: ChatTurn[], snapshot: Awaited<ReturnType<typeof pollChatSnapshot>>): ChatTurn[] {
  if (!snapshot.transcriptFetched || !snapshot.history) return prev;
  return mergePolledTranscript(prev, snapshot.history);
}

test("pollChatSnapshot fetches transcript with the selected agent id", async () => {
  const seen: string[] = [];
  const client = fakeClient({
    getTranscript: async (agentId) => {
      seen.push(agentId);
      return agentId === ROOM_ID ? [{ id: "room", role: "assistant", speaker: "Dev", text: "room" }] : [];
    },
  });
  const snapshot = await pollChatSnapshot({ client, agentId: ROOM_ID, statusKind: "idle" });
  assert.deepEqual(seen, [ROOM_ID]);
  assert.equal(snapshot.transcriptFetched, true);
  assert.equal(snapshot.history?.[0]?.text, "room");
});

test("pollChatSnapshot skips transcript fetch while sending", async () => {
  let transcriptCalls = 0;
  const client = fakeClient({
    getTranscript: async () => {
      transcriptCalls += 1;
      return [];
    },
  });
  const snapshot = await pollChatSnapshot({ client, agentId: ROOM_ID, statusKind: "sending" });
  assert.equal(transcriptCalls, 0);
  assert.equal(snapshot.transcriptFetched, false);
});

test("Chat-style apply keeps room optimistic turns when host tail is stale", async () => {
  const beforeSend: ChatTurn[] = [{ id: "1", role: "assistant", speaker: "Dev", text: "earlier" }];
  const optimistic: ChatTurn = { id: "local-42", role: "user", speaker: "you", text: "@Dev go" };
  const client = fakeClient({ transcript: beforeSend });
  const snapshot = await pollChatSnapshot({ client, agentId: ROOM_ID, statusKind: "idle" });
  const next = applyPollTurns([...beforeSend, optimistic], snapshot);
  assert.ok(next.some((turn) => turn.text === "@Dev go"));
  assert.equal(next.length, 2);
});

test("Chat-style apply does not clobber a fresh 1:1 reply when the tick started while sending", async () => {
  const stale: ChatTurn[] = [
    { id: "local-1", role: "user", speaker: "you", text: "hi" },
  ];
  const fresh: ChatTurn[] = [
    { id: "1", role: "user", speaker: "you", text: "hi" },
    { id: "2", role: "assistant", speaker: "Ada", text: "hello" },
  ];
  const client = fakeClient({ transcript: stale });
  const snapshot = await pollChatSnapshot({ client, agentId: ADA_ID, statusKind: "sending" });
  assert.equal(snapshot.transcriptFetched, false);
  assert.deepEqual(applyPollTurns(fresh, snapshot), fresh);
});

test("pollChatSnapshot returns roster when listAgents succeeds", async () => {
  const roster: Agent[] = [
    { id: ADA_ID, name: "Ada", isGroup: false },
    { id: ROOM_ID, name: "project X", isGroup: true, memberIds: [ADA_ID] },
  ];
  const client = fakeClient({ transcript: [], roster });
  const snapshot = await pollChatSnapshot({ client, agentId: ROOM_ID, statusKind: "idle" });
  assert.equal(snapshot.rosterFetched, true);
  assert.deepEqual(
    snapshot.roster?.map((agent) => agent.name),
    ["Ada", "project X"],
  );
});

test("pollChatSnapshot signals roster failure instead of returning an empty list", async () => {
  const client = fakeClient({
    transcript: [],
    listAgents: async () => {
      throw new Error("host down");
    },
  });
  const snapshot = await pollChatSnapshot({ client, agentId: ROOM_ID, statusKind: "idle" });
  assert.equal(snapshot.rosterFetched, false);
  assert.equal(snapshot.roster, undefined);
});

test("pollChatSnapshot signals transcript failure instead of returning stale turns", async () => {
  const client = fakeClient({
    getTranscript: async () => {
      throw new Error("transcript down");
    },
  });
  const snapshot = await pollChatSnapshot({ client, agentId: ROOM_ID, statusKind: "idle" });
  assert.equal(snapshot.transcriptFetched, false);
  assert.equal(snapshot.history, undefined);
});
