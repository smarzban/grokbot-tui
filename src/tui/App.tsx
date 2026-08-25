import { Box, Text } from "ink";
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
      setBootNote("Checking host health…");
      await next.health();
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
    return (
      <Box padding={1}>
        <Text color="yellow">{bootNote}</Text>
      </Box>
    );
  }

  if (screen.name === "error") {
    return <ErrorScreen kind={screen.kind} message={screen.message} onRetry={() => void boot()} />;
  }

  if (!client) {
    return (
      <Box padding={1}>
        <Text color="red">Client was not created.</Text>
      </Box>
    );
  }

  if (screen.name === "picker") {
    return (
      <Picker
        agents={agents}
        source={client.source}
        onSelect={(agent) => setScreen({ name: "chat", agent })}
        onRefresh={() => void refreshRoster()}
      />
    );
  }

  return (
    <Chat
      client={client}
      agent={screen.agent}
      timeoutMs={config.waitTimeoutMs}
      onSwitch={() => setScreen({ name: "picker" })}
    />
  );
}
