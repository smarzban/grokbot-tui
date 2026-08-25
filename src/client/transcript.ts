import {
  entriesFromTranscriptPayload,
  turnsFromTranscriptEntries,
} from "@adam91holt/grokbot-sdk";
import type { ChatTurn } from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

export function unwrapAgentList(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (isRecord(raw)) {
    if (Array.isArray(raw.agents)) return raw.agents;
    if (Array.isArray(raw.result)) return raw.result;
  }
  return [];
}

export function asAgentRow(value: unknown): {
  id: string;
  name: string;
  title?: string;
  isGroup: boolean;
  isRunning?: boolean;
} | null {
  if (!isRecord(value)) return null;
  const id = typeof value.id === "string" ? value.id : typeof value.agentId === "string" ? value.agentId : "";
  if (!id) return null;
  const name = typeof value.name === "string" && value.name.length > 0 ? value.name : id;
  const title = typeof value.title === "string" && value.title.length > 0 ? value.title : undefined;
  const memberIds = value.memberIds ?? value.memberAgentIds;
  const isGroup =
    value.isGroup === true || (value.isGroup == null && Array.isArray(memberIds) && memberIds.length > 0);
  const isRunning = typeof value.isRunning === "boolean" ? value.isRunning : undefined;
  return { id, name, ...(title ? { title } : {}), isGroup, ...(isRunning !== undefined ? { isRunning } : {}) };
}

export function turnsFromHostTranscript(payload: unknown): ChatTurn[] {
  const entries = entriesFromTranscriptPayload(payload);
  return turnsFromTranscriptEntries(entries).map((turn, index) => {
    const role: ChatTurn["role"] =
      turn.speaker === "user" || turn.kind === "user" ? "user" : "assistant";
    const id = `${turn.timestampMs ?? "t"}-${index}-${turn.speaker}`;
    return {
      id,
      role,
      speaker: turn.speaker,
      text: turn.text,
      ...(turn.timestampMs != null ? { timestampMs: turn.timestampMs } : {}),
    };
  });
}
