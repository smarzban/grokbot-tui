import { Box, Text, useApp, useInput, useWindowSize } from "ink";
import { useState } from "react";
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
  const [index, setIndex] = useState(0);
  const { width, height } = termSize(columns, rows);
  const listHeight = Math.max(3, height - 6);
  const innerList = Math.max(1, listHeight - 2);
  const inner = innerWidth(width);
  const items = pickerItems(agents);
  const allRows = pickerRows(agents);

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
      setIndex((current) => (current <= 0 ? items.length - 1 : current - 1));
      return;
    }
    if (key.downArrow || input === "j" || isCtrlKey(input, key, "n")) {
      setIndex((current) => (current >= items.length - 1 ? 0 : current + 1));
      return;
    }
    if (key.return || input === "\r" || input === "\n") {
      const agent = items[Math.min(index, items.length - 1)];
      if (agent) onSelect(agent);
    }
  });

  const safeIndex = items.length === 0 ? 0 : Math.min(index, items.length - 1);
  const selected = items[safeIndex];
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
