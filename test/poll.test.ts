import assert from "node:assert/strict";
import { test } from "node:test";
import {
  imageNeedsHydrate,
  mergeImagePathsFrom,
  mergePolledTranscript,
  parsePollMs,
  shouldPollTranscript,
  transcriptChanged,
  transcriptNeedsImageHydrate,
} from "../src/tui/poll.ts";
import type { ChatImage, ChatTurn } from "../src/client/types.js";

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

test("mergePolledTranscript keeps hydrated image paths across poll ticks", () => {
  const hydrated: ChatTurn = {
    id: "1",
    role: "assistant",
    speaker: "Ada",
    text: "photo",
    images: [{ alt: "pic.png", path: "/tmp/grok-tui-images/abc.png", file_path: "/home/box/x" }],
  };
  const polled: ChatTurn = {
    id: "1",
    role: "assistant",
    speaker: "Ada",
    text: "photo",
    images: [{ alt: "pic.png", file_path: "/home/box/x" }],
  };
  assert.deepEqual(mergePolledTranscript([hydrated], [polled]), [hydrated]);
});

test("mergePolledTranscript keeps a longer loaded prefix when poll returns a shorter tail", () => {
  const prefix = Array.from({ length: 400 }, (_, i) => ({
    id: `old-${i}`,
    role: "assistant" as const,
    speaker: "Ada",
    text: `msg ${i}`,
  }));
  const sharedTail: ChatTurn[] = Array.from({ length: 100 }, (_, i) => ({
    id: `tail-${i}`,
    role: "assistant" as const,
    speaker: "Ada",
    text: `tail ${i}`,
  }));
  const loaded = [...prefix, ...sharedTail];
  const polled = sharedTail.map((turn) => ({ ...turn, text: `${turn.text}!` }));
  const merged = mergePolledTranscript(loaded, polled);
  assert.equal(merged.length, 500);
  assert.equal(merged[0]?.text, "msg 0");
  assert.equal(merged[399]?.text, "msg 399");
  assert.equal(merged[400]?.text, "tail 0!");
});

test("mergeImagePathsFrom does not copy paths when turn ids differ", () => {
  const from: ChatTurn[] = [
    {
      id: "a",
      role: "assistant",
      speaker: "Ada",
      text: "old",
      images: [{ alt: "x", path: "/tmp/wrong.png" }],
    },
  ];
  const onto: ChatTurn[] = [
    {
      id: "b",
      role: "assistant",
      speaker: "Ada",
      text: "new",
      images: [{ alt: "x" }],
    },
  ];
  assert.deepEqual(mergeImagePathsFrom(from, onto), onto);
});

test("imageNeedsHydrate treats host attachmentPaths stored in path as pending", () => {
  const hostPath: ChatImage = {
    alt: "pic",
    path: "/home/box/sand-data/missing.png",
  };
  assert.equal(imageNeedsHydrate(hostPath), true);
  assert.equal(transcriptNeedsImageHydrate([{ id: "1", role: "assistant", speaker: "Ada", text: "", images: [hostPath] }]), true);
});

test("parsePollMs defaults to 1500 and rejects tiny intervals", () => {
  assert.equal(parsePollMs(undefined), 1500);
  assert.equal(parsePollMs(""), 1500);
  assert.equal(parsePollMs("2000"), 2000);
  assert.equal(parsePollMs("100"), 1500);
  assert.equal(parsePollMs("nope"), 1500);
});
