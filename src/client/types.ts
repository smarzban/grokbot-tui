export type HostSource = "gateway" | "desktop" | "mock";

export type Agent = {
  id: string;
  name: string;
  title?: string;
  isGroup: boolean;
  isRunning?: boolean;
};

export const DEFAULT_TRANSCRIPT_LIMIT = 500;

export type ChatImage = {
  /** Filename or alt shown in the TUI. Never a token-bearing URL. */
  alt?: string;
  /** Local filesystem path when the host gave one in attachmentPaths. */
  path?: string;
  /** https URL from attachmentPaths. Do not print; may need session headers to fetch. */
  url?: string;
  mime?: string;
};

export type ChatTurn = {
  id: string;
  role: "user" | "assistant" | "system";
  speaker: string;
  text: string;
  timestampMs?: number;
  images?: ChatImage[];
};

export type SendStatus = "idle" | "awaiting-user" | "timeout" | "error" | "cancelled";

export type SendResult = {
  accepted: boolean;
  status: SendStatus;
  reply?: string;
  elapsedMs: number;
};

export type Health = {
  ok: boolean;
  busy?: boolean;
  activeAgentId?: string | null;
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
  health(): Promise<Health>;
  listAgents(): Promise<Agent[]>;
  getTranscript(agentId: string, limit?: number): Promise<ChatTurn[]>;
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

export function isHostClientError(err: unknown): err is HostClientError {
  return err instanceof HostClientError;
}
