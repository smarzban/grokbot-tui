import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { mockPhotoPath } from "../src/client/mock.ts";
import { IMAGE_CELL_ROWS, imagesFromText, localImagePath } from "../src/tui/images.ts";
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

test("a user turn whose text is a local image path draws, not a path line", () => {
  const photo = mockPhotoPath();
  const extracted = imagesFromText(photo);
  assert.equal(extracted.text, "");
  assert.equal(extracted.images[0]?.path, photo);
  assert.equal(extracted.images[0]?.alt, "mock-photo.png");

  const rows = turnsToRows([{ id: "1", role: "user", speaker: "you", text: photo }], 80, "Ada");
  assert.ok(rows.some((row) => row.kind === "picture"));
  assert.equal(
    rows.some((row) => row.kind === "body"),
    false,
    "path-only message should not keep the path as bubble text",
  );
});

test("assistant path-in-text also draws; missing files stay text", () => {
  const photo = mockPhotoPath();
  const drawn = turnsToRows(
    [{ id: "a", role: "assistant", speaker: "Ada", text: photo }],
    80,
    "Ada",
  );
  assert.ok(drawn.some((row) => row.kind === "picture"));

  const missing = "/no/such/Screenshot 2026-08-25 at 11.22.58 AM.png";
  const kept = imagesFromText(missing);
  assert.equal(kept.images.length, 0);
  assert.equal(kept.text, missing);
  const rows = turnsToRows([{ id: "m", role: "user", speaker: "you", text: missing }], 80, "Ada");
  assert.equal(rows.some((row) => row.kind === "picture"), false);
  assert.ok(rows.some((row) => row.kind === "body"));
});

test("file://, quotes, drag-escaped spaces, and captions", () => {
  const photo = mockPhotoPath();
  const fileUrl = pathToFileURL(photo).href;
  assert.equal(imagesFromText(fileUrl).images[0]?.path, photo);
  assert.equal(imagesFromText(`'${photo}'`).text, "");
  assert.equal(imagesFromText(`"${photo}"`).images.length, 1);

  const dir = mkdtempSync(join(tmpdir(), "grok-tui-img-"));
  const spaced = join(dir, "Screenshot 2026-08-25 at 11.22.58 AM.png");
  copyFileSync(photo, spaced);
  const escaped = spaced.replaceAll(" ", "\\ ");
  const fromEscaped = imagesFromText(escaped);
  assert.equal(fromEscaped.text, "");
  assert.equal(fromEscaped.images[0]?.path, spaced);
  assert.equal(fromEscaped.images[0]?.alt, "Screenshot 2026-08-25 at 11.22.58 AM.png");
  assert.equal(imagesFromText(`'${spaced}'`).images[0]?.path, spaced);

  const captioned = imagesFromText(`please review\n${photo}`);
  assert.equal(captioned.text, "please review");
  assert.equal(captioned.images[0]?.path, photo);
});
