# grok-bot-tui

Unofficial terminal UI for chatting with your Grok Bot agents while you work.

**This is not an official xAI or Cursor product.** There is no public Grok Bot chat API. The TUI talks to the undocumented host HTTP gateway (`GET /health`, `POST /api/<command>`) through two community clients:

- [`@adam91holt/grokbot-sdk`](https://github.com/adam91holt/grokbot-sdk) — typed gateway client. Primary path when a URL/token or `gateway.json` is available.
- [`grok-bot-cli`](https://github.com/ScriptedAlchemy/grok-bot-cli) (`gbot`) — reads the Grok Bot **desktop app** encrypted session on macOS so a laptop user does not need a tunnel.

Command names and response shapes come from those libraries / the live host. The gateway can change without notice. Treat the gateway token and every transcript as secrets.

## What v1 does

- Lists your bots (name + id)
- Opens a split chat: transcript on top, compose box at the bottom
- Sends a message, then **polls until the bot is idle** and shows the last reply (the host does not stream tokens)
- Switch bots without quitting
- Cancel an in-flight wait (Esc) and ask the host to interrupt if it supports `interruptAgentRun`

Out of scope: groups/rooms, streaming, creating or deleting agents, Slack, avatars, rich markdown.

## Install

Requires **Node.js 22+**.

```sh
git clone <this-repo>
cd grok-bot-tui
npm install
```

Copy env defaults and fill in local secrets (never commit `.env`):

```sh
cp .env.example .env
```

## Run

```sh
npm start
```

Needs an interactive terminal (TTY). Mock host, no live Grok Bot (proves the TUI wiring):

```sh
npm start -- --mock
# or: npm run start:mock
```

Other flags: `--agent NAME` (skip the picker if that bot exists), `--help`.

| Key | Where | Action |
| --- | --- | --- |
| ↑ ↓ / j k, Enter | picker | Move / open |
| Enter | chat | Send |
| Esc | chat | Cancel wait, or back to the picker |
| Ctrl+b | chat | Switch bot |
| r | picker / error | Retry / refresh |
| q | picker / error | Quit |
| Ctrl+c | anywhere | Quit |

## Connect to a real host

### On the Grok Bot computer

If this TUI runs on the same machine as the host, `new GrokBot()` (via the SDK) reads `/home/box/sand-data/gateway.json` for port + token. You can also set:

```sh
GROKBOT_GATEWAY_URL=http://127.0.0.1:1340
SAND_GATEWAY_TOKEN=...   # from gateway.json; do not git this
```

### From a laptop, tunneled gateway

Reach the host over Tailscale or an SSH tunnel. **Do not put port 1340 on the public internet.**

```sh
GROKBOT_GATEWAY_URL=http://<tailscale-or-localhost-tunnel>:1340
SAND_GATEWAY_TOKEN=...   # copy from the host's gateway.json
```

Aliases accepted: `SAND_GATEWAY_URL`, `GROK_BOT_GATEWAY_URL`, `GROK_BOT_GATEWAY_TOKEN`.

Optional: `GROK_TUI_DEFAULT_AGENT=Ada` to open that seat on launch.

### From a laptop with the Grok Bot desktop app

Open Grok Bot and sign in. `grok-bot-cli` can decrypt the app session (`~/Library/Application Support/Grok Bot/gateway-descriptor.json` + macOS keychain) and obtain the same gateway URL + token. If no env URL/token and no `gateway.json` are present, this TUI tries that path automatically. You should not need to copy a token.

`gbot doctor` from `grok-bot-cli` is useful if the session is missing or unusable.

## Env vars

See `.env.example`. Never print, log, or commit `SAND_GATEWAY_TOKEN`, `gateway.json`, or the desktop session payload. The TUI redacts bearer tokens in error text and never shows `gateway.json`.

| Variable | Purpose |
| --- | --- |
| `GROKBOT_GATEWAY_URL` | Gateway origin (`http://127.0.0.1:1340` or a tunnel) |
| `SAND_GATEWAY_TOKEN` | Gateway token |
| `GROK_TUI_DEFAULT_AGENT` | Optional name or id to open first |
| `GROK_TUI_MOCK=1` | Force the in-process mock host |
| `GROK_TUI_WAIT_TIMEOUT_MS` | Optional cap on wait-for-reply (Esc still cancels) |
| `SAND_DATA_ROOT` | Override sand-data path for `gateway.json` discovery |

## Tests

```sh
npm test
npm run typecheck
```

Client tests drive a **mock host**: in-memory `MockHostClient`, plus a scripted `fetch` that speaks `GET /health` and `POST /api/listAgents|sendPrompt|getAgentTranscriptTail|interruptAgentRun` so `@adam91holt/grokbot-sdk` is exercised without a live box. Coverage includes list, send + poll until reply, host-down, and missing/wrong auth.

This environment usually cannot talk to a real Grok Bot host. Use `--mock` to exercise the TUI; point `.env` at your host to chat for real.

## Scripts

| Script | What |
| --- | --- |
| `npm start` | Launch the TUI (`tsx src/cli.tsx`) |
| `npm run start:mock` | Launch against the mock host |
| `npm test` | Client tests |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run build` | Compile to `dist/` |

## Security

- Gateway tokens live only in memory (env, `gateway.json`, or the desktop session). They are never written to logs or the UI.
- Transcripts are sensitive. The TUI shows chat text only, not raw gateway payloads.
- Destructive host commands (`deleteAgent`, box reset, …) are not exposed.
