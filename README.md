# Drive4Apex 🏎️

**Hit every apex.** Named for the motorsport term — the optimal point of a
corner that drivers aim for on the fastest racing line.

A lightweight 3D arcade racing game that runs entirely in the browser.
Built with **Three.js + TypeScript + Vite** — no backend, no downloads,
every asset (models, textures, audio) is generated procedurally at runtime.

## Features

- **6 selectable cars** with distinct top speed / acceleration / handling stats
- **10 paint colors** — 4 free, 6 unlocked with race credits
- **3 tracks**: Coastal Circuit (ocean-side, medium), Desert Speedway
  (long straights, fast), Mountain Pass (technical, elevation changes)
- **2 race modes**: Circuit (3–5 laps) and Sprint (point-to-point)
- **7 AI opponents** with racing lines, braking-point planning, overtaking,
  occasional mistakes and three difficulty levels
- **Progression**: earn credits per race, unlock paints, best-lap records —
  saved to localStorage
- **Full HUD**: position, laps, speedometer, race + best-lap timers, minimap,
  wrong-way warning
- **Synthesized audio**: engine pitch tied to speed, skids, collisions,
  countdown beeps and a procedural music loop — zero audio files
- **Desktop + mobile**: WASD/arrows + Space handbrake, or on-screen
  touch controls
- Pause menu, restart, countdown sequence, finish celebration, results screen
- Graphics quality presets (pixel ratio, draw distance, scenery density,
  particles)

## Development

```bash
yarn          # install dependencies
yarn dev      # local dev server with HMR
yarn build    # type-check + production build into dist/
yarn preview  # serve the production build locally
```

## Deploying to Netlify

The repo ships with `netlify.toml` — just connect the repository (or drag the
`dist/` folder into Netlify Drop). Build command `yarn build`, publish
directory `dist`. Static hosting only; no functions or environment needed.

## Architecture

```
src/
  Game.ts            top-level state machine (menu/loading/countdown/racing/…)
  config/            car roster, track definitions, paint colors, AI names
  tracks/Track.ts    Catmull-Rom spline track: physics samples + all meshes
  vehicles/          procedural low-poly car models + arcade physics
  systems/           input, AI drivers, race rules, particles, race session
  audio/             Web Audio synthesizer (engine, sfx, music sequencer)
  ui/                DOM menus & HUD, canvas minimap, 3D menu showroom
  utils/             math helpers, localStorage save system
```

Performance notes: a single draw call per scenery type (instanced meshes),
one `THREE.Points` pool for all particles, blob shadows instead of shadow
maps, canvas-generated textures, and fog-matched draw distances per quality
preset. The whole game gzips to roughly 130 KB of JavaScript.
