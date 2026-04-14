# OpenThrone

OpenThrone is a real-time browser strategy game with a medieval identity: parchment maps, heraldic banners, coalition victories, and fast territory-control matches inspired by the structural strengths of OpenFront while remaining an original implementation.

## Stack

- Vite + React + TypeScript
- PixiJS rendering
- Shared deterministic simulation in `src/shared`
- PartyKit multiplayer room runtime in `src/server`
- Local skirmish worker in `src/skirmish`
- Netlify-ready frontend deployment

## Local Development

1. Install dependencies:

   ```bash
   npm install
   ```

2. Run the full local stack:

   ```bash
   npm run dev
   ```

   This starts:
   - the Vite client on `http://localhost:5173`
   - the PartyKit dev server on `http://127.0.0.1:1999`

3. Run single-player only:

   ```bash
   npm run dev:skirmish
   ```

## Quality Checks

```bash
npm run build
npm run validate:maps
npm test
```

## Game Flow

- `Landing`: banner/profile setup
- `Skirmish`: local-worker match against bots
- `Multiplayer Hall`: private or public room creation via PartyKit
- `Lobby`: map selection, bot fill, ready/start
- `Match`: Pixi-rendered province map + single parchment command panel
- `Results`: coalition victory report and core stats

## Controls

- Click one of your provinces to select it
- Click another reachable province to send levies
- Use the bottom ratio strip for `25%`, `50%`, or `100%`
- Open the parchment panel for kingdom, diplomacy, build, and chronicle tabs
- Use the mouse wheel to zoom the world map
- Drag open water to pan the camera, or right-drag anywhere on the map
- Use coastal provinces to launch ships across the glowing sea lanes
- Use `Learn to Rule` for a guided tutorial that waits for your actions

## Economy

- Treasury in the top HUD is the sum of every owned province's purse
- Each province funds its own refits and upgrades locally
- The HUD shows total passive coin income per second
- Build options show exact coin costs, projected income, and levy growth
- Coin gain and spending indicators appear during play so economy changes are visible

## Deployment

Use the interactive deploy script:

```bash
./scripts/deploy.sh
```

The script:

- builds the app
- initializes git if needed
- commits all files
- creates and pushes a GitHub repo with `gh`
- deploys the PartyKit backend
- sets the deployed PartyKit host into Netlify env
- deploys the built frontend to Netlify

## Repository Layout

- `src/client`: React shell, menus, runtime wiring
- `src/render`: Pixi battlefield renderer
- `src/shared`: rules engine, bots, balance, maps, protocols
- `src/server`: PartyKit room runtime
- `src/skirmish`: local worker wrapper around shared simulation
- `docs/architecture.md`: system summary
- `docs/credits.md`: asset/source credits

## Notes

- Public rooms are tracked through a dedicated PartyKit directory room.
- Multiplayer is server-authoritative by tick; skirmish uses the same simulation locally.
- The map pack is generated from original procedural blueprints in `src/shared/maps/generator.ts`.
- The world map now uses ocean, landmass, country, and sea-lane data instead of the old grid expansion model.
