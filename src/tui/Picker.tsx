import { Box, Text, useApp, useInput } from "ink";
import { useState } from "react";
import type { Agent } from "../client/types.js";

type Props = {
  agents: Agent[];
  source: string;
  onSelect: (agent: Agent) => void;
  onRefresh: () => void;
};

export function Picker({ agents, source, onSelect, onRefresh }: Props) {
  const { exit } = useApp();
  const [index, setIndex] = useState(0);

  useInput((input, key) => {
    if (input === "q" || key.escape) {
      exit();
      return;
    }
    if (input === "r") {
      onRefresh();
      return;
    }
    if (agents.length === 0) return;
    if (key.upArrow || input === "k") {
      setIndex((current) => (current <= 0 ? agents.length - 1 : current - 1));
      return;
    }
    if (key.downArrow || input === "j") {
      setIndex((current) => (current >= agents.length - 1 ? 0 : current + 1));
      return;
    }
    if (key.return) {
      const agent = agents[index];
      if (agent) onSelect(agent);
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold>Grok Bot TUI</Text>
      <Text dimColor>
        Unofficial. Source: {source}. Pick an agent.
      </Text>
      <Box marginTop={1} flexDirection="column">
        {agents.length === 0 ? (
          <Text color="yellow">No agents on this host. Create one in the Grok Bot app, then press r.</Text>
        ) : (
          agents.map((agent, i) => {
            const selected = i === index;
            return (
              <Text key={agent.id} inverse={selected} color={selected ? "black" : undefined}>
                {selected ? "▸ " : "  "}
                {agent.name}
                <Text dimColor={false} color={selected ? "black" : "gray"}>
                  {"  "}
                  {agent.id}
                </Text>
              </Text>
            );
          })
        )}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>↑↓ / j k move  enter open  r refresh  q quit</Text>
      </Box>
    </Box>
  );
}
