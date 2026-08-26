import { Box, Text, useApp, useInput, useWindowSize } from "ink";
import { useRef, useState } from "react";
import type { Agent } from "../client/types.js";
import { isCtrlKey } from "./keys.js";
import { agentLabel, innerWidth } from "./layout.js";
import { pickerItems, pickerRows, visiblePickerRows } from "./roster.js";

type Props = {
  agents: Agent[];
  refreshing?: boolean;
  onSelect: (agent: Agent) => void;
  onRefresh: () => void;
};

function termSize(columns: number, rows: number): { width: number; height: number } {
  return {
    width: Math.max(40, columns || 80),
    height: Math.max(12, rows || 24),
  };
}

export function Picker({ agents, refreshing = false, onSelect, onRefresh }: Props) {
  const { exit } = useApp();
  const { columns, rows } = useWindowSize();
  /** Anchor selection by agent id so roster refresh does not shift Enter's target. */
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const lastIndexRef = useRef(0);
  const { width, height } = termSize(columns, rows);
  const listHeight = Math.max(3, height - 6);
  const innerList = Math.max(1, listHeight - 2);
  const inner = innerWidth(width);
  const items = pickerItems(agents);
  const allRows = pickerRows(agents);
  const indexFromId = selectedId ? items.findIndex((agent) => agent.id === selectedId) : -1;
  const safeIndex =
    items.length === 0
      ? 0
      : indexFromId >= 0
        ? indexFromId
        : Math.min(lastIndexRef.current, items.length - 1);
  lastIndexRef.current = safeIndex;
  const selected = items[safeIndex];

  useInput((input, key) => {
    if (isCtrlKey(input, key, "c")) {
      exit();
      return;
    }
    if (input === "q" || key.escape) {
      exit();
      return;
    }
    if (input === "r") {
      onRefresh();
      return;
    }
    if (items.length === 0) return;
    if (key.upArrow || input === "k" || isCtrlKey(input, key, "p")) {
      const next = safeIndex <= 0 ? items.length - 1 : safeIndex - 1;
      setSelectedId(items[next]?.id);
      return;
    }
    if (key.downArrow || input === "j" || isCtrlKey(input, key, "n")) {
      const next = safeIndex >= items.length - 1 ? 0 : safeIndex + 1;
      setSelectedId(items[next]?.id);
      return;
    }
    if (key.return || input === "\r" || input === "\n") {
      if (selected) onSelect(selected);
    }
  });

  const visible = visiblePickerRows(allRows, selected?.id, innerList);

  return (
    <Box flexDirection="column" width={width} height={height} overflow="hidden">
      <Box borderStyle="round" borderColor="cyan" paddingX={1} height={3} overflow="hidden">
        <Text bold color="cyan">
          Pick a bot or channel
        </Text>
      </Box>
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor="gray"
        paddingX={1}
        height={listHeight}
        overflow="hidden"
      >
        {items.length === 0 ? (
          <Text color="yellow">No bots or channels on this host. Create one in the Grok Bot app, then press r.</Text>
        ) : (
          visible.map((row, i) => {
            if (row.kind === "heading") {
              return (
                <Text key={`h-${row.title}`} dimColor>
                  {row.title}
                </Text>
              );
            }
            if (row.kind === "spacer") {
              return <Text key={`spacer-${i}`}> </Text>;
            }
            const isSelected = row.agent.id === selected?.id;
            const name = agentLabel(row.agent, agents).slice(0, Math.max(1, inner - 2));
            return (
              <Text key={row.agent.id} inverse={isSelected}>
                {isSelected ? "› " : "  "}
                {name}
              </Text>
            );
          })
        )}
      </Box>
      <Box borderStyle="round" borderColor="gray" paddingX={1} height={3} overflow="hidden">
        <Text dimColor>
          {refreshing
            ? "Refreshing roster…"
            : "↑↓ / j k move  ·  Enter open  ·  r refresh  ·  q quit"}
        </Text>
      </Box>
    </Box>
  );
}
