# Spotlight Panic

Spotlight Panic is a browser-based local co-op party maze game with a dark retro arcade horror style.

The runner explores a maze while the only spotlight is controlled through the webcam by moving a bright object, such as a phone with a white screen or white paper. It can be played solo, but it is designed to be more chaotic as a party game where someone else takes over the light.

## Features

- 960x540 HTML Canvas maze gameplay
- Webcam-controlled spotlight tracking for the light operator
- Mouse spotlight fallback for development and camera failures
- Three hand-designed levels
- Chaser, patrol, and stalker enemy types
- Collectible keys and fake key traps
- Floor 67 ritual: activate `6` then `7` with the spotlight
- Local player leaderboard using `localStorage`
- Seeded runs and replayable seed support
- Neon pixel arcade UI
- Background music and Web Audio sound effects

## Tech Stack

- Vite
- Vanilla TypeScript
- HTML Canvas
- CSS
- Web Audio API
- Webcam access through `navigator.mediaDevices.getUserMedia`

No React, backend, Supabase, ML, or external game engine.

## Getting Started

Install dependencies:

```bash
npm install
```

Start the development server:

```bash
npm run dev
```

Build for production:

```bash
npm run build
```

Preview the production build:

```bash
npm run preview
```

## How to Play

1. Enter a player name.
2. Start a run.
3. Move the runner with `WASD` or arrow keys.
4. Control the spotlight by holding a bright phone screen or white object in front of the webcam.
5. Collect 3 real keys.
6. Avoid ghosts and fake keys.
7. Complete the Floor 67 ritual by shining the spotlight on `6`, then `7`.
8. Escape through the unlocked door.

For party play, one person can control movement while another controls the spotlight. For solo play, the same person can handle both.

## Controls

Visible gameplay is designed around camera spotlight control.

Keyboard controls:

- `WASD` or arrow keys: move player
- `P`: pause

Hidden developer shortcuts:

- `M`: mouse spotlight fallback
- `C`: camera spotlight
- `L`: toggle darkness

## Enemy Types

- Chaser Ghost: moves directly toward the player and rushes when lit.
- Patrol Ghost: follows fixed waypoint routes and blocks corridors.
- Stalker Ghost: moves in darkness and slows in the light.

## Scoring

The score rewards fast, clean runs:

- Time reduces score continuously.
- Ghost hits reduce score.
- Fake keys reduce score.
- Clearing levels adds score.
- Completing Floor 67 adds a bonus.
- Clean runs can earn no-hit and no-fake-key bonuses.

Leaderboard entries are saved locally in the browser.

## Project Structure

```text
src/
  audio.ts        Sound effects and background music
  constants.ts    Shared game constants
  leaderboard.ts  Score, rank, and localStorage leaderboard logic
  levels.ts       Hand-designed level data and spawn pools
  main.ts         Canvas game loop, UI, input, webcam tracking
  random.ts       Seeded random helpers
  style.css       Neon arcade UI styling
  types.ts        Shared TypeScript types
```

## Notes

Webcam access requires a browser that supports `getUserMedia`. If camera permission is denied or unavailable, the game can still be played with the hidden mouse fallback.
