# grok-bot-tui

Unofficial terminal UI for chatting with your Grok Bot agents while you work.

**This is not an official xAI or Cursor product.** There is no public Grok Bot chat API. The TUI talks to the undocumented host HTTP gateway with its own small client: `POST {gatewayUrl}/api/{method}` plus `Authorization: Bearer {token}` and any desktop session headers. It does not use `@adam91holt/grokbot-sdk` or `grok-bot-cli`. Command names and response shapes come from the live host and can change without notice. Treat the gateway token and every transcript as secrets.

## What v1 does

- Lists your bots and rooms by name (a short id prefix only if two names collide)
- Opens a framed chat with round corners: agent or room name (rooms also show members), idle/waiting in the header, clipped transcript, compose bar at the bottom. 1:1 chats hide `you` / bot speaker labels (alignment is enough); rooms still show member names.
- Sends a message. 1:1 chats **poll until the bot is idle** and show the last reply; rooms send on the group id and let idle poll pick up each member’s turn
- While idle, refreshes the transcript and roster so Grok Bot app messages and `isRunning` answering indicators show up without sending from the TUI
- PageUp / PageDown, the scroll wheel, and ↑/↓ scroll the clipped history; new messages only pin to the bottom if you were already there
- Images from the host draw in Ghostty. `user-attachment` rows use snake_case `file_name` / `file_path`; bot pictures arrive as `send-message` `{ type: "text", images: [{ url, alt }] }` with a `file://` URL. Those host paths live in the box (`/home/box/sand-data/...`) and are missing on the Mac, so the TUI calls `readAttachmentImage({ path })` over the same POST helper, decodes the `dataUrl`, caches a temp file, and paints it with Kitty. Pasting a local screenshot path as the message also draws. Filename-only host turns stay `[image] filename`. Ghostty already speaks the Kitty graphics protocol — no extra install.
- In a room, `@` plus a prefix lists matching members; Tab or Enter inserts `@Name ` as plain text
- Switch bots or rooms without quitting
- Cancel an in-flight wait (Esc) and ask the host to interrupt if it supports `interruptAgentRun`
- Uses the terminal alternate screen so the transcript stays framed instead of spilling into scrollback

Out of scope: creating or deleting rooms, seating members, streaming, creating or deleting agents, Slack, avatars, rich markdown. The TUI does not upload attachments from the compose box.

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
| PgUp / PgDn / wheel / Home / End / Ctrl+u / Ctrl+d | chat | Scroll history (stays put on idle poll). ↑ ↓ scroll only while the compose draft is a single line |
| ← → / Ctrl+a / Ctrl+e | chat compose | Move the caret (Ctrl+a/e = whole draft). Cmd+← / Cmd+→ = current line. Backspace/Delete edit at the caret |
| Shift+Enter / Ctrl+J | chat compose | Insert a newline. Enter (no Shift) sends. Cmd+Delete / Cmd+Backspace clears the draft. Long drafts wrap at word boundaries |
| Tab / Enter / ↑ ↓ / Esc | chat mention menu | Complete, move, or close (does not send or leave the room). ← → move the caret and close the menu if they leave the `@token` |
| Esc | chat | Cancel wait, or back to the picker |
| Ctrl+b | chat | Switch bot / room |
| r | picker / error | Retry / refresh |
| q | picker / error | Quit |
| Ctrl+c | anywhere | Quit |

## Connect to a real host

### On the Grok Bot computer

If this TUI runs on the same machine as the host, set:

```sh
GROKBOT_GATEWAY_URL=http://127.0.0.1:1340
SAND_GATEWAY_TOKEN=...   # from the host; do not git this
```

### From a laptop, tunneled gateway

Reach the host over Tailscale or an SSH tunnel. **Do not put port 1340 on the public internet.**

```sh
GROKBOT_GATEWAY_URL=http://<tailscale-or-localhost-tunnel>:1340
SAND_GATEWAY_TOKEN=...
```

Aliases accepted: `SAND_GATEWAY_URL`, `GROK_BOT_GATEWAY_URL`, `GROK_BOT_GATEWAY_TOKEN`.

Optional: `GROK_TUI_DEFAULT_AGENT=Ada` to open that seat on launch.

### From a laptop with the Grok Bot desktop app (macOS)

