import { Box, Text, useApp, useInput, useStdout, useWindowSize } from "ink";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Agent, ChatTurn, HostClient } from "../client/types.js";
import { HostClientError } from "../client/types.js";
import { errorMessage } from "../redact.js";
import {
  composeInnerHeight,
  FOOTER_HINT,
  handleComposeKey,
  insertAt,
  layoutCompose,
  splitLineAtCaret,
  visibleComposeWindow,
} from "./compose.js";
import {
  adjustScrollOffset,
  applyScrollDelta,
  chromeRows,
  innerWidth,
  isFullPictureRun,
  transcriptInnerHeight,
  turnsToRows,
  visibleTranscript,
  type TranscriptRow,
} from "./layout.js";
import { IMAGE_CELL_ROWS, imagePlaceholder } from "./images.js";
import { Picture } from "./Picture.js";
import {
  consumeMouseInput,
  DISABLE_MOUSE,
  ENABLE_MOUSE,
  scrollDeltaForButton,
  WHEEL_LINE_DELTA,
} from "./mouse.js";
import {
  completeMention,
  filterMentions,
  MAX_VISIBLE_MENTIONS,
  mentionMenuOpen,
  mentionNames,
  mentionQuery,
  visibleMentions,
  wrapMentionIndex,
} from "./mentions.js";
import { isCtrlKey } from "./keys.js";
import { answeringIndicator, busyMemberNames, busyNamesSignature, memberListLabel } from "./roster.js";
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

type Draft = { text: string; caret: number };

const EMPTY_DRAFT: Draft = { text: "", caret: 0 };

/** Ink 7 has no TextInput that can share alt-screen + a mention overlay; own the caret. */

function printableChunk(input: string): string {
  let out = "";
  for (const ch of input) {
    if (ch === "\n" || ch >= " ") out += ch;
  }
  return out;
}

function headerStatus(status: Status, isGroup = false, answering = false): string {
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
      return answering ? "answering" : "idle";
  }
}

function termSize(columns: number, rows: number): { width: number; height: number } {
  return {
    width: Math.max(40, columns || 80),
    height: Math.max(12, rows || 24),
  };
}

function clippedPictureLabel(row: TranscriptRow, firstVisible: boolean): string {
  if (!firstVisible) return " ";
  const text = row.text.trim();
  if (text) return row.text;
  return imagePlaceholder(row.image ?? {});
}

