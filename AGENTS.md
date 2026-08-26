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

`grokbot-tui` is an unofficial Ink/React terminal UI for chatting with Grok Bot bots and rooms. The
bin is `grok-tui`. It talks to the host HTTP gateway with a small owned client
(`POST {gatewayUrl}/api/{method}` + bearer token), not an official public API. Stack: Node 22+,
TypeScript, Ink 7, React 19.

## Build / test / verify

- Build: `npm run build`
- Test: `npm test`
- Canonical verify (the one documented green-bar command): `npm run typecheck && npm test`

## Conventions

- Prefer small PRs; keep `main` shippable.
- User-facing name for the bot/room chooser is **lobby** (footer: `Esc lobby`).
- Canonical env only: `GROKBOT_GATEWAY_URL`, `GROKBOT_GATEWAY_TOKEN`, `GROKBOT_GATEWAY_PORT`.
- Never log or print gateway tokens or desktop session secrets.
- Live working state belongs in `HANDOFF.md` (gitignored); standing rules belong here or in
  `AGENTS.local.md`.
