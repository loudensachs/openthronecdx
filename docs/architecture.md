# OpenThrone Architecture

## Overview

OpenThrone is split into four runtime layers:

- `src/shared`: deterministic game rules, balance, bot planners, map expansion, snapshots, and patches
- `src/server`: PartyKit room runtime for the directory room and match rooms
- `src/skirmish`: local worker that reuses the same shared simulation for single-player
- `src/client` + `src/render`: React shell and Pixi presentation

## Match Lifecycle

1. A player creates or joins a room.
2. The room builds a lobby with host, player slots, map choice, and desired bot fill.
3. On start, the PartyKit room turns the lobby into a `MatchState`.
4. The room runs the simulation at `10 Hz`, applying queued intents and then bot intents.
5. The room broadcasts a full snapshot on start/reconnect and compact patches on each tick.
6. The client applies patches locally and renders the updated state.

## Authority Model

- PartyKit match rooms are authoritative for multiplayer.
- Clients submit intents only.
- The local skirmish worker uses the same shared tick logic, patch logic, and maps.
- The client gives immediate feedback for selection and route previews, but province ownership, levy counts, alliances, and victory state come from snapshots/patches.

## Data Model

### Shared public interfaces

- `PlayerProfile`: browser-stored nickname, banner color, crest, and stable session id
- `LobbyState`: host, slots, map selection, privacy, bot fill
- `ClientIntent`: ready/start, levy send, building changes, alliance flow, pause
- `MatchSnapshot`: reconnect-safe full state
- `ServerPatch`: changed provinces plus full route/score/diplomacy overlays
- `MapDefinition`: procedural world-map graph with provinces, countries, continents, landmasses, and sea lanes

### Map pipeline

- `src/shared/maps/generator.ts` defines seeded world blueprints for each battlefield.
- The generator produces original province polygons, adjacency, country labels, continent groupings, coastline landmasses, and ship lanes.
- `src/shared/maps/index.ts` materializes those generated definitions once for both renderer and simulation.
- `src/shared/maps/validateMaps.ts` checks connectivity and spawn sanity.

## Visual Layer

- Pixi draws the parchment world map, province polygons, continent/country labels, sea lanes, ships, and route banners.
- React owns menu flow, top HUD, bottom send strip, hover cards, and the single parchment command panel.
- The renderer is intentionally map-first; interface chrome stays secondary.

## Deployment Shape

- Frontend builds to `dist/` for Netlify.
- PartyKit hosts the multiplayer backend separately.
- Netlify receives the deployed PartyKit host as a runtime env value through `PARTYKIT_HOST`.
