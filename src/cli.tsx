#!/usr/bin/env node
import { render } from "ink";
import { loadDotEnvFile, readConfig, readToken } from "./config.js";
import { App } from "./tui/App.js";

function printHelp(): void {
  process.stdout.write(
    [
      "grok-tui — unofficial Grok Bot terminal chat",
      "",
      "Usage: npm start -- [options]",
      "",
      "  --mock       In-process mock host (no live Grok Bot)",
      "  --agent NAME Open this agent if it exists (name or id)",
      "  --help       Show this help",
      "",
      "Env: GROKBOT_GATEWAY_URL, SAND_GATEWAY_TOKEN, GROK_TUI_DEFAULT_AGENT, GROK_TUI_MOCK=1",
      "This is not an official API. See README.md.",
      "",
    ].join("\n"),
  );
}

function hasFlag(args: string[], name: string): boolean {
  const i = args.indexOf(name);
  if (i === -1) return false;
  args.splice(i, 1);
  return true;
}

function takeFlag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  const value = args[i + 1];
  args.splice(i, value != null && !value.startsWith("-") ? 2 : 1);
  return value != null && !value.startsWith("-") ? value : undefined;
}

async function main(argv: string[]): Promise<void> {
  loadDotEnvFile();
  const args = argv.slice(2);
  if (hasFlag(args, "--help") || hasFlag(args, "-h")) {
    printHelp();
    return;
  }

  const mock = hasFlag(args, "--mock");
  const agentFlag = takeFlag(args, "--agent");
  const config = readConfig();
  if (agentFlag) config.defaultAgent = agentFlag;

  const token = readToken();
  render(<App config={config} token={token} mock={mock} />);
}

main(process.argv).catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
