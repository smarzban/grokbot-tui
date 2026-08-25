import assert from "node:assert/strict";
import { test } from "node:test";
import type { ChatTurn } from "../src/client/types.js";
import {
  agentLabel,
  composeVisible,
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
