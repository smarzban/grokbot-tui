import type { Agent } from "../client/types.js";

export type PickerRow =
  | { kind: "heading"; title: string }
  | { kind: "item"; agent: Agent };

export function splitRoster(agents: Agent[]): { bots: Agent[]; rooms: Agent[] } {
  const bots: Agent[] = [];
  const rooms: Agent[] = [];
  for (const agent of agents) {
    if (agent.isGroup) rooms.push(agent);
    else bots.push(agent);
  }
  return { bots, rooms };
}

/** Bots first, then rooms — the order the picker cursor walks. */
export function pickerItems(agents: Agent[]): Agent[] {
  const { bots, rooms } = splitRoster(agents);
  return [...bots, ...rooms];
}

export function pickerRows(agents: Agent[]): PickerRow[] {
  const { bots, rooms } = splitRoster(agents);
  const rows: PickerRow[] = [];
  if (bots.length > 0) {
    rows.push({ kind: "heading", title: "Bots" });
    for (const agent of bots) rows.push({ kind: "item", agent });
  }
  if (rooms.length > 0) {
    rows.push({ kind: "heading", title: "Rooms" });
    for (const agent of rooms) rows.push({ kind: "item", agent });
  }
  return rows;
}

export function visiblePickerRows(
  rows: PickerRow[],
  selectedId: string | undefined,
  budget: number,
): PickerRow[] {
  if (budget < 1) return [];
  if (rows.length <= budget) return rows;
  const selected = Math.max(
    0,
    rows.findIndex((row) => row.kind === "item" && row.agent.id === selectedId),
  );
  const maxStart = Math.max(0, rows.length - budget);
  const start = Math.min(Math.max(0, selected - budget + 1), maxStart);
  return rows.slice(start, start + budget);
}

export function memberListLabel(agent: Agent, roster: Agent[] = []): string {
  if (!agent.isGroup) return "";
  const names =
    agent.members && agent.members.length > 0
      ? agent.members.map((member) => member.name)
      : (agent.memberIds ?? []).map((id) => roster.find((row) => row.id === id)?.name ?? id);
  return names.filter((name) => name.trim().length > 0).join(" · ");
}
