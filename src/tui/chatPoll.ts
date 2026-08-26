import { POLL_TRANSCRIPT_LIMIT, type Agent, type ChatTurn, type HostClient } from "../client/types.js";
import { shouldPollTranscript } from "./poll.js";

export type TranscriptPollSnapshot = {
  history?: ChatTurn[];
  transcriptFetched: boolean;
};

export type RosterPollSnapshot = {
  roster?: Agent[];
  rosterFetched: boolean;
};

/** @deprecated Use pollTranscriptSnapshot / pollRosterSnapshot separately. */
export type PollChatSnapshot = TranscriptPollSnapshot & RosterPollSnapshot;

/** True when this poll did not race with a local transcript update. */
export function shouldApplyPollTranscript(input: {
  snapshot: TranscriptPollSnapshot;
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

/** Fetch the recent transcript tail for sync. Skips image hydrate. */
export async function pollTranscriptSnapshot(input: {
  client: HostClient;
  agentId: string;
  statusKind: string;
}): Promise<TranscriptPollSnapshot> {
  if (!shouldPollTranscript(input.statusKind)) {
    return { transcriptFetched: false };
  }
  try {
    const fetched = await input.client.getTranscript(input.agentId, POLL_TRANSCRIPT_LIMIT, {
      hydrate: false,
    });
    if (!shouldPollTranscript(input.statusKind)) {
      return { transcriptFetched: false };
    }
    return { history: fetched, transcriptFetched: true };
  } catch {
    return { transcriptFetched: false };
  }
}

/** Fetch roster for isRunning / answering indicator. Slow on the gateway — call sparingly. */
export async function pollRosterSnapshot(input: { client: HostClient }): Promise<RosterPollSnapshot> {
  try {
    const roster = await input.client.listAgents();
    return { roster, rosterFetched: true };
  } catch {
    return { rosterFetched: false };
  }
}

/** One combined poll cycle (tests only — Chat uses separate cadences). */
export async function pollChatSnapshot(input: {
  client: HostClient;
  agentId: string;
  statusKind: string;
}): Promise<PollChatSnapshot> {
  const transcript = await pollTranscriptSnapshot(input);
  const roster = await pollRosterSnapshot({ client: input.client });
  return { ...transcript, ...roster };
}
