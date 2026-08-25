import assert from "node:assert/strict";
import { test } from "node:test";
import type { ChatTurn } from "../src/client/types.js";
import {
  adjustScrollOffset,
  agentLabel,
  composeVisible,
  speakerLabel,
  takeLastRows,
  transcriptInnerHeight,
  turnsToRows,
  visibleTranscript,
  wrapLine,
  wrapText,
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
  const speakers = rows.filter((row) => row.kind === "speaker").map((row) => row.text.trim());
  assert.deepEqual(speakers, ["you", "Dev"]);
  const body = rows.filter((row) => row.kind === "body");
  assert.ok(body.length > 1, "long assistant text should wrap onto several lines");
  const clipped = takeLastRows(rows, 4);
  assert.equal(clipped.length, 4);
  assert.equal(clipped.some((row) => row.kind === "speaker" && row.text.trim() === "you"), false);
  assert.equal(clipped.at(-1)?.kind, "body");
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
});

test("assistant send-message turns are labeled with the agent name", () => {
  const turns: ChatTurn[] = [
    { id: "1", role: "assistant", speaker: "send-message", text: "hello from the bot" },
  ];
  const rows = turnsToRows(turns, 40, "Dev");
  const speakers = rows.filter((row) => row.kind === "speaker").map((row) => row.text);
  assert.deepEqual(speakers, ["Dev"]);
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
  assert.equal(bot.find((row) => row.kind === "speaker")?.text, "Dev");
  assert.equal(user.find((row) => row.kind === "speaker")?.text.trim(), "you");
  assert.ok((user.find((row) => row.kind === "speaker")?.text ?? "").startsWith(" "));
});

test("short user lines hug the right edge via padStart", () => {
  const turns: ChatTurn[] = [
    { id: "1", role: "user", speaker: "you", text: "hi" },
    { id: "2", role: "assistant", speaker: "send-message", text: "hello" },
  ];
  const rows = turnsToRows(turns, 40, "Dev");
  const you = rows.find((row) => row.kind === "speaker" && row.align === "end");
  const hi = rows.find((row) => row.kind === "body" && row.align === "end");
  const dev = rows.find((row) => row.kind === "speaker" && row.align === "start");
  assert.ok(you && hi && dev);
  assert.equal(you.text.length, 40);
  assert.ok(you.text.startsWith(" "));
  assert.ok(you.text.endsWith("you"));
  assert.equal(hi.text.length, 40);
  assert.ok(hi.text.startsWith(" "));
  assert.ok(hi.text.endsWith("hi"));
  assert.equal(dev.text, "Dev");
  assert.equal(dev.text.startsWith(" "), false);
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

test("user text that fits the pane is a single right-padded line", () => {
  const rows = turnsToRows([{ id: "1", role: "user", speaker: "you", text: "hello there" }], 40, "Dev");
  const bodies = rows.filter((row) => row.kind === "body");
  assert.equal(bodies.length, 1);
  assert.equal(bodies[0]?.text.length, 40);
  assert.ok(bodies[0]?.text.endsWith("hello there"));
  assert.ok(bodies[0]?.text.startsWith(" "));
});

test("only user strings longer than the inner width wrap", () => {
  const fits = turnsToRows([{ id: "1", role: "user", speaker: "you", text: "x".repeat(40) }], 40, "Dev");
  assert.equal(fits.filter((row) => row.kind === "body").length, 1);
  const wraps = turnsToRows([{ id: "1", role: "user", speaker: "you", text: "x".repeat(41) }], 40, "Dev");
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
