import assert from "node:assert/strict";
import { test } from "node:test";
import { applyScrollDelta, maxScrollOffset } from "../src/tui/layout.ts";
import {
  applyWheelButton,
  applyWheelScroll,
  consumeMouseInput,
  isMouseInput,
  parseSgrMouse,
  scrollDeltaForButton,
  WHEEL_DOWN_BUTTON,
  WHEEL_LINE_DELTA,
  WHEEL_UP_BUTTON,
} from "../src/tui/mouse.ts";

const ROW_COUNT = 20;
const BUDGET = 5;
const MAX = maxScrollOffset(ROW_COUNT, BUDGET);

test("wheel-up increases offset", () => {
  assert.equal(applyWheelScroll(0, "up", ROW_COUNT, BUDGET), WHEEL_LINE_DELTA);
  assert.equal(applyWheelButton(2, WHEEL_UP_BUTTON, ROW_COUNT, BUDGET), 2 + WHEEL_LINE_DELTA);
  assert.equal(scrollDeltaForButton(WHEEL_UP_BUTTON), WHEEL_LINE_DELTA);
  const parsed = parseSgrMouse("\x1b[<64;12;8M");
  assert.ok(parsed);
  assert.equal(parsed.button, 64);
  assert.equal(applyWheelButton(0, parsed.button, ROW_COUNT, BUDGET), WHEEL_LINE_DELTA);
});

test("wheel-down decreases offset", () => {
  assert.equal(applyWheelScroll(6, "down", ROW_COUNT, BUDGET), 6 - WHEEL_LINE_DELTA);
  assert.equal(applyWheelButton(9, WHEEL_DOWN_BUTTON, ROW_COUNT, BUDGET), 9 - WHEEL_LINE_DELTA);
  assert.equal(scrollDeltaForButton(WHEEL_DOWN_BUTTON), -WHEEL_LINE_DELTA);
  const parsed = parseSgrMouse("[<65;4;2M");
  assert.ok(parsed);
  assert.equal(parsed.button, 65);
  assert.equal(applyWheelButton(6, parsed.button, ROW_COUNT, BUDGET), 3);
});

test("clamp at 0 and max", () => {
  assert.equal(applyWheelScroll(0, "down", ROW_COUNT, BUDGET), 0);
  assert.equal(applyWheelButton(1, WHEEL_DOWN_BUTTON, ROW_COUNT, BUDGET), 0);
  assert.equal(applyWheelScroll(MAX, "up", ROW_COUNT, BUDGET), MAX);
  assert.equal(applyWheelButton(MAX - 1, WHEEL_UP_BUTTON, ROW_COUNT, BUDGET), MAX);
  assert.equal(applyScrollDelta(0, -WHEEL_LINE_DELTA, ROW_COUNT, BUDGET), 0);
  assert.equal(applyScrollDelta(MAX, WHEEL_LINE_DELTA, ROW_COUNT, BUDGET), MAX);
});

test("SGR mouse sequences are recognized with or without the ESC Ink strips", () => {
  assert.equal(isMouseInput("\x1b[<64;1;1M"), true);
  assert.equal(isMouseInput("[<64;10;5M"), true);
  assert.equal(isMouseInput("[<65;10;5m"), true);
  assert.equal(isMouseInput("hello"), false);
  assert.equal(isMouseInput("["), false);
  const { events, rest } = consumeMouseInput("[<64;8;3M[<65;8;3M");
  assert.equal(rest, "");
  assert.equal(events.length, 2);
  assert.equal(events[0]?.button, 64);
  assert.equal(events[1]?.button, 65);
  assert.equal(events[1]?.release, false);
});

test("wheel reports with modifiers still scroll; clicks do not", () => {
  assert.equal(scrollDeltaForButton(64 + 4), WHEEL_LINE_DELTA);
  assert.equal(scrollDeltaForButton(65 + 16), -WHEEL_LINE_DELTA);
  assert.equal(scrollDeltaForButton(0), null);
  assert.equal(scrollDeltaForButton(1), null);
  assert.equal(applyWheelButton(4, 0, ROW_COUNT, BUDGET), 4);
});
