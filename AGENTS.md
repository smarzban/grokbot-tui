# AGENTS.md

## Routing guideline

Stranger litmus test: would this instruction make sense to a stranger who cloned this repo? If
no, it belongs in AGENTS.local.md.

A gitignored AGENTS.local.md may exist beside this file; if present, read and follow it before starting work.

Pointer files carry no content: edits go to AGENTS.md or AGENTS.local.md, never CLAUDE.md — it is a
frozen one-line pointer and says so in-file.

Lazy creation: if an agent has private-routed content (per the litmus test above) and no
AGENTS.local.md exists yet in this working copy, it creates one — the committed .gitignore entry
already covers it, so the pattern self-propagates to every clone.

@AGENTS.local.md

## Project overview

`grokbot-tui` is an unofficial Ink/React terminal UI for chatting with Grok Bot bots and rooms.
The published package name is `grokbot-tui`; the CLI bin is `grok-tui`. It uses a small owned HTTP
client against the host gateway (`POST {gatewayUrl}/api/{method}` with a bearer token and optional
desktop session headers). There is no official public chat API. Stack: Node.js 22+, TypeScript,
Ink 7, React 19, `ink-picture` for Kitty graphics in Ghostty.

## Build / test / verify

- Install: `npm install`
- Run from source: `npm start` or `npm run start:mock`
- Build: `npm run build` (writes `dist/` for the `grok-tui` bin)
- Test: `npm test`
- Canonical verify: `npm run typecheck && npm test`

## Conventions

- Prefer small PRs; keep `main` shippable.
- User-facing name for the bot/room chooser is **lobby**. Chat footer: `Esc lobby`. Idle Esc and
  Ctrl+b open the lobby; Esc while waiting cancels the wait and interrupts the host when supported.
- Canonical env only: `GROKBOT_GATEWAY_URL`, `GROKBOT_GATEWAY_TOKEN`, `GROKBOT_GATEWAY_PORT`. Legacy
  `SAND_*` / `GROK_BOT_*` names are ignored.
- `GROK_TUI_WAIT_TIMEOUT_MS`: default `600000`. Exact `0` means unlimited (Esc still cancels).
  Non-integer strings fall back to the default.
- Never log or print gateway tokens, desktop session secrets, or token-bearing URLs. Redact via
  `src/redact.ts`.
- Live working state belongs in `HANDOFF.md` (gitignored). Standing rules belong here or in
  `AGENTS.local.md`.
- Security reports: see `SECURITY.md`. Do not invent a public issue for vulnerabilities.
