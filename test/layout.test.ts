import assert from "node:assert/strict";
import { test } from "node:test";
import type { ChatTurn } from "../src/client/types.js";
import {
  adjustScrollOffset,
  agentLabel,
  alignBlockEnd,
  composeVisible,
  speakerLabel,
  takeLastRows,
  transcriptInnerHeight,
  turnsToRows,
  visibleTranscript,
  wrapLine,
  wrapText,
  wrapWidth,
} from "../src/tui/layout.ts";

test("wrapLine breaks on spaces and hard-wraps long tokens", () => {
  assert.deepEqual(wrapLine("hello world", 5), ["hello", "world"]);
  assert.deepEqual(wrapLine("abcdefghij", 4), ["abcd", "efgh", "ij"]);
  assert.deepEqual(wrapLine("", 8), [""]);
});

test("wrapText keeps explicit newlines", () => {
  assert.deepEqual(wrapText("a\nb\n\nc", 10), ["a", "b", "", "c"]);
});

test("turnsToRows budgets a long reply by wrapped lines, not turns", () => {
  const turns: ChatTurn[] = [
    { id: "1", role: "user", speaker: "you", text: "hi" },
    {
      id: "2",
      role: "assistant",
      speaker: "Dev",
      text: "one two three four five six seven eight nine ten",
    },
  ];
  const rows = turnsToRows(turns, 12, "Dev");
  const speakers = rows.filter((row) => row.kind === "speaker");
  assert.equal(speakers.length, 0, "1:1 chats hide you/bot speaker labels");
  const body = rows.filter((row) => row.kind === "body");
  assert.ok(body.length > 1, "long assistant text should wrap onto several lines");
  const clipped = takeLastRows(rows, 4);
  assert.equal(clipped.length, 4);
  assert.equal(clipped.some((row) => row.kind === "speaker" && row.text.trim() === "you"), false);
  const lastBody = [...clipped].reverse().find((row) => row.kind === "body");
  assert.ok(lastBody, "clipping a long reply should still keep its last wrapped lines");
});

test("takeLastRows keeps the end of a single overflowing turn", () => {
  const turns: ChatTurn[] = [
    { id: "1", role: "assistant", speaker: "Dev", text: "alpha beta gamma delta epsilon" },
  ];
  const rows = turnsToRows(turns, 6, "Dev");
  const clipped = takeLastRows(rows, 3);
  assert.equal(clipped.length, 3);
  assert.equal(clipped[0]?.kind === "speaker", false);
});

test("visibleTranscript reserves a line when clipping a long last reply", () => {
  const turns: ChatTurn[] = [
    { id: "1", role: "user", speaker: "you", text: "hi" },
    { id: "2", role: "assistant", speaker: "Dev", text: "one two three four five six seven eight nine ten" },
  ];
  const rows = turnsToRows(turns, 12, "Dev");
  const view = visibleTranscript(rows, 4);
  assert.equal(view.clipped, true);
  assert.equal(view.rows.length, 3);
  assert.equal(
    view.rows.some((row) => row.kind === "speaker" && row.text.trim() === "you"),
    false,
  );
});

test("agentLabel hides ids unless names collide", () => {
  const ada = { id: "11111111-1111-4111-8111-111111111111", name: "Ada" };
  const bea = { id: "22222222-2222-4222-8222-222222222222", name: "Bea" };
  const ada2 = { id: "33333333-3333-4333-8333-333333333333", name: "Ada" };
  assert.equal(agentLabel(ada, [ada, bea]), "Ada");
  assert.match(agentLabel(ada, [ada, ada2]), /^Ada · /);
  assert.doesNotMatch(agentLabel(ada, [ada, ada2]), /11111111-1111/);
});

test("composeVisible shows a tail when the draft is wider than the bar", () => {
  const shown = composeVisible("abcdefghijklmnopqrstuvwxyz", 8);
  assert.equal(shown.prefix.length, 7);
  assert.equal(shown.prefix.endsWith("z"), true);
  assert.equal(shown.caret, true);
});

test("transcript inner height leaves room for chrome", () => {
  assert.equal(transcriptInnerHeight(24) > 10, true);
  assert.ok(transcriptInnerHeight(24) < 24);
  assert.ok(transcriptInnerHeight(24, 5) < transcriptInnerHeight(24, 1));
});

test("assistant send-message turns keep the body without a 1:1 speaker label", () => {
  const turns: ChatTurn[] = [
    { id: "1", role: "assistant", speaker: "send-message", text: "hello from the bot" },
  ];
  const rows = turnsToRows(turns, 40, "Dev");
  const speakers = rows.filter((row) => row.kind === "speaker");
  assert.equal(speakers.length, 0);
  assert.equal(
    rows.some((row) => /send-message|SendMessage|thinking/i.test(row.text)),
    false,
  );
  assert.ok(rows.some((row) => row.kind === "body" && row.text.includes("hello from the bot")));
});

