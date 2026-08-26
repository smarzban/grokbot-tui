export type HostSource = "gateway" | "desktop" | "mock";

export type AgentMember = {
  id: string;
  name: string;
};

export type Agent = {
  id: string;
  name: string;
  title?: string;
  isGroup: boolean;
  isRunning?: boolean;
  /** Host `isComposingMessage` — treated as busy the same way as isRunning. */
  isComposingMessage?: boolean;
  /** Host `memberIds` / `memberAgentIds`. Empty for 1:1 bots. */
  memberIds?: string[];
  /** Names from host `remoteMembers` or resolved against the bot roster. */
  members?: AgentMember[];
};

export const DEFAULT_TRANSCRIPT_LIMIT = 500;
/** Poll only needs the recent tail for sync; keep gateway payloads small. */
export const POLL_TRANSCRIPT_LIMIT = 100;

export type GetTranscriptOptions = {
  /** When false, return wire turns immediately and skip attachment downloads. */
  hydrate?: boolean;
};

/**
 * Image on a chat turn. Fields fill in stages:
 * 1. Wire — host `file_path` / `url` / `fileName` / alt (may be box paths missing on Mac)
 * 2. Local — `path` set after hydrate or a pasted disk file Kitty can paint
 * 3. Placeholder — alt/fileName only when no bytes are available
 * Keep optional fields; do not invent a parallel type per stage until room UX needs it.
 */
export type ChatImage = {
  /** Filename or alt shown in the TUI. Never a token-bearing URL. */
  alt?: string;
  /** Host `fileName` / `file_name` when the entry carried one (may match `alt`). */
  fileName?: string;
  /**
   * Local filesystem path Kitty can paint: an existing file, or a temp file
   * we cached after `readAttachmentImage`.
   */
  path?: string;
  /**
   * Host-internal path from `file_path`. Often `/home/box/sand-data/...` and
   * missing on the Mac disk — used as `readAttachmentImage({ path })`.
   */
  file_path?: string;
  /** `file://` or `https://` from the entry. Do not print; never send file:// as `path`. */
  url?: string;
  mime?: string;
  width?: number;
  height?: number;
  /** Host store / transcript entry id when the row carried `id` or `entryId`. */
  entryId?: string;
  /** Host message/attachment `id` when distinct from the entry id. */
  id?: string;
  /** Host `attachmentNames` as sent on sendPrompt / the entry. */
  attachmentNames?: string[];
  /** Host `attachmentPaths` (local or https). Do not print https values. */
  attachmentPaths?: string[];
};

export type ChatTurn = {
  id: string;
  role: "user" | "assistant" | "system";
  speaker: string;
  /** Host author / fromAgent id when the transcript row carried one. */
  speakerId?: string;
  text: string;
  timestampMs?: number;
  images?: ChatImage[];
};

export type SendStatus = "idle" | "timeout" | "cancelled";

export type SendResult = {
  /** Host `accepted` on sendPrompt (defaults true when omitted). */
  accepted: boolean;
  status: SendStatus;
  reply?: string;
  /** Wall time for the send+wait call; unused by the TUI today. */
  elapsedMs: number;
};

export type SendPromptInput = {
  agentId: string;
  prompt: string;
  wait?: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
};

/**
 * All live-host I/O goes through this interface so tests can inject a mock.
 * Implementations must never log gateway tokens or raw token-bearing payloads.
 */
export interface HostClient {
  readonly source: HostSource;
  listAgents(): Promise<Agent[]>;
  getTranscript(agentId: string, limit?: number, options?: GetTranscriptOptions): Promise<ChatTurn[]>;
  /** Fill local image paths for turns fetched with hydrate: false. */
  hydrateTranscript(agentId: string, turns: ChatTurn[]): Promise<ChatTurn[]>;
  sendPrompt(input: SendPromptInput): Promise<SendResult>;
  interrupt(agentId: string): Promise<{ hadActiveRun: boolean }>;
}

export type HostErrorKind = "missing-auth" | "host-down" | "unauthorized" | "unknown";

export class HostClientError extends Error {
  readonly kind: HostErrorKind;
  readonly status?: number;

  constructor(kind: HostErrorKind, message: string, options?: { status?: number }) {
    super(message);
    this.name = "HostClientError";
    this.kind = kind;
    if (options?.status != null) this.status = options.status;
  }
}
