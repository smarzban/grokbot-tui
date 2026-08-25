import { Box, Text, useApp, useInput, useStdout, useWindowSize } from "ink";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Agent, ChatTurn, HostClient } from "../client/types.js";
import { HostClientError } from "../client/types.js";
import { errorMessage } from "../redact.js";
import {
  adjustScrollOffset,
  applyScrollDelta,
  chromeRows,
  composeVisible,
  innerWidth,
  transcriptInnerHeight,
  turnsToRows,
  visibleTranscript,
} from "./layout.js";
import {
  consumeMouseInput,
  DISABLE_MOUSE,
  ENABLE_MOUSE,
  scrollDeltaForButton,
  WHEEL_LINE_DELTA,
} from "./mouse.js";
import { memberListLabel } from "./roster.js";
import { DEFAULT_POLL_MS, shouldPollTranscript, transcriptChanged } from "./poll.js";

type Props = {
  client: HostClient;
  agent: Agent;
  roster?: Agent[];
  timeoutMs?: number;
  pollMs?: number;
  onSwitch: () => void;
};

type Status =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "sending" }
  | { kind: "awaiting-user" }
  | { kind: "error"; message: string };

function headerStatus(status: Status, isGroup = false): string {
  switch (status.kind) {
    case "loading":
      return "loading";
    case "sending":
      return isGroup ? "sent" : "waiting";
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

export function Chat({
  client,
  agent,
  roster = [],
  timeoutMs,
  pollMs = DEFAULT_POLL_MS,
  onSwitch,
}: Props) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const { columns, rows } = useWindowSize();
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "loading" });
  const [scrollOffset, setScrollOffset] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const statusRef = useRef(status);
  statusRef.current = status;
  const agentId = agent.id;
  const displayName = agent.name.trim() || "agent";
  const isGroup = agent.isGroup === true;
  const labelCtx = useMemo(
    () => ({
      agentName: displayName,
      isGroup,
      members: agent.members,
      roster,
    }),
    [agent.members, displayName, isGroup, roster],
  );
  const headerMembers = memberListLabel(agent, roster);

  const { width, height } = termSize(columns, rows);
  const inner = innerWidth(width);
  const transcriptH = Math.max(3, height - chromeRows());
  const lineBudget = Math.max(1, transcriptInnerHeight(height) - (status.kind === "error" ? 1 : 0));
  const allRows = useMemo(
    () => turnsToRows(turns, inner, labelCtx),
    [turns, inner, labelCtx],
  );
  const rowCount = allRows.length;
  const prevRowCountRef = useRef(rowCount);

  const load = useCallback(async () => {
    setStatus({ kind: "loading" });
    setScrollOffset(0);
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

  useEffect(() => {
    stdout.write(ENABLE_MOUSE);
    return () => {
      stdout.write(DISABLE_MOUSE);
    };
  }, [stdout]);

  useEffect(() => {
    setScrollOffset((offset) =>
      adjustScrollOffset({
        offset,
        prevRowCount: prevRowCountRef.current,
        nextRowCount: rowCount,
        budget: lineBudget,
      }),
    );
    prevRowCountRef.current = rowCount;
  }, [rowCount, lineBudget]);

  useEffect(() => {
    if (!shouldPollTranscript(status.kind)) return;
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      if (!shouldPollTranscript(statusRef.current.kind)) return;
      try {
        const history = await client.getTranscript(agentId);
        if (cancelled) return;
        if (!shouldPollTranscript(statusRef.current.kind)) return;
        setTurns((prev) => (transcriptChanged(prev, history) ? history : prev));
      } catch {
        // Keep the last good transcript; a single failed poll is not an error overlay.
      }
    };
    const id = setInterval(() => {
      void tick();
    }, pollMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [agentId, client, pollMs, status.kind]);

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
      setScrollOffset(0);
      setStatus({ kind: "sending" });

      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const result = await client.sendPrompt({
          agentId,
          prompt,
          wait: !isGroup,
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
        setScrollOffset(0);
        if (isGroup) {
          setStatus({ kind: "idle" });
        } else if (result.status === "awaiting-user") {
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
    [agent.name, agentId, client, isGroup, timeoutMs],
  );

  const page = Math.max(1, Math.floor(lineBudget / 2));

  useInput((input, key) => {
    const current = statusRef.current;
    const { events } = consumeMouseInput(input);
    if (events.length > 0) {
      for (const event of events) {
        if (event.release) continue;
        const delta = scrollDeltaForButton(event.button);
        if (delta == null) continue;
        setScrollOffset((offset) => applyScrollDelta(offset, delta, rowCount, lineBudget));
      }
      return;
    }
    if (key.upArrow) {
      setScrollOffset((offset) => applyScrollDelta(offset, WHEEL_LINE_DELTA, rowCount, lineBudget));
      return;
    }
    if (key.downArrow) {
      setScrollOffset((offset) => applyScrollDelta(offset, -WHEEL_LINE_DELTA, rowCount, lineBudget));
      return;
    }
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
    if (key.pageUp || (key.ctrl && input === "u")) {
      setScrollOffset((offset) => applyScrollDelta(offset, page, rowCount, lineBudget));
      return;
    }
    if (key.pageDown || (key.ctrl && input === "d")) {
      setScrollOffset((offset) => applyScrollDelta(offset, -page, rowCount, lineBudget));
      return;
    }
    if (key.home) {
      setScrollOffset((offset) => applyScrollDelta(offset, Number.MAX_SAFE_INTEGER, rowCount, lineBudget));
      return;
    }
    if (key.end) {
      setScrollOffset(0);
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

  const view = useMemo(
    () => visibleTranscript(allRows, lineBudget, scrollOffset),
    [allRows, lineBudget, scrollOffset],
  );
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
        <Text wrap="truncate">
          <Text bold color="cyan">
            {displayName}
          </Text>
          {headerMembers ? (
            <Text dimColor>
              {"  "}
              {headerMembers}
            </Text>
          ) : null}
        </Text>
        <Text dimColor>{headerStatus(status, isGroup)}</Text>
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
              const isUser = row.align === "end";
              const color = isUser ? "cyan" : row.kind === "speaker" ? "green" : row.kind === "image" ? "yellow" : "white";
              return (
                <Text
                  key={`${row.kind}-${i}-${row.text.trimStart().slice(0, 16)}`}
                  bold={row.kind === "speaker"}
                  dimColor={row.kind === "image"}
                  color={color}
                  wrap="truncate"
                >
                  {row.text}
                </Text>
              );
            })}
            {view.moreBelow ? <Text dimColor>···</Text> : null}
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
            ? "wheel/PgUp/Dn scroll  ·  Esc cancel  ·  Ctrl+c quit"
            : "wheel/PgUp/Dn scroll  ·  Enter send  ·  Esc list  ·  Ctrl+c quit"}
        </Text>
      </Box>
    </Box>
  );
}
