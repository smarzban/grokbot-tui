import assert from "node:assert/strict";
import { test } from "node:test";
import {
  clampCaret,
  composeInnerHeight,
  deleteBackward,
  deleteForward,
  insertAt,
  layoutCompose,
  moveCaret,
  splitLineAtCaret,
  visibleComposeWindow,
} from "../src/tui/compose.ts";

test("insertAt places text at the caret, not the end", () => {
  assert.deepEqual(insertAt("abc", 1, "X"), { text: "aXbc", caret: 2 });
  assert.deepEqual(insertAt("", 0, "hi"), { text: "hi", caret: 2 });
});

test("deleteBackward and deleteForward act at the caret", () => {
  assert.deepEqual(deleteBackward("hello", 3), { text: "helo", caret: 2 });
  assert.deepEqual(deleteBackward("hello", 0), { text: "hello", caret: 0 });
  assert.deepEqual(deleteForward("hello", 1), { text: "hllo", caret: 1 });
  assert.deepEqual(deleteForward("hello", 5), { text: "hello", caret: 5 });
});

test("moveCaret and clamp stay in range", () => {
  assert.equal(moveCaret(1, 3, -1), 0);
  assert.equal(moveCaret(0, 3, -1), 0);
  assert.equal(moveCaret(2, 3, 1), 3);
  assert.equal(clampCaret(99, 2), 2);
});

test("layoutCompose wraps a long draft to the compose width", () => {
  const text = "abcdefghijklmnopqrst";
  const laid = layoutCompose(text, 20, 8);
  assert.deepEqual(laid.lines, ["abcdefgh", "ijklmnop", "qrst"]);
  assert.equal(laid.line, 2);
  assert.equal(laid.col, 4);
});

test("caret at a wrap boundary sits on the next line", () => {
  const laid = layoutCompose("abcdefghij", 8, 8);
  assert.deepEqual(laid.lines, ["abcdefgh", "ij"]);
  assert.equal(laid.line, 1);
  assert.equal(laid.col, 0);
});

test("caret in the middle of a wrapped line maps to the right cell", () => {
  const laid = layoutCompose("abcdefghij", 10, 8);
  assert.equal(laid.line, 1);
  assert.equal(laid.col, 2);
  const cell = splitLineAtCaret(laid.lines[laid.line] ?? "", laid.col);
  assert.equal(cell.before, "ij");
  assert.equal(cell.cell, " ");
  assert.equal(cell.after, "");
});

test("insert then wrap keeps the caret on the typed character's cell", () => {
  const next = insertAt("abcdefgh", 3, "X");
  assert.deepEqual(next, { text: "abcXdefgh", caret: 4 });
  const laid = layoutCompose(next.text, next.caret, 8);
  assert.deepEqual(laid.lines, ["abcXdefg", "h"]);
  assert.equal(laid.line, 0);
  assert.equal(laid.col, 4);
  const cell = splitLineAtCaret(laid.lines[0] ?? "", laid.col);
  assert.equal(cell.before, "abcX");
  assert.equal(cell.cell, "d");
});

test("compose box grows then caps", () => {
  assert.equal(composeInnerHeight(1), 1);
  assert.equal(composeInnerHeight(3), 3);
  assert.equal(composeInnerHeight(7), 5);
});

test("visible window keeps the caret line in view", () => {
  const lines = ["a", "b", "c", "d", "e", "f", "g"];
  assert.deepEqual(visibleComposeWindow(lines, 6, 5), {
    lines: ["c", "d", "e", "f", "g"],
    line: 4,
  });
});
