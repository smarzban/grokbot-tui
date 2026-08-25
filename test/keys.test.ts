import assert from "node:assert/strict";
import { test } from "node:test";
import { isCtrlKey, rewriteKittyCtrlCChunk } from "../src/tui/keys.ts";

test("isCtrlKey('c') with ctrl", () => {
  assert.equal(isCtrlKey("c", { ctrl: true }, "c"), true);
  assert.equal(isCtrlKey("C", { ctrl: true }, "c"), true);
  assert.equal(isCtrlKey("c", { ctrl: false }, "c"), false);
  assert.equal(isCtrlKey("x", { ctrl: true }, "c"), false);
});

test("isCtrlKey treats \\x03 as Ctrl+C", () => {
  assert.equal(isCtrlKey("\x03", { ctrl: true }, "c"), true);
  assert.equal(isCtrlKey("\x03", { ctrl: false }, "c"), true);
});

test("isCtrlKey reads the letter from kitty name/text when input is empty", () => {
  assert.equal(isCtrlKey("", { ctrl: true, name: "c" }, "c"), true);
  assert.equal(isCtrlKey("", { ctrl: true, text: "c" }, "c"), true);
  assert.equal(isCtrlKey("", { ctrl: true, sequence: "c" }, "c"), true);
  assert.equal(isCtrlKey("", { ctrl: true }, "c"), false);
});

test("isCtrlKey parses kitty CSI-u Ctrl+C (ESC stripped or not)", () => {
  assert.equal(isCtrlKey("[99;5u", { ctrl: false }, "c"), true);
  assert.equal(isCtrlKey("\x1b[99;5u", { ctrl: false }, "c"), true);
  assert.equal(isCtrlKey("[99;5u", { ctrl: true }, "c"), true);
  assert.equal(isCtrlKey("[99;5:1u", {}, "c"), true);
  assert.equal(isCtrlKey("[99;2u", { ctrl: false }, "c"), false);
  assert.equal(isCtrlKey("[98;5u", { ctrl: true }, "c"), false);
});

test("isCtrlKey works for ctrl+a/b/e/u/d", () => {
  assert.equal(isCtrlKey("a", { ctrl: true }, "a"), true);
  assert.equal(isCtrlKey("b", { ctrl: true }, "b"), true);
  assert.equal(isCtrlKey("e", { ctrl: true }, "e"), true);
  assert.equal(isCtrlKey("u", { ctrl: true }, "u"), true);
  assert.equal(isCtrlKey("d", { ctrl: true }, "d"), true);
  assert.equal(isCtrlKey("\x01", { ctrl: false }, "a"), true);
  assert.equal(isCtrlKey("\x02", { ctrl: false }, "b"), true);
  assert.equal(isCtrlKey("[97;5u", {}, "a"), true);
  assert.equal(isCtrlKey("[101;5u", {}, "e"), true);
  assert.equal(isCtrlKey("[117;5u", {}, "u"), true);
  assert.equal(isCtrlKey("[100;5u", {}, "d"), true);
  assert.equal(isCtrlKey("a", { ctrl: false }, "a"), false);
});

test("isCtrlKey does not treat Enter/Tab/LF as ctrl chords without key.ctrl", () => {
  assert.equal(isCtrlKey("\n", {}, "j"), false);
  assert.equal(isCtrlKey("\n", { ctrl: true }, "j"), true);
  assert.equal(isCtrlKey("\t", {}, "i"), false);
  assert.equal(isCtrlKey("\r", {}, "m"), false);
});

test("rewriteKittyCtrlCChunk turns kitty CSI-u Ctrl+C into \\x03", () => {
  assert.equal(rewriteKittyCtrlCChunk("\x1b[99;5u"), "\x03");
  assert.equal(rewriteKittyCtrlCChunk("\x1b[3;5u"), "\x03");
  assert.equal(rewriteKittyCtrlCChunk("\x1b[99;5:1u"), "\x03");
  assert.equal(rewriteKittyCtrlCChunk("hello"), "hello");
  assert.equal(rewriteKittyCtrlCChunk("\x1b[99;2u"), "\x1b[99;2u");
  assert.equal(rewriteKittyCtrlCChunk("\x1b[98;5u"), "\x1b[98;5u");
});


