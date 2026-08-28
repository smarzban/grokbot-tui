import assert from "node:assert/strict";
import { test } from "node:test";
import type { Agent } from "../src/client/types.js";
import { memberListLabel, pickerItems, pickerRows, splitRoster, visiblePickerRows, answeringIndicator, answeringMemberNames, busyMemberNames, busyNamesSignature, pendingReplyMemberNames, mentionedMemberNames } from "../src/tui/roster.ts";
import type { ChatTurn } from "../src/client/types.js";

const ada: Agent = { id: "ada", name: "Ada", isGroup: false };
const bea: Agent = { id: "bea", name: "Bea", isGroup: false };
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

test("pickerRows sections bots then channels with spacers", () => {
  const rows = pickerRows([ada, room, bea]);
  assert.deepEqual(
    rows.map((row) =>
      row.kind === "heading" ? row.title : row.kind === "spacer" ? "" : row.agent.name,
    ),
    ["Bots", "Ada", "Bea", "", "", "Channels", "project X"],
  );
  const items = pickerItems([ada, room, bea]);
  assert.deepEqual(
    items.map((agent) => agent.name),
    ["Ada", "Bea", "project X"],
  );
  const { bots, rooms } = splitRoster([ada, room, bea]);
  assert.equal(bots.length, 2);
  assert.equal(rooms.length, 1);
  assert.equal(rooms[0]?.isGroup, true);
});

test("visiblePickerRows keeps the selected channel in view with its heading", () => {
  const rows = pickerRows([ada, bea, room]);
  const visible = visiblePickerRows(rows, room.id, 3);
  assert.ok(visible.some((row) => row.kind === "heading" && row.title === "Channels"));
  assert.ok(visible.some((row) => row.kind === "item" && row.agent.id === room.id));
});

test("memberListLabel joins room members and is empty for bots", () => {
  assert.equal(memberListLabel(room), "Dev · Chief of Staff");
  assert.equal(memberListLabel(ada), "");
  assert.equal(
    memberListLabel({ id: "r", name: "room", isGroup: true, memberIds: ["dev"] }, [
      { id: "dev", name: "Dev", isGroup: false },
    ]),
    "Dev",
  );
});

test("answeringIndicator names members who areRunning", () => {
  const dev: Agent = { id: "dev", name: "Dev", isGroup: false, isRunning: true };
  const chief: Agent = { id: "chief", name: "Chief of Staff", isGroup: false };
  const roster = [dev, chief, room];
  assert.equal(answeringIndicator(busyMemberNames(dev, roster)), "Dev is answering…");
  assert.equal(answeringIndicator(busyMemberNames(room, roster)), "Dev is answering…");
  assert.equal(
    answeringIndicator(busyMemberNames(room, [{ ...dev }, { ...chief, isRunning: true }, room])),
    "Dev, Chief of Staff answering…",
  );
  assert.equal(answeringIndicator(busyMemberNames(room, [{ ...dev, isRunning: false }, chief, room])), null);
  assert.equal(
    answeringIndicator(busyMemberNames(ada, [{ ...ada, isComposingMessage: true }])),
    "Ada is answering…",
  );
  assert.equal(busyNamesSignature(["Dev"]), busyNamesSignature(["Dev"]));
  assert.notEqual(busyNamesSignature(["Dev"]), busyNamesSignature(["Dev", "Chief of Staff"]));
});

test("pendingReplyMemberNames infers a 1:1 bot from the last user turn", () => {
  const turns: ChatTurn[] = [{ id: "1", role: "user", speaker: "you", text: "hello" }];
  assert.deepEqual(pendingReplyMemberNames(turns, ada, [ada]), ["Ada"]);
  assert.deepEqual(
    pendingReplyMemberNames([{ id: "2", role: "assistant", speaker: "Ada", text: "hi" }], ada, [ada]),
    [],
  );
});

test("pendingReplyMemberNames uses @mentions in rooms", () => {
  const turns: ChatTurn[] = [{ id: "1", role: "user", speaker: "you", text: "@Dev status?" }];
  assert.deepEqual(pendingReplyMemberNames(turns, room, [room]), ["Dev"]);
  assert.deepEqual(
    pendingReplyMemberNames([{ id: "1", role: "user", speaker: "you", text: "hello all" }], room, [room]),
    [],
  );
  assert.deepEqual(mentionedMemberNames("@Chief of Staff ping", room, [room]), ["Chief of Staff"]);
});

test("answeringMemberNames follows transcript pending, not roster busy flags", () => {
  const dev: Agent = { id: "dev", name: "Dev", isGroup: false, isRunning: true };
  const waiting: ChatTurn[] = [{ id: "1", role: "user", speaker: "you", text: "@Dev go" }];
  assert.deepEqual(answeringMemberNames(room, [dev, room], waiting), ["Dev"]);
  const done: ChatTurn[] = [
    { id: "1", role: "user", speaker: "you", text: "@Dev go" },
    { id: "2", role: "assistant", speaker: "Dev", text: "on it" },
  ];
  assert.deepEqual(answeringMemberNames(room, [dev, room], done), []);
});

test("answeringMemberNames in channels ignores delayed roster busy without @mention", () => {
  const dev: Agent = { id: "dev", name: "Dev", isGroup: false, isRunning: true };
  const turns: ChatTurn[] = [{ id: "1", role: "user", speaker: "you", text: "hello all" }];
  assert.deepEqual(answeringMemberNames(room, [dev, room], turns), []);
});

test("answeringMemberNames treats trailing tool markers as working", () => {
  const working: ChatTurn[] = [
    { id: "1", role: "user", speaker: "you", text: "go" },
    { id: "2", role: "tool", speaker: "Ada", speakerId: "ada", text: "" },
  ];
  assert.deepEqual(answeringMemberNames(ada, [ada], working), ["Ada"]);
  const roomWorking: ChatTurn[] = [
    { id: "1", role: "user", speaker: "you", text: "@Dev go" },
    { id: "2", role: "assistant", speaker: "Dev", text: "ok" },
    { id: "3", role: "tool", speaker: "Dev", speakerId: "dev", text: "" },
  ];
  assert.deepEqual(answeringMemberNames(room, [room], roomWorking), ["Dev"]);
});
