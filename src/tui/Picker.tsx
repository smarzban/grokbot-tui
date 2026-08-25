import { Box, Text, useApp, useInput, useWindowSize } from "ink";
import { useState } from "react";
import type { Agent } from "../client/types.js";
import { agentLabel, innerWidth } from "./layout.js";

type Props = {
  agents: Agent[];
  onSelect: (agent: Agent) => void;
  onRefresh: () => void;
};

function termSize(columns: number, rows: number): { width: number; height: number } {
  return {
    width: Math.max(40, columns || 80),
    height: Math.max(12, rows || 24),
  };
}

export function Picker({ agents, onSelect, onRefresh }: Props) {
  const { exit } = useApp();
  const { columns, rows } = useWindowSize();
  const [index, setIndex] = useState(0);
  const { width, height } = termSize(columns, rows);
  const listHeight = Math.max(3, height - 6);
  const innerList = Math.max(1, listHeight - 2);
  const inner = innerWidth(width);

  useInput((input, key) => {
    if (input === "q" || key.escape) {
      exit();
      return;
    }
    if (key.ctrl && input === "c") {
      exit();
      return;
    }
    if (input === "r") {
      onRefresh();
      return;
    }
    if (agents.length === 0) return;
    if (key.upArrow || input === "k" || (key.ctrl && input === "p")) {
      setIndex((current) => (current <= 0 ? agents.length - 1 : current - 1));
      return;
    }
    if (key.downArrow || input === "j" || (key.ctrl && input === "n")) {
      setIndex((current) => (current >= agents.length - 1 ? 0 : current + 1));
      return;
    }
    if (key.return || input === "\r" || input === "\n") {
      const agent = agents[index];
      if (agent) onSelect(agent);
    }
  });

  const safeIndex = agents.length === 0 ? 0 : Math.min(index, agents.length - 1);
  const maxStart = Math.max(0, agents.length - innerList);
  const start = Math.min(Math.max(0, safeIndex - innerList + 1), maxStart);
  const visible = agents.slice(start, start + innerList);

  return (
    <Box flexDirection="column" width={width} height={height} overflow="hidden">
      <Box borderStyle="single" borderColor="cyan" paddingX={1} height={3} overflow="hidden">
        <Text bold color="cyan">
          Pick a bot
        </Text>
      </Box>
      <Box
        flexDirection="column"
        borderStyle="single"
        borderColor="gray"
        paddingX={1}
        height={listHeight}
        overflow="hidden"
      >
        {agents.length === 0 ? (
          <Text color="yellow">No agents on this host. Create one in the Grok Bot app, then press r.</Text>
        ) : (
          visible.map((agent) => {
            const selected = agent.id === agents[safeIndex]?.id;
            const name = agentLabel(agent, agents).slice(0, Math.max(1, inner - 2));
            return (
              <Text key={agent.id} inverse={selected}>
                {selected ? "› " : "  "}
                {name}
              </Text>
            );
          })
        )}
      </Box>
      <Box borderStyle="single" borderColor="gray" paddingX={1} height={3} overflow="hidden">
        <Text dimColor>↑↓ / j k move  ·  Enter open  ·  r refresh  ·  q quit</Text>
      </Box>
    </Box>
  );
}
