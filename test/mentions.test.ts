import assert from "node:assert/strict";
import { test } from "node:test";
import type { Agent } from "../src/client/types.js";
import {
  completeMention,
  filterMentions,
  mentionMenuOpen,
  mentionNames,
  mentionQuery,
  wrapMentionIndex,
} from "../src/tui/mentions.ts";

const room: Agent = {
  id: "room",
  name: "project X",
  isGroup: true,
  memberIds: ["dev", "chief"],
  members: [
    { id: "dev", name: "Dev" },
    { id: "chief", name: "Chief of Staff" },
  ],
};

const ada: Agent = { id: "ada", name: "Ada", isGroup: false };

test("prefix D matches Dev", () => {
  const names = mentionNames(room);
  assert.deepEqual(names, ["Dev", "Chief of Staff"]);
  assert.deepEqual(filterMentions(names, "D"), ["Dev"]);
  assert.deepEqual(filterMentions(names, "d"), ["Dev"]);
  assert.deepEqual(filterMentions(names, "C"), ["Chief of Staff"]);
  assert.deepEqual(filterMentions(names, ""), ["Dev", "Chief of Staff"]);
  assert.deepEqual(filterMentions(names, "Z"), []);
});

test("Tab with one match expands draft", () => {
  const names = filterMentions(mentionNames(room), "D");
  assert.equal(names.length, 1);
  assert.equal(completeMention("@D", names[0]!), "@Dev ");
  assert.equal(completeMention("hi @D", "Dev"), "hi @Dev ");
  assert.equal(completeMention("@", "Dev"), "@Dev ");
});

test("Esc dismisses", () => {
  assert.equal(mentionMenuOpen(1, false), true);
  assert.equal(mentionMenuOpen(1, true), false);
  assert.equal(mentionMenuOpen(0, false), false);
});

test("mention query is the @token at the end; 1:1 has no names", () => {
  assert.deepEqual(mentionQuery("@D"), { start: 0, prefix: "D" });
  assert.deepEqual(mentionQuery("go @"), { start: 3, prefix: "" });
  assert.equal(mentionQuery("@Dev "), null);
  assert.equal(mentionQuery("user@host"), null);
  assert.deepEqual(mentionNames(ada), []);
  assert.equal(wrapMentionIndex(0, 2, -1), 1);
  assert.equal(wrapMentionIndex(1, 2, 1), 0);
});
