import type { Agent, ChatTurn, HostClient } from "../client/types.js";
import { shouldPollTranscript } from "./poll.js";

export type PollChatSnapshot = {
  /** Host tail when the transcript fetch succeeded. */
  history?: ChatTurn[];
  transcriptFetched: boolean;
  /** Roster rows when listAgents succeeded. */
  roster?: Agent[];
  rosterFetched: boolean;
};

/** True when this poll did not race with a local transcript update. */
export function shouldApplyPollTranscript(input: {
  snapshot: PollChatSnapshot;
  statusAtStart: string;
  statusNow: string;
  transcriptRevisionAtStart: number;
  transcriptRevisionNow: number;
}): boolean {
  return (
    input.snapshot.transcriptFetched &&
    input.snapshot.history != null &&
    input.transcriptRevisionAtStart === input.transcriptRevisionNow &&
    shouldPollTranscript(input.statusAtStart) &&
    shouldPollTranscript(input.statusNow)
  );
}

/** One idle poll cycle: transcript tail (when allowed) plus roster. */
export async function pollChatSnapshot(input: {
  client: HostClient;
  agentId: string;
  statusKind: string;
}): Promise<PollChatSnapshot> {
  let history: ChatTurn[] | undefined;
  let transcriptFetched = false;

  if (shouldPollTranscript(input.statusKind)) {
    try {
      const fetched = await input.client.getTranscript(input.agentId);
      if (shouldPollTranscript(input.statusKind)) {
        history = fetched;
        transcriptFetched = true;
      }
    } catch {
      // Keep the last good transcript; a single failed poll is not an error overlay.
    }
  }

  let roster: Agent[] | undefined;
  let rosterFetched = false;
  try {
    roster = await input.client.listAgents();
    rosterFetched = true;
  } catch {
    // Keep the last roster; a single failed poll is not an error overlay.
  }

  return {
    ...(history != null ? { history } : {}),
    transcriptFetched,
    ...(roster != null ? { roster } : {}),
    rosterFetched,
  };
}
