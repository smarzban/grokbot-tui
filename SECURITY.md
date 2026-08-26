# Security policy

## Supported versions

Security fixes land on the latest published `grokbot-tui` release on npm and on `main`.

## Reporting a vulnerability

Do not open a public GitHub issue for security reports.

Email the maintainer at the address on the [npm package page](https://www.npmjs.com/package/grokbot-tui) or open a private [GitHub security advisory](https://github.com/smarzban/grokbot-tui/security/advisories/new) on this repository.

Include:

- A short description of the issue
- Steps to reproduce
- Impact (for example: token leakage, unauthorized gateway access)

You should hear back within a few days. Please give time for a fix before public disclosure.

## Scope notes

This project talks to an unofficial Grok Bot host gateway. Treat gateway tokens and transcripts as secrets. The TUI is meant not to log or display raw tokens.
