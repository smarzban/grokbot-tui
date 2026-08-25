# grok-bot-tui

Unofficial terminal UI for chatting with your Grok Bot agents while you work.

**This is not an official xAI or Cursor product.** There is no public Grok Bot chat API. The TUI talks to the undocumented host HTTP gateway through two community clients:

- [`@adam91holt/grokbot-sdk`](https://github.com/adam91holt/grokbot-sdk) — typed client for a **local box / tunneled** host (`GET /health`, `POST /api/<command>`). Used when `GROKBOT_GATEWAY_URL` / `SAND_GATEWAY_TOKEN` or `gateway.json` is available.
- [`grok-bot-cli`](https://github.com/ScriptedAlchemy/grok-bot-cli) (`gbot`) — Grok Bot **desktop app** session on macOS. The TUI uses `gbot`'s `connectGateway`, `listAgents`, `sendPrompt`, and `getTranscriptTail` (POST `{gatewayUrl}/api/{method}` with Bearer **and** session routing headers). It does **not** feed that session into the SDK: the SDK drops URL paths, omits session headers, and probes `GET /health`, which 404s on the routed desktop gateway.

Command names and response shapes come from those libraries / the live host. The gateway can change without notice. Treat the gateway token and every transcript as secrets.

## What v1 does

- Lists your bots and rooms by name (a short id prefix only if two names collide)
- Opens a framed chat: agent or room name (rooms also show members), idle/waiting in the header, clipped transcript, compose bar at the bottom
- Sends a message. 1:1 chats **poll until the bot is idle** and show the last reply; rooms send on the group id and let idle poll pick up each member’s turn
- While idle, refreshes the transcript and roster so Grok Bot app messages and `isRunning` answering indicators show up without sending from the TUI
- PageUp / PageDown, the scroll wheel, and ↑/↓ scroll the clipped history; new messages only pin to the bottom if you were already there
- Images from the host (`user-attachment` / SendMessage `attachment`) show as `[image] filename` on the correct side
- Switch bots or rooms without quitting
- Cancel an in-flight wait (Esc) and ask the host to interrupt if it supports `interruptAgentRun`
- Uses the terminal alternate screen so the transcript stays framed instead of spilling into scrollback

Out of scope: creating or deleting rooms, seating members, streaming, creating or deleting agents, Slack, avatars, rich markdown. Inline Kitty graphics are not used; image turns use a placeholder so layout stays stable. `@Name` in a room compose box is ordinary text (same as the Grok Bot app).

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

Other flags: `--agent NAME` (skip the picker if that bot or room exists), `--help`.

| Key | Where | Action |
| --- | --- | --- |
| ↑ ↓ / j k, Enter | picker | Move / open |
| PgUp / PgDn / wheel / ↑ ↓ / Ctrl+u / Ctrl+d | chat | Scroll history (stays put on idle poll) |
| Home / End | chat | Jump to oldest / latest |
| Enter | chat | Send |
| Esc | chat | Cancel wait, or back to the picker |
| Ctrl+b | chat | Switch bot / room |
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

Open Grok Bot and sign in. After you Allow the Keychain prompt ("Grok Bot Safe Storage"), `grok-bot-cli` decrypts `~/Library/Application Support/Grok Bot/gateway-descriptor.json` and gets `{ gatewayUrl, gatewayToken, gatewayHeaders }`. Headers often include routing such as `x-anyrun-network-token`; the URL may include a path.

If no env URL/token and no `gateway.json` are present, this TUI uses that session the same way `gbot` does. You should not need to copy a token. A 404 on `GET /health` is ignored; `listAgents` is the connectivity check.

`gbot doctor` is useful if the session is missing or unusable.

## Env vars

See `.env.example`. Never print, log, or commit `SAND_GATEWAY_TOKEN`, `gateway.json`, or the desktop session payload. The TUI redacts bearer tokens in error text and never shows `gateway.json`.

| Variable | Purpose |
| --- | --- |
| `GROKBOT_GATEWAY_URL` | Gateway origin (`http://127.0.0.1:1340` or a tunnel) |
| `SAND_GATEWAY_TOKEN` | Gateway token |
| `GROK_TUI_DEFAULT_AGENT` | Optional name or id to open first |
| `GROK_TUI_MOCK=1` | Force the in-process mock host |
| `GROK_TUI_WAIT_TIMEOUT_MS` | Optional cap on wait-for-reply (Esc still cancels) |
| `GROK_TUI_POLL_MS` | Idle transcript poll interval (default 1500; minimum 250) |
| `SAND_DATA_ROOT` | Override sand-data path for `gateway.json` discovery |

## Tests

```sh
npm test
npm run typecheck
```

Client tests drive a **mock host**: in-memory `MockHostClient`, a scripted local-box `fetch` for the SDK path, and a scripted desktop gateway (path-preserving URL + extra session headers, no `GET /health`) for `DesktopHostClient`. Coverage includes list, send + poll until reply, host-down, missing/wrong auth, health-404-then-listAgents boot, and desktop header/path forwarding.

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