test("user rows align end and assistant rows align start", () => {
  const turns: ChatTurn[] = [
    { id: "1", role: "user", speaker: "you", text: "hi there" },
    { id: "2", role: "assistant", speaker: "send-message", text: "hello" },
  ];
  const rows = turnsToRows(turns, 20, "Dev");
  const user = rows.filter((row) => row.role === "user" && row.kind !== "empty");
  const bot = rows.filter((row) => row.role === "assistant" && row.kind !== "empty");
  assert.ok(user.length > 0 && user.every((row) => row.align === "end"));
  assert.ok(bot.length > 0 && bot.every((row) => row.align === "start"));
  assert.equal(
    rows.some((row) => row.kind === "speaker"),
    false,
  );
});

function firstContentCol(text: string): number {
  return text.search(/\S/);
}

test("short user line and wrapped user turn share one left column; assistant starts at 0", () => {
  const short = turnsToRows(
    [
      { id: "1", role: "user", speaker: "you", text: "hi" },
      { id: "2", role: "assistant", speaker: "Dev", text: "hello" },
    ],
    40,
    "Dev",
  );
  const hi = short.find((row) => row.kind === "body" && row.align === "end");
  const hello = short.find((row) => row.kind === "body" && row.align === "start");
  assert.ok(hi && hello);
  assert.equal(hi.text, "hi");
  assert.equal(firstContentCol(hi.text), 0);
  assert.equal(hello.text, "hello");
  assert.equal(firstContentCol(hello.text), 0);

  const wrapped = turnsToRows(
    [
      { id: "1", role: "user", speaker: "you", text: "hello this is a longer message of mine" },
      { id: "2", role: "assistant", speaker: "Dev", text: "ok" },
    ],
    20,
    "Dev",
  );
  const userBodies = wrapped.filter((row) => row.kind === "body" && row.align === "end");
  const bot = wrapped.find((row) => row.kind === "body" && row.align === "start");
  assert.ok(userBodies.length > 1, "user turn should wrap onto several lines");
  const starts = userBodies.map((row) => firstContentCol(row.text));
  assert.ok(starts.every((col) => col === starts[0]));
  assert.equal(starts[0], 0, "lines are left-aligned inside the chip; the chip hugs the right at render");
  const contents = userBodies.map((row) => row.text.trimStart());
  const longest = Math.max(...contents.map((line) => line.length));
  assert.ok(
    userBodies.some((row) => row.text.trimStart().length < longest),
    "shorter wrapped lines stay left-aligned in the block, not independently right-padded",
  );
  assert.equal(bot?.text, "ok");
  assert.equal(firstContentCol(bot?.text ?? ""), 0);
});

test("alignBlockEnd pads every line by the same amount", () => {
  assert.deepEqual(alignBlockEnd(["hi", "hello"], 8), ["   hi", "   hello"]);
  assert.deepEqual(alignBlockEnd(["abcdefgh"], 8), ["abcdefgh"]);
});

test("empty thinking turns are skipped but send-message bodies are kept", () => {
  const turns: ChatTurn[] = [
    { id: "1", role: "assistant", speaker: "thinking", text: "" },
    { id: "2", role: "assistant", speaker: "send-message", text: "visible reply" },
  ];
  const rows = turnsToRows(turns, 40, "Dev");
  assert.equal(
    rows.some((row) => row.kind === "speaker" && row.text === "thinking"),
    false,
  );
  assert.ok(rows.some((row) => row.kind === "body" && row.text === "visible reply"));
});

test("user text that fits the chip is a single left-aligned line", () => {
  const rows = turnsToRows([{ id: "1", role: "user", speaker: "you", text: "hello there" }], 40, "Dev");
  const bodies = rows.filter((row) => row.kind === "body");
  assert.equal(bodies.length, 1);
  assert.equal(bodies[0]?.text, "hello there");
  assert.equal(firstContentCol(bodies[0]?.text ?? ""), 0);
});

test("only user strings longer than the chip inner width wrap", () => {
  const inner = wrapWidth(40);
  const fits = turnsToRows([{ id: "1", role: "user", speaker: "you", text: "x".repeat(inner) }], 40, "Dev");
  assert.equal(fits.filter((row) => row.kind === "body").length, 1);
  const wraps = turnsToRows([{ id: "1", role: "user", speaker: "you", text: "x".repeat(inner + 1) }], 40, "Dev");
  assert.ok(wraps.filter((row) => row.kind === "body").length > 1);
});

test("visibleTranscript offset 0 sticks to the bottom", () => {
  const turns: ChatTurn[] = [];
  for (let i = 0; i < 12; i += 1) {
    turns.push({ id: String(i), role: "assistant", speaker: "Dev", text: `line-${i}` });
  }
  const rows = turnsToRows(turns, 40, "Dev");
  const bottom = visibleTranscript(rows, 6, 0);
  assert.equal(bottom.pinned, true);
  assert.equal(bottom.moreBelow, false);
  assert.ok(bottom.rows.some((row) => row.text.includes("line-11")));
  assert.equal(
    bottom.rows.some((row) => row.kind === "body" && row.text.includes("line-0")),
    false,
  );
});

