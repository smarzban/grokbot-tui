import assert from "node:assert/strict";
import { test } from "node:test";
import type { ChatTurn } from "../src/client/types.js";
import {
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

test("parsePollMs defaults to 1500 and rejects tiny intervals", () => {
  assert.equal(parsePollMs(undefined), 1500);
  assert.equal(parsePollMs(""), 1500);
  assert.equal(parsePollMs("2000"), 2000);
  assert.equal(parsePollMs("100"), 1500);
  assert.equal(parsePollMs("nope"), 1500);
});
