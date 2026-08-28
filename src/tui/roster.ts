import type { Agent, ChatTurn } from "../client/types.js";
import { mentionNames } from "./mentions.js";

export type PickerRow =
  | { kind: "heading"; title: string }
  | { kind: "item"; agent: Agent }
  | { kind: "spacer" };

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
    if (bots.length > 0) {
      rows.push({ kind: "spacer" });
      rows.push({ kind: "spacer" });
    }
    rows.push({ kind: "heading", title: "Channels" });
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

/** Host listAgents busy flags. No keystroke-level typing API. */
export function isAgentBusy(agent: Agent | undefined): boolean {
  if (!agent) return false;
  return agent.isRunning === true || agent.isComposingMessage === true;
}

function memberName(id: string, focus: Agent, roster: Agent[]): string {
  const fromFocus = focus.members?.find((member) => member.id === id)?.name;
  if (fromFocus?.trim()) return fromFocus.trim();
  const fromRoster = roster.find((row) => row.id === id)?.name;
  if (fromRoster?.trim()) return fromRoster.trim();
  return id;
}

/**
 * Names currently answering in this chat, from listAgents isRunning /
 * isComposingMessage. Rooms use each member's own roster row.
 */
export function busyMemberNames(focus: Agent, roster: Agent[]): string[] {
  const live = roster.find((row) => row.id === focus.id) ?? focus;
  if (!live.isGroup) {
    return isAgentBusy(live) ? [live.name.trim() || "bot"] : [];
  }
  const ids = live.memberIds ?? focus.memberIds ?? [];
  const names: string[] = [];
  for (const id of ids) {
    const row = roster.find((agent) => agent.id === id);
    if (!isAgentBusy(row)) continue;
    const name = memberName(id, live, roster);
    if (!names.includes(name)) names.push(name);
  }
  return names;
}

/** Stable signature so poll can skip setState when busy names did not change. */
export function busyNamesSignature(names: string[]): string {
  return names.join("\0");
}

export function answeringIndicator(names: string[]): string | null {
  if (names.length === 0) return null;
  if (names.length === 1) return `${names[0]} is answering…`;
  return `${names.join(", ")} answering…`;
}

/** @mentions in a room prompt that match known member names. */
export function mentionedMemberNames(text: string, focus: Agent, roster: Agent[]): string[] {
  if (!focus.isGroup) return [];
  const lower = text.toLowerCase();
  const out: string[] = [];
  for (const name of mentionNames(focus, roster)) {
    if (lower.includes(`@${name.toLowerCase()}`) && !out.includes(name)) out.push(name);
  }
  return out;
}

function focusBotName(focus: Agent): string {
  return focus.name.trim() || "bot";
}

const TOOL_SPEAKER_KINDS = new Set(["tool-call", "tool-result", "tool"]);

/**
 * Who should be answering when the transcript tail is a user turn with no
 * assistant reply yet. Uses the fast transcript poll — not listAgents.
 */
export function pendingReplyMemberNames(turns: ChatTurn[], focus: Agent, roster: Agent[]): string[] {
  const last = turns.at(-1);
  if (!last || last.role !== "user") return [];
  if (!focus.isGroup) return [focusBotName(focus)];
  return mentionedMemberNames(last.text, focus, roster);
}

/** Tool / streaming marker at the tail → that speaker (or the 1:1 focus bot) is working. */
export function workingMemberNames(turns: ChatTurn[], focus: Agent, roster: Agent[]): string[] {
  const last = turns.at(-1);
  if (!last || last.role !== "tool") return [];
  if (!focus.isGroup) return [focusBotName(focus)];
  const live = roster.find((row) => row.id === focus.id) ?? focus;
  if (last.speakerId) {
    return [memberName(last.speakerId, live, roster)];
  }
  const name = last.speaker.trim();
  if (!name || name === "assistant" || name === "unknown" || TOOL_SPEAKER_KINDS.has(name)) {
    return [];
  }
  return [name];
}

/**
 * Transcript-fast answering / working names.
 * Pending @mention / 1:1 user reply, else a trailing tool/streaming marker.
 * Does not use roster isRunning — listAgents is too slow and a delayed
 * "X is answering…" feels worse than no indicator (match the app only when we can be timely).
 */
export function answeringMemberNames(focus: Agent, roster: Agent[], turns: ChatTurn[]): string[] {
  const pending = pendingReplyMemberNames(turns, focus, roster);
  if (pending.length > 0) return pending;
  return workingMemberNames(turns, focus, roster);
}
