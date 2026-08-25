import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  attachmentReadPaths,
  decodeAttachmentResult,
  fetchBytesWithHeaders,
  hydrateTurnImages,
  resetAttachmentCacheForTests,
} from "../src/client/attachments.ts";
import type { ChatImage, ChatTurn } from "../src/client/types.ts";

const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const TINY_DATA_URL = `data:image/png;base64,${TINY_PNG.toString("base64")}`;

function imageTurn(image: ChatImage): ChatTurn[] {
  return [
    {
      id: "t1",
      role: "user",
      speaker: "you",
      text: "photo",
      images: [image],
    },
  ];
}

test("decodeAttachmentResult reads host dataUrl", () => {
  const decoded = decodeAttachmentResult({ dataUrl: TINY_DATA_URL, width: 1, height: 1 });
  assert.ok(decoded?.bytes);
  assert.deepEqual(decoded.bytes, TINY_PNG);
});

test("hydrateTurnImages calls readAttachmentImage with { path } from file_path", async () => {
  resetAttachmentCacheForTests();
  const cache = mkdtempSync(join(tmpdir(), "grok-tui-att-"));
  const hostPath = "/home/box/sand-data/shot.png";
  let calls = 0;
  const turns = await hydrateTurnImages(
    "agent-ada",
    imageTurn({
      alt: "Screenshot.png",
      fileName: "Screenshot.png",
      file_path: hostPath,
      id: "t32ua0",
    }),
    {
      cacheDir: cache,
      call: async (command, body) => {
        calls += 1;
        assert.equal(command, "readAttachmentImage");
        assert.equal((body as { path?: string }).path, hostPath);
        assert.equal("fileName" in body, false);
        assert.ok(!String((body as { path?: string }).path).startsWith("file:"));
        return { dataUrl: TINY_DATA_URL, width: 8, height: 8 };
      },
    },
  );
  assert.equal(calls, 1);
  const path = turns[0]?.images?.[0]?.path;
  assert.ok(path);
  assert.deepEqual(readFileSync(path), TINY_PNG);

  calls = 0;
  await hydrateTurnImages("agent-ada", turns, {
    cacheDir: cache,
    call: async () => {
      calls += 1;
      throw new Error("must not re-download");
    },
  });
  assert.equal(calls, 0, "cached path skips gateway on the next poll");
});

test("hydrateTurnImages converts file:// url with fileURLToPath, never sends file://", async () => {
  resetAttachmentCacheForTests();
  const cache = mkdtempSync(join(tmpdir(), "grok-tui-fileurl-"));
  const fileUrl = "file:///home/box/sand-data/cat.png";
  const expected = fileURLToPath(fileUrl);
  assert.equal(expected, "/home/box/sand-data/cat.png");
  assert.deepEqual(attachmentReadPaths({ url: fileUrl, alt: "cat" }), [expected]);

  const turns = await hydrateTurnImages(
    "bot",
    imageTurn({ alt: "cat", url: fileUrl, width: 32, height: 32 }),
    {
      cacheDir: cache,
      call: async (command, body) => {
        assert.equal(command, "readAttachmentImage");
        const path = (body as { path?: string }).path;
        assert.equal(path, expected);
        assert.ok(path && !path.startsWith("file:"));
        return { dataUrl: TINY_DATA_URL, width: 32, height: 32 };
      },
    },
  );
  assert.ok(turns[0]?.images?.[0]?.path);
  assert.deepEqual(readFileSync(turns[0]!.images![0]!.path!), TINY_PNG);
});

test("hydrateTurnImages fetches https url when there is no host path", async () => {
  resetAttachmentCacheForTests();
  const cache = mkdtempSync(join(tmpdir(), "grok-tui-url-"));
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const href = String(input);
    assert.ok(href.startsWith("https://files.example/"));
    return new Response(TINY_PNG, { status: 200, headers: { "content-type": "image/png" } });
  }) as typeof fetch;
  try {
    const turns = await hydrateTurnImages(
      "bot",
      imageTurn({
        alt: "remote.png",
        fileName: "remote.png",
        url: "https://files.example/remote.png",
        attachmentPaths: ["https://files.example/remote.png"],
      }),
      {
        cacheDir: cache,
        call: async () => {
          throw new Error("no attachment command");
        },
        fetchUrl: (url) => fetchBytesWithHeaders(url, { authorization: "Bearer test" }),
      },
    );
    assert.ok(turns[0]?.images?.[0]?.path);
    assert.deepEqual(readFileSync(turns[0]!.images![0]!.path!), TINY_PNG);
  } finally {
    globalThis.fetch = original;
  }
});

test("alt-only ChatImage stays a placeholder (no path, no gateway call)", async () => {
  resetAttachmentCacheForTests();
  let calls = 0;
  const turns = await hydrateTurnImages("bot", imageTurn({ alt: "mystery.png" }), {
    call: async () => {
      calls += 1;
      throw new Error("should not be required for alt-only");
    },
  });
  assert.equal(calls, 0);
  assert.equal(turns[0]?.images?.[0]?.path, undefined);
  assert.equal(turns[0]?.images?.[0]?.alt, "mystery.png");
});

test("existing local path is left alone", async () => {
  resetAttachmentCacheForTests();
  const dir = mkdtempSync(join(tmpdir(), "grok-tui-exist-"));
  const file = join(dir, "keep.png");
  writeFileSync(file, TINY_PNG);
  let calls = 0;
  const turns = await hydrateTurnImages("bot", imageTurn({ alt: "keep.png", path: file }), {
    call: async () => {
      calls += 1;
      throw new Error("must not fetch");
    },
  });
  assert.equal(calls, 0);
  assert.equal(turns[0]?.images?.[0]?.path, file);
});
