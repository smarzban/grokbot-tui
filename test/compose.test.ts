import assert from "node:assert/strict";
import { test } from "node:test";
import {
  clampCaret,
  composeInnerHeight,
  deleteBackward,
  deleteForward,
  handleComposeKey,
  insertAt,
  layoutCompose,
  lineEndCaret,
  lineStartCaret,
  moveCaret,
  moveCaretVertical,
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

test("layoutCompose wraps at word boundaries, not mid-word", () => {
  const laid = layoutCompose("hello world", 11, 8);
  assert.deepEqual(laid.lines, ["hello", "world"]);
  assert.equal(laid.line, 1);
  assert.equal(laid.col, 5);
  const w = layoutCompose("hello world", 6, 8);
  assert.equal(w.line, 1);
  assert.equal(w.col, 0);
  const endOfHello = layoutCompose("hello world", 5, 8);
  assert.equal(endOfHello.line, 0);
  assert.equal(endOfHello.col, 5);
  const tight = layoutCompose("hello world", 11, 5);
  assert.equal(tight.lines[0], "hello");
  assert.equal(tight.lines[1], "world");
  assert.equal(
    tight.lines.some((line) => /hel$/.test(line) || /^lo /.test(line) || /wor$/.test(line)),
    false,
  );
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

test("Shift+Enter inserts a newline; Enter sends", () => {
  const draft = { text: "hi", caret: 2 };
  const shifted = handleComposeKey({ return: true, shift: true }, draft, 40);
  assert.equal(shifted.type, "set");
  if (shifted.type === "set") {
    assert.equal(shifted.draft.text, "hi\n");
    assert.equal(shifted.draft.caret, 3);
  }
  const enter = handleComposeKey({ return: true, shift: false }, draft, 40);
  assert.equal(enter.type, "send");
});

test("Cmd+Delete and Cmd+Backspace clear the compose box", () => {
  const draft = { text: "hello", caret: 3 };
  const back = handleComposeKey({ meta: true, backspace: true }, draft, 40);
  assert.deepEqual(back, { type: "set", draft: { text: "", caret: 0 } });
  const del = handleComposeKey({ meta: true, delete: true }, draft, 40);
  assert.deepEqual(del, { type: "set", draft: { text: "", caret: 0 } });
});

test("Cmd+Left and Cmd+Right jump to the current visual line ends", () => {
  const text = "hello world";
  const caret = 8;
  const laid = layoutCompose(text, caret, 8);
  assert.deepEqual(laid.lines, ["hello", "world"]);
  assert.equal(laid.line, 1);
  const left = handleComposeKey({ meta: true, leftArrow: true }, { text, caret }, 8);
  assert.equal(left.type, "set");
  if (left.type === "set") {
    assert.equal(left.draft.caret, lineStartCaret(laid));
    assert.equal(left.draft.caret, 6);
  }
  const right = handleComposeKey({ meta: true, rightArrow: true }, { text, caret }, 8);
  assert.equal(right.type, "set");
  if (right.type === "set") {
    assert.equal(right.draft.caret, lineEndCaret(laid, text.length));
    assert.equal(right.draft.caret, 11);
  }
  assert.equal(left.type === "set" && left.draft.caret === 0, false, "must not jump to the whole draft");
});

test("Up/Down move between compose lines when the draft is multiline", () => {
  const text = "hello world";
  const up = moveCaretVertical(text, 8, 8, -1);
  assert.equal(up, 2);
  const down = moveCaretVertical(text, 2, 8, 1);
  assert.equal(down, 8);
  const top = handleComposeKey({ upArrow: true }, { text, caret: 2 }, 8);
  assert.equal(top.type, "set");
  if (top.type === "set") assert.equal(top.draft.caret, 2);
  const single = handleComposeKey({ upArrow: true }, { text: "hi", caret: 1 }, 40);
  assert.deepEqual(single, { type: "scrollTranscript", dir: "up" });
});
