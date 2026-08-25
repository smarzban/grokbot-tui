import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  fetchBytesWithHeaders,
  hydrateTurnImages,
  resetAttachmentCacheForTests,
} from "../src/client/attachments.ts";
import type { ChatImage, ChatTurn } from "../src/client/types.ts";

const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

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

test("hydrateTurnImages writes gateway bytes to a cache file", async () => {
  resetAttachmentCacheForTests();
  const cache = mkdtempSync(join(tmpdir(), "grok-tui-att-"));
  let calls = 0;
  const turns = await hydrateTurnImages(
    "agent-ada",
    imageTurn({
      alt: "shot.png",
      fileName: "shot.png",
      mime: "image/png",
      entryId: "entry-9",
    }),
    {
      cacheDir: cache,
      call: async (command, body) => {
        calls += 1;
        assert.equal(command, "readAttachmentImage");
        assert.equal((body as { fileName?: string }).fileName, "shot.png");
        assert.equal((body as { agentId?: string }).agentId, "agent-ada");
        return { bytes: TINY_PNG.toString("base64") };
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

test("hydrateTurnImages learns the body that worked and retries that first", async () => {
  resetAttachmentCacheForTests();
  const cache = mkdtempSync(join(tmpdir(), "grok-tui-learn-"));
  const seen: Array<{ command: string; body: Record<string, unknown> }> = [];
  await hydrateTurnImages(
    "bot",
    imageTurn({
      alt: "a.png",
      fileName: "a.png",
      id: "att-1",
    }),
    {
      cacheDir: cache,
      call: async (command, body) => {
        seen.push({ command, body: body as Record<string, unknown> });
        if ((body as { id?: string }).id === "att-1") {
          return { data: TINY_PNG.toString("base64") };
        }
        throw new Error("nope");
      },
    },
  );
  assert.ok(seen.length >= 2);
  seen.length = 0;
  await hydrateTurnImages(
    "bot",
    imageTurn({
      alt: "b.png",
      fileName: "b.png",
      id: "att-2",
    }),
    {
      cacheDir: cache,
      call: async (command, body) => {
        seen.push({ command, body: body as Record<string, unknown> });
        if ((body as { id?: string }).id === "att-2") {
          return { data: TINY_PNG.toString("base64") };
        }
        throw new Error("should have used learned id body first");
      },
    },
  );
  assert.equal(seen.length, 1);
  assert.equal(seen[0]?.body.id, "att-2");
  assert.equal(seen[0]?.body.agentId, "bot");
});

test("hydrateTurnImages falls back to readAttachmentChunk", async () => {
  resetAttachmentCacheForTests();
  const cache = mkdtempSync(join(tmpdir(), "grok-tui-chunk-"));
  const commands: string[] = [];
  const turns = await hydrateTurnImages(
    "bot",
    imageTurn({ alt: "c.png", fileName: "c.png", entryId: "e1" }),
    {
      cacheDir: cache,
      call: async (command, body) => {
        commands.push(command);
        if (command === "readAttachmentImage") throw new Error("missing");
        assert.equal(command, "readAttachmentChunk");
        assert.equal((body as { offset?: number }).offset, 0);
        return TINY_PNG.toString("base64");
      },
    },
  );
  assert.ok(turns[0]?.images?.[0]?.path);
  assert.ok(commands.includes("readAttachmentChunk"));
});

test("hydrateTurnImages fetches https url when gateway has no bytes", async () => {
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
