# Galactic Sovereign audio library

This directory contains source sound effects that are cleared for use in the game.
The imported library currently contains 416 OGG effects plus the original license
file for each source pack.

## Layout

- `sfx/kenney/interface/` — 100 interface and notification sounds
- `sfx/kenney/ui/` — 51 clicks, releases, rollovers, and switches
- `sfx/kenney/digital/` — 62 tones, zaps, phase jumps, and power-ups
- `sfx/kenney/sci-fi/` — 73 engines, thrusters, lasers, force fields, impacts, and explosions
- `sfx/kenney/impact/` — 130 physical impact and foley sounds

The combined preview tracks distributed with the UI Audio and Digital Audio packs
were intentionally excluded because they are demonstrations, not individual cues.

See [SOURCES.md](./SOURCES.md) for provenance and [CUE_MAP.md](./CUE_MAP.md) for
the proposed game-event mapping. Runtime code should refer to logical cue IDs rather
than hard-coding these source filenames.

