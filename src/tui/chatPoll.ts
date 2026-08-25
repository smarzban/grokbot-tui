import type { Agent, ChatTurn, HostClient } from "../client/types.js";
import { mergePolledTranscript, shouldPollTranscript } from "./poll.js";

export type PollChatSnapshot = {
  turns: ChatTurn[];
  roster: Agent[];
};

/** One idle poll cycle: transcript tail (when allowed) plus roster. */
export async function pollChatSnapshot(input: {
  client: HostClient;
  agentId: string;
  turns: ChatTurn[];
  statusKind: string;
}): Promise<PollChatSnapshot> {
  let turns = input.turns;
  if (shouldPollTranscript(input.statusKind)) {
    try {
      const history = await input.client.getTranscript(input.agentId);
      if (shouldPollTranscript(input.statusKind)) {
        turns = mergePolledTranscript(turns, history);
      }
    } catch {
      // Keep the last good transcript; a single failed poll is not an error overlay.
    }
  }

  let roster: Agent[] = [];
  try {
    roster = await input.client.listAgents();
  } catch {
    // Keep the last roster; a failed poll is not an error overlay.
  }

  return { turns, roster };
}
