import { Box, Text, useWindowSize } from "ink";
import { useCallback, useEffect, useState } from "react";
import type { AppConfig } from "../config.js";
import { openHostClient } from "../client/factory.js";
import { HostClientError, type Agent, type HostClient, type HostErrorKind } from "../client/types.js";
import { errorMessage } from "../redact.js";
import { Chat } from "./Chat.js";
import { ErrorScreen } from "./ErrorScreen.js";
import { Picker } from "./Picker.js";

type Screen =
  | { name: "boot" }
  | { name: "error"; kind: HostErrorKind; message: string }
  | { name: "picker" }
  | { name: "chat"; agent: Agent };

type Props = {
  config: AppConfig;
  token?: string;
  mock: boolean;
};

function pickDefault(agents: Agent[], wanted?: string): Agent | undefined {
  if (!wanted) return undefined;
  const needle = wanted.trim().toLowerCase();
  return agents.find((agent) => agent.id.toLowerCase() === needle || agent.name.toLowerCase() === needle);
}

function BootScreen({ note }: { note: string }) {
  const { columns, rows } = useWindowSize();
  const width = Math.max(40, columns || 80);
  const height = Math.max(12, rows || 24);
  return (
    <Box flexDirection="column" width={width} height={height} overflow="hidden">
      <Box borderStyle="round" borderColor="cyan" paddingX={1} height={3} overflow="hidden">
        <Text bold color="cyan">
          Grok Bot
        </Text>
      </Box>
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor="gray"
        paddingX={1}
        flexGrow={1}
        overflow="hidden"
      >
        <Text dimColor>{note}</Text>
      </Box>
    </Box>
  );
}

export function App({ config, token, mock }: Props) {
  const [screen, setScreen] = useState<Screen>({ name: "boot" });
  const [client, setClient] = useState<HostClient | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [bootNote, setBootNote] = useState("Connecting to Grok Bot host…");

  const boot = useCallback(async () => {
    setScreen({ name: "boot" });
    setBootNote("Connecting to Grok Bot host…");
    try {
      const next = await openHostClient({ config, token, mock });
      setClient(next);
      setBootNote("Loading agents…");
      const roster = await next.listAgents();
      setAgents(roster);
      const fallback = pickDefault(roster, config.defaultAgent);
      if (fallback) {
        setScreen({ name: "chat", agent: fallback });
      } else {
        setScreen({ name: "picker" });
      }
    } catch (err) {
      const kind = err instanceof HostClientError ? err.kind : "unknown";
      setScreen({
        name: "error",
        kind,
        message: err instanceof HostClientError ? err.message : errorMessage(err, token),
      });
    }
  }, [config, mock, token]);

  useEffect(() => {
    void boot();
  }, [boot]);

  const refreshRoster = useCallback(async () => {
    if (!client) {
      await boot();
      return;
    }
    try {
      const roster = await client.listAgents();
      setAgents(roster);
    } catch (err) {
      const kind = err instanceof HostClientError ? err.kind : "unknown";
      setScreen({
        name: "error",
        kind,
        message: err instanceof HostClientError ? err.message : errorMessage(err, token),
      });
    }
  }, [boot, client, token]);

  if (screen.name === "boot") {
    return <BootScreen note={bootNote} />;
  }

  if (screen.name === "error") {
    return <ErrorScreen kind={screen.kind} message={screen.message} onRetry={() => void boot()} />;
  }

  if (!client) {
    return <BootScreen note="Client was not created." />;
  }

  if (screen.name === "picker") {
    return (
      <Picker
        agents={agents}
        onSelect={(agent) => setScreen({ name: "chat", agent })}
        onRefresh={() => void refreshRoster()}
      />
    );
  }

  return (
    <Chat
      client={client}
      agent={screen.agent}
      roster={agents}
      timeoutMs={config.waitTimeoutMs}
      pollMs={config.pollIntervalMs}
      onRoster={setAgents}
      onSwitch={() => setScreen({ name: "picker" })}
    />
  );
}
