import { Box, Text, useApp, useInput, useWindowSize } from "ink";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Agent, ChatTurn, HostClient } from "../client/types.js";
import { HostClientError } from "../client/types.js";
import { errorMessage } from "../redact.js";
import {
  chromeRows,
  composeVisible,
  innerWidth,
  transcriptInnerHeight,
  turnsToRows,
  visibleTranscript,
} from "./layout.js";

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

function headerStatus(status: Status): string {
  switch (status.kind) {
    case "loading":
      return "loading";
    case "sending":
      return "waiting";
    case "awaiting-user":
      return "your turn";
    case "error":
      return "error";
    default:
      return "idle";
  }
}

function termSize(columns: number, rows: number): { width: number; height: number } {
  return {
    width: Math.max(40, columns || 80),
    height: Math.max(12, rows || 24),
  };
}

export function Chat({ client, agent, timeoutMs, onSwitch }: Props) {
  const { exit } = useApp();
  const { columns, rows } = useWindowSize();
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "loading" });
  const abortRef = useRef<AbortController | null>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const statusRef = useRef(status);
  statusRef.current = status;
  const agentId = agent.id;
  const displayName = agent.name.trim() || "agent";

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

  const { width, height } = termSize(columns, rows);
  const inner = innerWidth(width);
  const transcriptH = Math.max(3, height - chromeRows());
  const lineBudget = Math.max(1, transcriptInnerHeight(height) - (status.kind === "error" ? 1 : 0));
  const allRows = useMemo(() => turnsToRows(turns, Math.max(8, inner - 2)), [turns, inner]);
  const view = useMemo(() => visibleTranscript(allRows, lineBudget), [allRows, lineBudget]);
  const composed = composeVisible(draft, inner);
  const canType = status.kind !== "sending" && status.kind !== "loading";
  const busy = status.kind === "sending";

  return (
    <Box flexDirection="column" width={width} height={height} overflow="hidden">
      <Box
        borderStyle="single"
        borderColor="cyan"
        paddingX={1}
        height={3}
        overflow="hidden"
        justifyContent="space-between"
      >
        <Text bold color="cyan">
          {displayName}
        </Text>
        <Text dimColor>{headerStatus(status)}</Text>
      </Box>

      <Box
        flexDirection="column"
        borderStyle="single"
        borderColor="gray"
        paddingX={1}
        height={transcriptH}
        overflow="hidden"
      >
        {status.kind === "error" ? <Text color="red">{status.message}</Text> : null}
        {view.rows.length === 0 && status.kind !== "error" ? (
          <Text dimColor>
            {status.kind === "loading" ? "Loading…" : "No messages yet. Type below and press Enter."}
          </Text>
        ) : (
          <>
            {view.clipped ? <Text dimColor>···</Text> : null}
            {view.rows.map((row, i) => {
              if (row.kind === "empty") {
                return <Text key={`e-${i}`}> </Text>;
              }
              const color = row.role === "user" ? "cyan" : row.kind === "speaker" ? "green" : "white";
              const text = row.kind === "body" ? `  ${row.text}` : row.text;
              return (
                <Text
                  key={`${row.kind}-${i}-${row.text.slice(0, 16)}`}
                  bold={row.kind === "speaker"}
                  color={color}
                  wrap="truncate"
                >
                  {text}
                </Text>
              );
            })}
          </>
        )}
      </Box>

      <Box
        borderStyle="single"
        borderColor={busy ? "yellow" : "cyan"}
        paddingX={1}
        height={3}
        overflow="hidden"
      >
        {draft.length === 0 ? (
          <Text>
            {canType ? <Text inverse> </Text> : <Text dimColor> </Text>}
            <Text dimColor>{busy ? "waiting…" : "message"}</Text>
          </Text>
        ) : (
          <Text>
            {composed.prefix}
            {canType ? <Text inverse> </Text> : null}
          </Text>
        )}
      </Box>

      <Box height={1} overflow="hidden" paddingX={1}>
        <Text dimColor>
          {busy
            ? "Esc cancel  ·  Ctrl+b switch  ·  Ctrl+c quit"
            : "Enter send  ·  Esc bots  ·  Ctrl+b switch  ·  Ctrl+c quit"}
        </Text>
      </Box>
    </Box>
  );
}
