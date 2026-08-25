import assert from "node:assert/strict";
import { test } from "node:test";
import type { Agent } from "../src/client/types.js";
import { memberListLabel, pickerItems, pickerRows, splitRoster, visiblePickerRows } from "../src/tui/roster.ts";

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

test("pickerRows sections bots then rooms", () => {
  const rows = pickerRows([ada, room, bea]);
  assert.deepEqual(
    rows.map((row) => (row.kind === "heading" ? row.title : row.agent.name)),
    ["Bots", "Ada", "Bea", "Rooms", "project X"],
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

test("visiblePickerRows keeps the selected room in view with its heading", () => {
  const rows = pickerRows([ada, bea, room]);
  const visible = visiblePickerRows(rows, room.id, 3);
  assert.ok(visible.some((row) => row.kind === "heading" && row.title === "Rooms"));
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
