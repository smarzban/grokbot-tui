#!/usr/bin/env node
import { render } from "ink";
import { InkPictureProvider } from "ink-picture";
import { loadDotEnvFile, readConfig, readToken } from "./config.js";
import { rewriteKittyCtrlCChunk } from "./tui/keys.js";
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

/**
 * Ink's App-level exitOnCtrlC only matches raw \\x03. With kitty CSI-u,
 * stdin.read is rewritten so that fallback still fires. useInput handlers
 * also call exit() via isCtrlKey when they see the event.
 */
function installKittyCtrlCFallback(stdin: NodeJS.ReadStream): void {
  const orig = stdin.read.bind(stdin);
  stdin.read = ((size?: number) => {
    const chunk = orig(size);
    return typeof chunk === "string" ? rewriteKittyCtrlCChunk(chunk) : chunk;
  }) as typeof stdin.read;
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
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write(
      "grok-tui needs an interactive terminal. Run `npm start` in your own TTY, or `npm start -- --mock` to try the mock host.\n",
    );
    process.exitCode = 1;
    return;
  }
  installKittyCtrlCFallback(process.stdin);
  render(
    <InkPictureProvider>
      <App config={config} token={token} mock={mock} />
    </InkPictureProvider>,
    {
      alternateScreen: true,
      // Ink App only matches raw \x03. kitty CSI-u Ctrl+C is rewritten to
      // \x03 in stdin.read so this fallback still fires. useInput also
      // calls exit() via isCtrlKey when it sees the event.
      exitOnCtrlC: true,
      // Disambiguate only: enough for Shift+Enter on Ghostty. Do not enable
      // reportAllKeysAsEscapeCodes — Ink 7 leaks CSI-u into the compose box.
      kittyKeyboard: { mode: "enabled", flags: ["disambiguateEscapeCodes"] },
    },
  );
}

main(process.argv).catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
