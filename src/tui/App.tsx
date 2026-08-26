import { Box, Text, useWindowSize } from "ink";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AppConfig } from "../config.js";
import { openHostClient } from "../client/factory.js";
import { readRosterCache, writeRosterCache } from "../client/rosterCache.js";
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

function enterAfterRoster(
  roster: Agent[],
  defaultAgent: string | undefined,
  setAgents: (agents: Agent[]) => void,
  setScreen: (screen: Screen) => void,
): void {
  setAgents(roster);
  const fallback = pickDefault(roster, defaultAgent);
  if (fallback) {
    setScreen({ name: "chat", agent: fallback });
  } else {
    setScreen({ name: "picker" });
  }
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
  const [rosterRefreshing, setRosterRefreshing] = useState(false);
  /** Monotonic generation so overlapping listAgents calls discard stale results. */
  const rosterGenRef = useRef(0);

  const applyFreshRoster = useCallback(
    (roster: Agent[], cacheKey: string | undefined, openScreen: boolean) => {
      if (cacheKey) writeRosterCache(cacheKey, roster);
      if (openScreen) {
        enterAfterRoster(roster, config.defaultAgent, setAgents, setScreen);
        return;
      }
      setAgents(roster);
      setScreen((current) => {
        if (current.name !== "chat") return current;
        if (roster.length === 0) return current;
        const live = roster.find((agent) => agent.id === current.agent.id);
        // Agent gone from the host — leave chat rather than keep a dead id.
        return live ? { name: "chat", agent: live } : { name: "picker" };
      });
    },
    [config.defaultAgent],
  );

  const fetchRoster = useCallback(
    async (
      host: HostClient,
      options: { openScreen: boolean; showRefreshing: boolean; silent: boolean },
    ) => {
      const gen = ++rosterGenRef.current;
      if (options.showRefreshing) setRosterRefreshing(true);
      try {
        const roster = await host.listAgents();
        if (gen !== rosterGenRef.current) return;
        // A transient empty response during silent refresh must not wipe cache or eject chat.
        if (roster.length === 0 && options.silent && !options.openScreen) return;
        applyFreshRoster(roster, host.rosterCacheKey, options.openScreen);
      } catch (err) {
        if (gen !== rosterGenRef.current) return;
        if (!options.silent) {
          const kind = err instanceof HostClientError ? err.kind : "unknown";
          setScreen({
            name: "error",
            kind,
            message: err instanceof HostClientError ? err.message : errorMessage(err, token),
          });
        }
        // Stale cache stays on screen; a failed silent refresh is not an error overlay.
      } finally {
        if (options.showRefreshing && gen === rosterGenRef.current) {
          setRosterRefreshing(false);
        }
      }
    },
    [applyFreshRoster, token],
  );

  const boot = useCallback(async () => {
    rosterGenRef.current += 1;
    setScreen({ name: "boot" });
    setBootNote("Connecting to Grok Bot host…");
    setRosterRefreshing(false);
    try {
      const next = await openHostClient({ config, token, mock });
      setClient(next);
      const cached = next.rosterCacheKey ? readRosterCache(next.rosterCacheKey) : undefined;
      if (cached !== undefined) {
        enterAfterRoster(cached, config.defaultAgent, setAgents, setScreen);
        void fetchRoster(next, { openScreen: false, showRefreshing: true, silent: true });
        return;
      }
      setBootNote("Loading agents…");
      await fetchRoster(next, { openScreen: true, showRefreshing: false, silent: false });
    } catch (err) {
      const kind = err instanceof HostClientError ? err.kind : "unknown";
      setScreen({
        name: "error",
        kind,
        message: err instanceof HostClientError ? err.message : errorMessage(err, token),
      });
    }
  }, [config, fetchRoster, mock, token]);

  useEffect(() => {
    void boot();
  }, [boot]);

  const refreshRoster = useCallback(async () => {
    if (!client) {
      await boot();
      return;
    }
    await fetchRoster(client, { openScreen: false, showRefreshing: true, silent: false });
  }, [boot, client, fetchRoster]);

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
        refreshing={rosterRefreshing}
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