test("scrolled-up offset hides the latest rows", () => {
  const turns: ChatTurn[] = [];
  for (let i = 0; i < 12; i += 1) {
    turns.push({ id: String(i), role: "assistant", speaker: "Dev", text: `line-${i}` });
  }
  const rows = turnsToRows(turns, 40, "Dev");
  const up = visibleTranscript(rows, 6, 8);
  assert.equal(up.pinned, false);
  assert.equal(up.moreBelow, true);
  assert.equal(
    up.rows.some((row) => row.kind === "body" && row.text.includes("line-11")),
    false,
  );
});

test("adjustScrollOffset stays pinned at 0 when new rows arrive", () => {
  assert.equal(
    adjustScrollOffset({ offset: 0, prevRowCount: 10, nextRowCount: 16, budget: 6 }),
    0,
  );
});

test("adjustScrollOffset grows with new rows so poll does not reset a scrolled view", () => {
  const next = adjustScrollOffset({ offset: 5, prevRowCount: 20, nextRowCount: 24, budget: 6 });
  assert.equal(next, 9);
  assert.notEqual(next, 0);
});

test("image turns render a placeholder; text-only turns do not", () => {
  const withImage = turnsToRows(
    [{ id: "1", role: "user", speaker: "you", text: "", images: [{ alt: "shot.png" }] }],
    40,
    "Dev",
  );
  const imageRow = withImage.find((row) => row.kind === "image");
  assert.ok(imageRow);
  assert.equal(imageRow.align, "end");
  assert.match(imageRow.text, /\[image\]/);
  assert.match(imageRow.text, /shot\.png/);
  const textOnly = turnsToRows([{ id: "1", role: "user", speaker: "you", text: "hi" }], 40, "Dev");
  assert.equal(
    textOnly.some((row) => row.kind === "image"),
    false,
  );
});

test("1:1 turns are separated by two empty rows; rooms by one; last empty is popped", () => {
  const oneToOne = turnsToRows(
    [
      { id: "1", role: "user", speaker: "you", text: "hi" },
      { id: "2", role: "assistant", speaker: "Dev", text: "hello" },
    ],
    40,
    "Dev",
  );
  assert.deepEqual(
    oneToOne.map((row) => row.kind),
    ["bubbleOpen", "body", "bubbleClose", "empty", "empty", "bubbleOpen", "body", "bubbleClose"],
  );

  const room = turnsToRows(
    [
      { id: "u", role: "user", speaker: "you", text: "hi" },
      { id: "d", role: "assistant", speaker: "send-message", speakerId: "dev-id", text: "on it" },
    ],
    40,
    {
      agentName: "project X",
      isGroup: true,
      members: [{ id: "dev-id", name: "Dev" }],
    },
  );
  assert.deepEqual(
    room.map((row) => row.kind),
    ["speaker", "bubbleOpen", "body", "bubbleClose", "empty", "speaker", "bubbleOpen", "body", "bubbleClose"],
  );
});

test("1:1 rows have no speaker labels; rooms still do", () => {
  const oneToOne = turnsToRows(
    [
      { id: "1", role: "user", speaker: "you", text: "hi" },
      { id: "2", role: "assistant", speaker: "Dev", text: "hello" },
    ],
    40,
    "Dev",
  );
  assert.equal(
    oneToOne.some((row) => row.kind === "speaker"),
    false,
  );
  assert.ok(oneToOne.some((row) => row.kind === "body" && row.align === "end"));
  assert.ok(oneToOne.some((row) => row.kind === "body" && row.align === "start"));

  const ctx = {
    agentName: "project X",
    isGroup: true,
    members: [
      { id: "dev-id", name: "Dev" },
      { id: "chief-id", name: "Chief of Staff" },
    ],
  };
  const room = turnsToRows(
    [
      { id: "u", role: "user", speaker: "you", text: "hi" },
      { id: "d", role: "assistant", speaker: "send-message", speakerId: "dev-id", text: "on it" },
    ],
    40,
    ctx,
  );
  assert.deepEqual(
    room.filter((row) => row.kind === "speaker").map((row) => row.text.trim()),
    ["you", "Dev"],
  );
});

test("room turns are labeled with member names, not the room title", () => {
  const ctx = {
    agentName: "project X",
    isGroup: true,
    members: [
      { id: "dev-id", name: "Dev" },
      { id: "chief-id", name: "Chief of Staff" },
    ],
  };
  const turns: ChatTurn[] = [
    { id: "u", role: "user", speaker: "you", text: "@Dev ship it" },
    { id: "d", role: "assistant", speaker: "send-message", speakerId: "dev-id", text: "on it" },
    { id: "c", role: "assistant", speaker: "Chief of Staff", speakerId: "chief-id", text: "tracking" },
  ];
  const rows = turnsToRows(turns, 40, ctx);
  const speakers = rows.filter((row) => row.kind === "speaker").map((row) => row.text.trim());
  assert.deepEqual(speakers, ["you", "Dev", "Chief of Staff"]);
  assert.equal(
    rows.some((row) => row.kind === "speaker" && row.text.includes("project X")),
    false,
  );
  assert.equal(speakerLabel(turns[1]!, ctx), "Dev");
  assert.equal(speakerLabel(turns[2]!, ctx), "Chief of Staff");
  assert.equal(speakerLabel(turns[0]!, ctx), "you");
});
