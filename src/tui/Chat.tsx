import { Box, Text, useApp, useInput, useStdout } from "ink";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Agent, ChatTurn, HostClient } from "../client/types.js";
import { HostClientError } from "../client/types.js";
import { errorMessage } from "../redact.js";

type Props = {
  client: HostClient;
  agent: Agent;
  timeoutMs?: number;
  onSwitch: () => void;
};

type Status =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "sending" }
  | { kind: "awaiting-user" }
  | { kind: "error"; message: string };

function visibleTurns(turns: ChatTurn[], maxLines: number): ChatTurn[] {
  if (turns.length <= maxLines) return turns;
  return turns.slice(turns.length - maxLines);
}

export function Chat({ client, agent, timeoutMs, onSwitch }: Props) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "loading" });
  const abortRef = useRef<AbortController | null>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const statusRef = useRef(status);
  statusRef.current = status;
  const agentId = agent.id;

  const load = useCallback(async () => {
    setStatus({ kind: "loading" });
    try {
      const history = await client.getTranscript(agentId);
      setTurns(history);
      setStatus({ kind: "idle" });
    } catch (err) {
      const message = err instanceof HostClientError ? err.message : errorMessage(err);
      setStatus({ kind: "error", message });
    }
  }, [client, agentId]);

  useEffect(() => {
    void load();
    return () => {
      abortRef.current?.abort();
    };
  }, [load]);

  const send = useCallback(
    async (text: string) => {
      const prompt = text.trim();
      if (!prompt || statusRef.current.kind === "sending") return;

      const optimistic: ChatTurn = {
        id: `local-${Date.now()}`,
        role: "user",
        speaker: "you",
        text: prompt,
        timestampMs: Date.now(),
      };
      setTurns((current) => [...current, optimistic]);
      setDraft("");
      setStatus({ kind: "sending" });

      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const result = await client.sendPrompt({
          agentId,
          prompt,
          wait: true,
          timeoutMs,
          signal: controller.signal,
        });
        if (result.status === "cancelled") {
          setStatus({ kind: "idle" });
          return;
        }
        const history = await client.getTranscript(agentId);
        if (history.length > 0) {
          setTurns(history);
        } else if (result.reply) {
          setTurns([
            optimistic,
            {
              id: `reply-${Date.now()}`,
              role: "assistant",
              speaker: agent.name,
              text: result.reply,
              timestampMs: Date.now(),
            },
          ]);
        }
        if (result.status === "awaiting-user") {
          setStatus({ kind: "awaiting-user" });
        } else if (result.status === "timeout") {
          setStatus({ kind: "error", message: "Timed out waiting for a reply. Esc cancels; try again." });
        } else if (result.status === "error") {
          setStatus({ kind: "error", message: "The host accepted the prompt but did not finish." });
        } else {
          setStatus({ kind: "idle" });
        }
      } catch (err) {
        const message = err instanceof HostClientError ? err.message : errorMessage(err);
        setStatus({ kind: "error", message });
      } finally {
        abortRef.current = null;
      }
    },
    [agent.name, agentId, client, timeoutMs],
  );

  useInput((input, key) => {
    const current = statusRef.current;
    if (key.escape) {
      if (current.kind === "sending") {
        abortRef.current?.abort();
        void client.interrupt(agentId).catch(() => undefined);
        return;
      }
      onSwitch();
      return;
    }
    if (key.ctrl && input === "b") {
      if (current.kind === "sending") {
        abortRef.current?.abort();
        void client.interrupt(agentId).catch(() => undefined);
      }
      onSwitch();
      return;
    }
    if (key.ctrl && input === "c") {
      exit();
      return;
    }
    if (current.kind === "sending" || current.kind === "loading") {
      return;
    }
    if (key.return) {
      void send(draftRef.current);
      return;
    }
    if (key.backspace || key.delete) {
      setDraft((value) => value.slice(0, -1));
      return;
    }
    if (key.ctrl || key.meta) return;
    if (input) setDraft((value) => value + input);
  });

  const rows = stdout?.rows;
  const cols = stdout?.columns;
  const transcriptBudget = Math.max(4, (rows ?? 24) - 10);
  const shown = useMemo(() => visibleTurns(turns, transcriptBudget), [turns, transcriptBudget]);

  const statusLine =
    status.kind === "loading"
      ? "Loading transcript…"
      : status.kind === "sending"
        ? "Waiting for reply…  Esc cancel"
        : status.kind === "awaiting-user"
          ? "Agent is waiting for you (card/question in the desktop app)."
          : status.kind === "error"
            ? status.message
            : turns.length === 0
              ? "No messages yet. Type below and press Enter."
              : "";

  return (
    <Box flexDirection="column" {...(rows ? { height: rows } : {})} {...(cols ? { width: cols } : {})}>
      <Box paddingX={1} borderStyle="single" borderColor="cyan">
        <Text>
          <Text bold color="cyan">
            {agent.name}
          </Text>
          <Text dimColor>
            {"  "}
            {agent.id}  ·  {client.source}
          </Text>
        </Text>
      </Box>

      <Box flexGrow={1} flexDirection="column" paddingX={1} overflow="hidden">
        {shown.map((turn) => (
          <Box key={turn.id} flexDirection="column" marginBottom={1}>
            <Text color={turn.role === "user" ? "cyan" : "green"} bold>
              {turn.role === "user" ? "you" : turn.speaker}
            </Text>
            <Text wrap="wrap">{turn.text}</Text>
          </Box>
        ))}
        {statusLine ? (
          <Text color={status.kind === "error" ? "red" : "yellow"} dimColor={status.kind !== "error"}>
            {statusLine}
          </Text>
        ) : null}
      </Box>

      <Box paddingX={1} borderStyle="single" borderColor={status.kind === "sending" ? "yellow" : "gray"}>
        <Text color="cyan">{"> "}</Text>
        <Text>
          {draft}
          {status.kind !== "sending" && status.kind !== "loading" ? <Text inverse> </Text> : null}
        </Text>
      </Box>
      <Box paddingX={1}>
        <Text dimColor>
          enter send  esc {status.kind === "sending" ? "cancel" : "bots"}  ctrl+b switch  ctrl+c quit
        </Text>
      </Box>
    </Box>
  );
}
