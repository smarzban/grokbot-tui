import assert from "node:assert/strict";
import { test } from "node:test";
import { mockPhotoPath } from "../src/client/mock.ts";
import { IMAGE_CELL_ROWS, localImagePath } from "../src/tui/images.ts";
import { isFullPictureRun, turnsToRows } from "../src/tui/layout.ts";

test("alt-only attachments stay a one-line placeholder", () => {
  const rows = turnsToRows(
    [{ id: "1", role: "user", speaker: "you", text: "", images: [{ alt: "shot.png" }] }],
    40,
    "Ada",
  );
  const imageRows = rows.filter((row) => row.kind === "image" || row.kind === "picture");
  assert.equal(imageRows.length, 1);
  assert.equal(imageRows[0]?.kind, "image");
  assert.match(imageRows[0]?.text ?? "", /\[image\]/);
  assert.match(imageRows[0]?.text ?? "", /shot\.png/);
  assert.equal(imageRows[0]?.text.includes("http"), false);
});

test("a real local path reserves a picture block; a missing path does not", () => {
  const photo = mockPhotoPath();
  const painted = turnsToRows(
    [
      {
        id: "p",
        role: "user",
        speaker: "you",
        text: "",
        images: [{ alt: "mock-photo.png", path: photo }],
      },
    ],
    40,
    "Ada",
  );
  const slots = painted.filter((row) => row.kind === "picture");
  assert.equal(slots.length, IMAGE_CELL_ROWS);
  assert.equal(slots[0]?.pictureSlot, 0);
  assert.equal(slots.at(-1)?.pictureSlot, IMAGE_CELL_ROWS - 1);
  assert.equal(isFullPictureRun(painted, painted.indexOf(slots[0]!)), true);
  assert.equal(localImagePath({ path: photo }), photo);

  const missing = turnsToRows(
    [
      {
        id: "m",
        role: "assistant",
        speaker: "Ada",
        text: "",
        images: [{ alt: "gone.png", path: "/no/such/grok-tui-image.png" }],
      },
    ],
    40,
    "Ada",
  );
  assert.equal(missing.some((row) => row.kind === "picture"), false);
  assert.ok(missing.some((row) => row.kind === "image" && /gone\.png/.test(row.text)));
});

test("http urls are never treated as paint paths", () => {
  assert.equal(localImagePath({ path: "https://example.invalid/secret.png" }), undefined);
  assert.equal(localImagePath({ url: "https://example.invalid/secret.png", alt: "secret.png" }), undefined);
  const rows = turnsToRows(
    [
      {
        id: "u",
        role: "user",
        speaker: "you",
        text: "",
        images: [{ alt: "remote.png", url: "https://example.invalid/x?token=abc" }],
      },
    ],
    40,
    "Ada",
  );
  const line = rows.find((row) => row.kind === "image");
  assert.ok(line);
  assert.match(line.text, /\[image\] remote\.png/);
  assert.equal(line.text.includes("http"), false);
  assert.equal(line.text.includes("token"), false);
});

test("a clipped picture run is not full, so Kitty would not mount", () => {
  const photo = mockPhotoPath();
  const rows = turnsToRows(
    [{ id: "p", role: "user", speaker: "you", text: "", images: [{ alt: "mock-photo.png", path: photo }] }],
    40,
    "Ada",
  );
  const slots = rows.filter((row) => row.kind === "picture");
  assert.equal(isFullPictureRun(slots.slice(2), 0), false);
  assert.equal(isFullPictureRun(slots, 1), false);
});
