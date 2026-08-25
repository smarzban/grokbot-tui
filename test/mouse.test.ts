import assert from "node:assert/strict";
import { test } from "node:test";
import { applyScrollDelta, maxScrollOffset } from "../src/tui/layout.ts";
import {
  consumeMouseInput,
  scrollDeltaForButton,
  WHEEL_DOWN_BUTTON,
  WHEEL_LINE_DELTA,
  WHEEL_UP_BUTTON,
} from "../src/tui/mouse.ts";

const ROW_COUNT = 20;
const BUDGET = 5;
const MAX = maxScrollOffset(ROW_COUNT, BUDGET);

function applyWheel(offset: number, button: number): number {
  const delta = scrollDeltaForButton(button);
  if (delta == null) return applyScrollDelta(offset, 0, ROW_COUNT, BUDGET);
  return applyScrollDelta(offset, delta, ROW_COUNT, BUDGET);
}

test("wheel-up increases offset", () => {
  assert.equal(applyScrollDelta(0, WHEEL_LINE_DELTA, ROW_COUNT, BUDGET), WHEEL_LINE_DELTA);
  assert.equal(applyWheel(2, WHEEL_UP_BUTTON), 2 + WHEEL_LINE_DELTA);
  assert.equal(scrollDeltaForButton(WHEEL_UP_BUTTON), WHEEL_LINE_DELTA);
  const { events } = consumeMouseInput("\x1b[<64;12;8M");
  assert.equal(events[0]?.button, 64);
  assert.equal(applyWheel(0, events[0]!.button), WHEEL_LINE_DELTA);
});

test("wheel-down decreases offset", () => {
  assert.equal(applyScrollDelta(6, -WHEEL_LINE_DELTA, ROW_COUNT, BUDGET), 6 - WHEEL_LINE_DELTA);
  assert.equal(applyWheel(9, WHEEL_DOWN_BUTTON), 9 - WHEEL_LINE_DELTA);
  assert.equal(scrollDeltaForButton(WHEEL_DOWN_BUTTON), -WHEEL_LINE_DELTA);
  const { events } = consumeMouseInput("[<65;4;2M");
  assert.equal(events[0]?.button, 65);
  assert.equal(applyWheel(6, events[0]!.button), 3);
});

test("clamp at 0 and max", () => {
  assert.equal(applyScrollDelta(0, -WHEEL_LINE_DELTA, ROW_COUNT, BUDGET), 0);
  assert.equal(applyWheel(1, WHEEL_DOWN_BUTTON), 0);
  assert.equal(applyScrollDelta(MAX, WHEEL_LINE_DELTA, ROW_COUNT, BUDGET), MAX);
  assert.equal(applyWheel(MAX - 1, WHEEL_UP_BUTTON), MAX);
});

test("SGR mouse sequences are recognized with or without the ESC Ink strips", () => {
  assert.equal(consumeMouseInput("\x1b[<64;1;1M").events.length, 1);
  assert.equal(consumeMouseInput("[<64;10;5M").events.length, 1);
  assert.equal(consumeMouseInput("[<65;10;5m").events[0]?.release, true);
  assert.equal(consumeMouseInput("hello").events.length, 0);
  assert.equal(consumeMouseInput("[").rest, "[");
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
  assert.equal(applyWheel(4, 0), 4);
});