Open Grok Bot and sign in. After you Allow the Keychain prompt ("Grok Bot Safe Storage"), this TUI decrypts `~/Library/Application Support/Grok Bot/gateway-descriptor.json` (version 1 `encrypted`, or version 2 a single `entries` blob) using Chromium Safe Storage and the Keychain password. Cleartext is `{ baseUrl, token, headers? }`. Headers often include routing such as `x-anyrun-network-token`; the URL path is kept (only a trailing slash is trimmed).

If no env URL/token is set, that desktop session is used. You should not need to copy a token. There is no `GET /health` probe; `listAgents` is the connectivity check.

## Env vars

See `.env.example`. Never print, log, or commit `SAND_GATEWAY_TOKEN` or the desktop session payload. The TUI redacts bearer tokens in error text.

| Variable | Purpose |
| --- | --- |
| `GROKBOT_GATEWAY_URL` | Gateway origin (`http://127.0.0.1:1340` or a tunnel). Keep any path; only a trailing slash is trimmed. |
| `SAND_GATEWAY_TOKEN` | Gateway token |
| `GROK_TUI_DEFAULT_AGENT` | Optional name or id to open first |
| `GROK_TUI_MOCK=1` | Force the in-process mock host |
| `GROK_TUI_WAIT_TIMEOUT_MS` | Optional cap on wait-for-reply (Esc still cancels) |
| `GROK_TUI_POLL_MS` | Idle transcript poll interval (default 1500; minimum 250) |

## Tests

```sh
npm test
npm run typecheck
```

Client tests drive a **mock host**: in-memory `MockHostClient`, a scripted `fetch` for the owned POST helper (env URL+token), and a scripted desktop gateway (path-preserving URL + extra session headers, no `GET /health`) for `DesktopHostClient`. Coverage includes list, send + poll until reply, host-down, missing/wrong auth, desktop descriptor decrypt with an injected Keychain read, and desktop header/path forwarding.

This environment usually cannot talk to a real Grok Bot host. Use `--mock` to exercise the TUI; point `.env` at your host to chat for real.

## Images in Ghostty

Ghostty implements the Kitty graphics protocol. This TUI does **not** need `viu`, `chafa`, `kitten`, Sixel, iTerm2 OSC 1337, or a Ghostty config toggle.

How a turn is drawn:

1. `getTranscript` / `getAgentTranscriptTail` rows: `user-attachment` (`file_name`, `file_path`) and `send-message` `message.images[]` (`url`, `alt`, `width`, `height`). A **local** file that exists (from the host, a pasted path, or a temp file we cached) is reserved 8 transcript rows and painted with [`ink-picture`](https://github.com/endernoke/ink-picture) (`protocol: { full: "kitty" }`, stable React keys so poll/re-render replaces in place). If the block is scrolled so those 8 rows are not fully in the pane, the TUI shows `[image] filename` instead of a Kitty placement (avoids ghost pixels).
2. A user or assistant message whose text is (or contains) a **local image path that exists** — including `file://` URLs, quoted paths, and drag-quoted `\ ` spaces — is drawn the same way. A path-only message does not keep the raw path as bubble text. Extensions: png, jpg, jpeg, gif, webp, svg.
3. Filename-only host turns (no `file_path` / host path / fetchable bytes) stay `[image] filename`.
4. Host `file_path` and `file://` `message.images[].url` point at box paths (`/home/box/sand-data/...`) that do **not** exist on the Mac. After poll/load the TUI calls `readAttachmentImage({ path })` through the same POST helper. `path` is the host filesystem path (`file_path`, an abs `image.path`, or `fileURLToPath` of a `file://` URL). Never send the `file://` string. The host returns `{ dataUrl, width, height }`; bytes are cached under `os.tmpdir()` so the 1.5s idle poll does not re-download. URLs, tokens, dataUrls, and paths are not logged.
5. `https://` values are stored as `url` (never printed) and fetched with session headers only when there is no host path for `readAttachmentImage`.

`npm start -- --mock` seeds Ada with `fixtures/mock-photo.png` as an attachment **and** as a pasted path (both should draw), plus a name-only attachment (placeholder).

## Scripts

| Script | What |
| --- | --- |
| `npm start` | Launch the TUI (`tsx src/cli.tsx`) |
| `npm run start:mock` | Launch against the mock host |
| `npm test` | Client tests |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run build` | Compile to `dist/` |

## Security

- Gateway tokens live only in memory (env or the desktop session). They are never written to logs or the UI.
- Transcripts are sensitive. The TUI shows chat text only, not raw gateway payloads.
- Destructive host commands (`deleteAgent`, box reset, …) are not exposed.
