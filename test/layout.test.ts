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
  const rows = turnsToRows(turns, 12);
  const speakers = rows.filter((row) => row.kind === "speaker").map((row) => row.text);
  assert.deepEqual(speakers, ["you", "Dev"]);
  const body = rows.filter((row) => row.kind === "body");
  assert.ok(body.length > 1, "long assistant text should wrap onto several lines");
  const clipped = takeLastRows(rows, 4);
  assert.equal(clipped.length, 4);
  assert.equal(clipped.some((row) => row.kind === "speaker" && row.text === "you"), false);
  assert.equal(clipped.at(-1)?.kind, "body");
});

test("takeLastRows keeps the end of a single overflowing turn", () => {
  const turns: ChatTurn[] = [
    { id: "1", role: "assistant", speaker: "Dev", text: "alpha beta gamma delta epsilon" },
  ];
  const rows = turnsToRows(turns, 6);
  const clipped = takeLastRows(rows, 3);
  assert.equal(clipped.length, 3);
  assert.equal(clipped[0]?.kind === "speaker", false);
});

test("visibleTranscript reserves a line when clipping a long last reply", () => {
  const turns: ChatTurn[] = [
    { id: "1", role: "user", speaker: "you", text: "hi" },
    { id: "2", role: "assistant", speaker: "Dev", text: "one two three four five six seven eight nine ten" },
  ];
  const rows = turnsToRows(turns, 12);
  const view = visibleTranscript(rows, 4);
  assert.equal(view.clipped, true);
  assert.equal(view.rows.length, 3);
  assert.equal(
    view.rows.some((row) => row.kind === "speaker" && row.text === "you"),
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