function renderTranscriptRows(rows: TranscriptRow[], inner: number): ReactNode[] {
  const out: React.ReactNode[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    if (row.kind === "picture" && isFullPictureRun(rows, i)) {
      out.push(<Picture key={row.pictureId ?? `pic-${i}`} row={row} inner={inner} />);
      i += IMAGE_CELL_ROWS - 1;
      continue;
    }
    if (row.kind === "picture") {
      const firstVisible = i === 0 || rows[i - 1]?.pictureId !== row.pictureId;
      out.push(
        <Text key={`p-${row.pictureId ?? i}-${i}`} dimColor color="yellow" wrap="truncate">
          {clippedPictureLabel(row, firstVisible)}
        </Text>,
      );
      continue;
    }
    if (row.kind === "empty") {
      out.push(<Text key={`e-${i}`}> </Text>);
      continue;
    }
    const isUser = row.align === "end";
    const color = isUser ? "cyan" : row.kind === "speaker" ? "green" : row.kind === "image" ? "yellow" : "white";
    out.push(
      <Text
        key={`${row.kind}-${i}-${row.text.trimStart().slice(0, 16)}`}
        bold={row.kind === "speaker"}
        dimColor={row.kind === "image"}
        color={color}
        wrap="truncate"
      >
        {row.text}
      </Text>,
    );
  }
  return out;
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
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [status, setStatus] = useState<Status>({ kind: "loading" });
  const [scrollOffset, setScrollOffset] = useState(0);
  const [liveRoster, setLiveRoster] = useState(roster);
  const [answeringLine, setAnsweringLine] = useState<string | null>(() =>
    answeringIndicator(busyMemberNames(agent, roster)),
  );
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionDismissed, setMentionDismissed] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const statusRef = useRef(status);
  statusRef.current = status;
  const agentRef = useRef(agent);
  agentRef.current = agent;
  const busySigRef = useRef(busyNamesSignature(busyMemberNames(agent, roster)));
  const agentId = agent.id;
  const liveAgent = liveRoster.find((row) => row.id === agentId) ?? agent;
  const displayName = liveAgent.name.trim() || "agent";
  const isGroup = liveAgent.isGroup === true;
  const labelCtx = useMemo(
    () => ({
      agentName: displayName,
      isGroup,
      members: liveAgent.members,
      roster: liveRoster,
    }),
    [displayName, isGroup, liveAgent.members, liveRoster],
  );
  const headerMembers = memberListLabel(liveAgent, liveRoster);
  const mentionOptions = useMemo(
    () => (isGroup ? mentionNames(liveAgent, liveRoster) : []),
    [isGroup, liveAgent, liveRoster],
  );
  const mentionQ = isGroup ? mentionQuery(draft.text, draft.caret) : null;
  const mentionMatches = mentionQ ? filterMentions(mentionOptions, mentionQ.prefix) : [];
  const mentionQueryKey = mentionQ ? `${mentionQ.start}:${mentionQ.prefix}` : "";
  const menuOpen = mentionMenuOpen(mentionMatches.length, mentionDismissed);
  const mentionShown = menuOpen ? visibleMentions(mentionMatches, mentionIndex) : [];

  const { width, height } = termSize(columns, rows);
  const inner = innerWidth(width);
  const composeLaid = layoutCompose(draft.text, draft.caret, inner);
  const composeInner = composeInnerHeight(composeLaid.lines.length);
  const composeView = visibleComposeWindow(composeLaid.lines, composeLaid.line, composeInner);
  const transcriptH = Math.max(3, height - chromeRows(composeInner));
  const lineBudget = Math.max(
    1,
    transcriptInnerHeight(height, composeInner) -
      (status.kind === "error" ? 1 : 0) -
      (answeringLine ? 1 : 0) -
      (menuOpen ? Math.min(mentionMatches.length, MAX_VISIBLE_MENTIONS) : 0),
  );
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
    setLiveRoster(roster);
    const names = busyMemberNames(agent, roster);
    busySigRef.current = busyNamesSignature(names);
    setAnsweringLine(answeringIndicator(names));
  }, [agent, roster]);

  useEffect(() => {
    setMentionDismissed(false);
    setMentionIndex(0);
  }, [mentionQueryKey]);

  useEffect(() => {
    if (status.kind === "loading") return;
    let cancelled = false;
    const applyRoster = (nextRoster: Agent[]) => {
      const names = busyMemberNames(agentRef.current, nextRoster);
      const sig = busyNamesSignature(names);
      if (sig === busySigRef.current) return;
      busySigRef.current = sig;
      setAnsweringLine(answeringIndicator(names));
      setLiveRoster(nextRoster);
    };
    const tick = async () => {
      if (cancelled) return;
      if (shouldPollTranscript(statusRef.current.kind)) {
        try {
          const history = await client.getTranscript(agentId);
          if (cancelled) return;
          if (shouldPollTranscript(statusRef.current.kind)) {
            setTurns((prev) => (transcriptChanged(prev, history) ? history : prev));
          }
        } catch {
          // Keep the last good transcript; a single failed poll is not an error overlay.
        }
      }
      if (cancelled) return;
      try {
        const nextRoster = await client.listAgents();
        if (cancelled) return;
        applyRoster(nextRoster);
      } catch {
        // Keep the last answering line; a failed roster poll is not an error overlay.
      }
    };
    void tick();
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
      setDraft(EMPTY_DRAFT);
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
    if (isCtrlKey(input, key, "c")) {
      exit();
      return;
    }
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
    if (menuOpen) {
      if (key.escape) {
        setMentionDismissed(true);
        return;
      }
      if (key.upArrow) {
        setMentionIndex((index) => wrapMentionIndex(index, mentionMatches.length, -1));
        return;
      }
      if (key.downArrow) {
        setMentionIndex((index) => wrapMentionIndex(index, mentionMatches.length, 1));
        return;
      }
      if (key.tab || (key.return && !key.shift)) {
        const pick =
          mentionMatches.length === 1 ? mentionMatches[0] : mentionMatches[mentionIndex] ?? mentionMatches[0];
        if (pick) setDraft((value) => completeMention(value.text, pick, value.caret));
        return;
      }
    }
    if (key.tab) return;
    if (key.escape) {
      if (current.kind === "sending") {
        abortRef.current?.abort();
        void client.interrupt(agentId).catch(() => undefined);
        return;
      }
      onSwitch();
      return;
    }
    if (isCtrlKey(input, key, "b")) {
      if (current.kind === "sending") {
        abortRef.current?.abort();
        void client.interrupt(agentId).catch(() => undefined);
      }
      onSwitch();
      return;
    }
    if (key.pageUp || isCtrlKey(input, key, "u")) {
      setScrollOffset((offset) => applyScrollDelta(offset, page, rowCount, lineBudget));
      return;
    }
    if (key.pageDown || isCtrlKey(input, key, "d")) {
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
    const cmd = handleComposeKey(key, draftRef.current, inner, input);
    if (cmd.type === "scrollTranscript") {
      const delta = cmd.dir === "up" ? WHEEL_LINE_DELTA : -WHEEL_LINE_DELTA;
      setScrollOffset((offset) => applyScrollDelta(offset, delta, rowCount, lineBudget));
      return;
    }
    if (cmd.type === "set") {
      const busyEdit = current.kind === "sending" || current.kind === "loading";
      if (busyEdit && cmd.draft.text !== draftRef.current.text) return;
      setDraft(cmd.draft);
      return;
    }
    if (cmd.type === "send") {
      if (current.kind === "sending" || current.kind === "loading") return;
      void send(draftRef.current.text);
      return;
    }
    if (isCtrlKey(input, key, "a")) {
      setDraft((value) => ({ text: value.text, caret: 0 }));
      return;
    }
    if (isCtrlKey(input, key, "e")) {
      setDraft((value) => ({ text: value.text, caret: value.text.length }));
      return;
    }
    if (current.kind === "sending" || current.kind === "loading") {
      return;
    }
    if (key.ctrl || key.meta || key.super) return;
    const chunk = printableChunk(input);
    if (chunk) setDraft((value) => insertAt(value.text, value.caret, chunk));
  });

  const view = useMemo(
    () => visibleTranscript(allRows, lineBudget, scrollOffset),
    [allRows, lineBudget, scrollOffset],
  );
  const canType = status.kind !== "sending" && status.kind !== "loading";
  const busy = status.kind === "sending";
  const composePlaceholder = draft.text.length === 0 ? (busy ? "waiting…" : "message") : null;

  return (
    <Box flexDirection="column" width={width} height={height} overflow="hidden">
      <Box
        borderStyle="round"
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
        <Text dimColor>{headerStatus(status, isGroup, answeringLine != null)}</Text>
      </Box>

      <Box
        flexDirection="column"
        borderStyle="round"
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
            {renderTranscriptRows(view.rows, inner)}
            {view.moreBelow ? <Text dimColor>···</Text> : null}
          </>
        )}
        {answeringLine ? (
          <Text color="yellow" dimColor wrap="truncate">
            {answeringLine}
          </Text>
        ) : null}
        {menuOpen
          ? mentionShown.map((name) => {
              const selected = name === mentionMatches[mentionIndex];
              return (
                <Text key={name} inverse={selected} color={selected ? undefined : "yellow"} wrap="truncate">
                  {selected ? "› @" : "  @"}
                  {name}
                </Text>
              );
            })
          : null}
      </Box>

      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={busy ? "yellow" : "cyan"}
        paddingX={1}
        height={composeInner + 2}
        overflow="hidden"
      >
        {composeView.lines.map((line, i) => {
          const onCaret = i === composeView.line;
          if (!onCaret) {
            return (
              <Text key={`c-${i}`} wrap="truncate">
                {line.length === 0 ? " " : line}
              </Text>
            );
          }
          const cell = splitLineAtCaret(line, composeLaid.col);
          return (
            <Text key={`c-${i}`} wrap="truncate">
              {cell.before}
              {canType ? <Text inverse>{cell.cell}</Text> : <Text dimColor>{cell.cell}</Text>}
              {cell.after}
              {composePlaceholder ? <Text dimColor>{composePlaceholder}</Text> : null}
            </Text>
          );
        })}
      </Box>

      <Box height={1} overflow="hidden" paddingX={1}>
        <Text dimColor>{FOOTER_HINT}</Text>
      </Box>
    </Box>
  );
}
