# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-08-27

### Added

- Warm lobby boot from on-disk roster cache (`~/.cache/grok-tui/`)
- Separate roster poll loop (slower) from lightweight transcript polls
- Deferred image hydration after transcript-only polls
- README screenshots (lobby and chat)
- `CHANGELOG.md` and a tag-triggered npm release workflow

### Changed

- "Is answering" follows transcript pending state only, not roster `isRunning`
- Poll merge aligns transcript tails by content overlap to preserve mid-history
- Poll updates use functional `setTurns` so hydration is not clobbered
- Channel speaker colors; dropped "you" labels in channels
- Lobby groups labeled as channels with spaced sections

### Fixed

- 100-turn poll no longer truncates longer loaded history
- Image path merge is id-only (no positional mismatch)
- Host paths in `image.path` trigger hydrate
- Roster cache writes no longer delete cache-directory symlinks
- Symlink roster files unlinked safely before cache write
- Wait-timeout integer parsing and canonical missing-auth hints

## [0.1.0] - 2026-08-26

Initial public release.
