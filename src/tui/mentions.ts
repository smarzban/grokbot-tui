import type { Agent } from "../client/types.js";

/** Last `@token` at the caret (end of draft). Requires a word boundary before `@`. */
export function mentionQuery(draft: string): { start: number; prefix: string } | null {
  if (!draft) return null;
  const at = draft.lastIndexOf("@");
  if (at < 0) return null;
  if (at > 0 && !/\s/.test(draft.charAt(at - 1))) return null;
  const prefix = draft.slice(at + 1);
  if (prefix.length > 0 && /\s/.test(prefix)) return null;
  return { start: at, prefix };
}

/** Display names for room members only. No Slack/@connector extras. */
export function mentionNames(agent: Agent, roster: Agent[] = []): string[] {
  if (!agent.isGroup) return [];
  const names: string[] = [];
  const push = (name: string) => {
    const trimmed = name.trim();
    if (trimmed && !names.includes(trimmed)) names.push(trimmed);
  };
  if (agent.members && agent.members.length > 0) {
    for (const member of agent.members) push(member.name);
  } else {
    for (const id of agent.memberIds ?? []) {
      const row = roster.find((item) => item.id === id);
      push(row?.name ?? id);
    }
  }
  return names;
}

export function filterMentions(names: string[], prefix: string): string[] {
  const needle = prefix.toLowerCase();
  return names.filter((name) => name.toLowerCase().startsWith(needle));
}

export function completeMention(draft: string, name: string): string {
  const query = mentionQuery(draft);
  if (!query) return draft;
  return `${draft.slice(0, query.start)}@${name} `;
}

export function mentionMenuOpen(matchCount: number, dismissed: boolean): boolean {
  return matchCount > 0 && !dismissed;
}

export function wrapMentionIndex(index: number, length: number, delta: number): number {
  if (length < 1) return 0;
  return (index + delta + length) % length;
}

export const MAX_VISIBLE_MENTIONS = 6;

export function visibleMentions(
  names: string[],
  index: number,
  budget = MAX_VISIBLE_MENTIONS,
): string[] {
  if (budget < 1 || names.length === 0) return [];
  if (names.length <= budget) return names;
  const selected = Math.min(Math.max(0, index), names.length - 1);
  const maxStart = names.length - budget;
  const start = Math.min(Math.max(0, selected - budget + 1), maxStart);
  return names.slice(start, start + budget);
}
