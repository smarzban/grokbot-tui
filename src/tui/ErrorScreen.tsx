import { Box, Text, useApp, useInput } from "ink";
import type { HostErrorKind } from "../client/types.js";

export function errorTitle(kind: HostErrorKind): string {
  switch (kind) {
    case "missing-auth":
      return "Missing gateway token";
    case "unauthorized":
      return "Gateway rejected the token";
    case "host-down":
      return "Grok Bot host is down";
    default:
      return "Something went wrong";
  }
}

export function errorHint(kind: HostErrorKind): string {
  switch (kind) {
    case "missing-auth":
      return "Copy .env.example to .env, set SAND_GATEWAY_TOKEN, or open the Grok Bot desktop app and retry.";
    case "unauthorized":
      return "The token in SAND_GATEWAY_TOKEN / gateway.json is wrong or expired. Do not paste it here.";
    case "host-down":
      return "Start the host, check GROKBOT_GATEWAY_URL (Tailscale or SSH tunnel), or run npm start -- --mock.";
    default:
      return "See README for how to connect. Esc/q quits.";
  }
}

type Props = {
  kind: HostErrorKind;
  message: string;
  onRetry: () => void;
};

export function ErrorScreen({ kind, message, onRetry }: Props) {
  const { exit } = useApp();

  useInput((input, key) => {
    if (input === "q" || key.escape) {
      exit();
      return;
    }
    if (input === "r") {
      onRetry();
    }
  });

  return (
    <Box flexDirection="column" padding={1} borderStyle="round" borderColor="red">
      <Text color="red" bold>
        {errorTitle(kind)}
      </Text>
      <Text>{message}</Text>
      <Box marginTop={1}>
        <Text dimColor>{errorHint(kind)}</Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>r retry  q quit</Text>
      </Box>
    </Box>
  );
}
