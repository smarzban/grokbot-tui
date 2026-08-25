import assert from "node:assert/strict";
import { test } from "node:test";
import type { ChatTurn } from "../src/client/types.js";
import {
  mergePolledTranscript,
  parsePollMs,
  shouldPollTranscript,
  transcriptChanged,
} from "../src/tui/poll.ts";

const you: ChatTurn = { id: "1", role: "user", speaker: "you", text: "hi" };
const bot: ChatTurn = { id: "2", role: "assistant", speaker: "send-message", text: "hello" };

test("transcriptChanged is false for the same last id/count/text", () => {
  assert.equal(transcriptChanged([you, bot], [you, bot]), false);
  assert.equal(transcriptChanged([], []), false);
});

test("transcriptChanged is true when count, last id, or last text differs", () => {
  assert.equal(transcriptChanged([], [you]), true);
  assert.equal(transcriptChanged([you], [you, bot]), true);
  assert.equal(
    transcriptChanged([bot], [{ ...bot, id: "other" }]),
    true,
  );
  assert.equal(
    transcriptChanged([bot], [{ ...bot, text: "hello there" }]),
    true,
  );
});

test("shouldPollTranscript skips sending and initial loading", () => {
  assert.equal(shouldPollTranscript("idle"), true);
  assert.equal(shouldPollTranscript("error"), true);
  assert.equal(shouldPollTranscript("sending"), false);
  assert.equal(shouldPollTranscript("loading"), false);
});

test("transcriptChanged notices earlier-turn edits when length is unchanged", () => {
  const earlier = { ...you, text: "hi there" };
  assert.equal(transcriptChanged([you, bot], [earlier, bot]), true);
});

test("mergePolledTranscript keeps uncommitted local user turns", () => {
  const local: ChatTurn = { id: "local-1", role: "user", speaker: "you", text: "@Dev ship it" };
  const host: ChatTurn[] = [{ id: "1", role: "assistant", speaker: "Ada", text: "old reply" }];
  assert.deepEqual(mergePolledTranscript([...host, local], host), [...host, local]);
});

test("mergePolledTranscript survives an immediate stale poll after a room send", () => {
  const beforeSend: ChatTurn[] = [{ id: "1", role: "assistant", speaker: "Dev", text: "earlier" }];
  const optimistic: ChatTurn = { id: "local-42", role: "user", speaker: "you", text: "@Dev go" };
  const staleTail = beforeSend;
  assert.deepEqual(mergePolledTranscript([...beforeSend, optimistic], staleTail), [
    ...beforeSend,
    optimistic,
  ]);
});

test("mergePolledTranscript drops local turns once the host commits them", () => {
  const local: ChatTurn = { id: "local-1", role: "user", speaker: "you", text: "hi" };
  const host: ChatTurn[] = [
    { id: "1", role: "user", speaker: "you", text: "hi" },
    { id: "2", role: "assistant", speaker: "Ada", text: "hello" },
  ];
  assert.deepEqual(mergePolledTranscript([local], host), host);
});

test("parsePollMs defaults to 1500 and rejects tiny intervals", () => {
  assert.equal(parsePollMs(undefined), 1500);
  assert.equal(parsePollMs(""), 1500);
  assert.equal(parsePollMs("2000"), 2000);
  assert.equal(parsePollMs("100"), 1500);
  assert.equal(parsePollMs("nope"), 1500);
});
