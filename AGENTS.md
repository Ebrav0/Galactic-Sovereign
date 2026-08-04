# Galactic Sovereign

Lane-based galactic strategy game — a browser HTML5 Canvas game (source in `src/`) that
also ships as an Electron desktop app (`electron/`). Built with Vite.

## Cursor Cloud specific instructions

### Services & how to run them
- **Dev server (primary):** `npm run dev` starts Vite on `http://localhost:5173`. This is the
  main way to develop and test the game in a browser. Standard scripts live in `package.json`
  (`dev`, `build`, `electron`, `electron:prod`).
- **Build check:** `npm run build` (there is no lint config and no `test` script). It first
  regenerates the checked-in standalone IIFE bundle `src/js/main.standalone.js` via
  `build:standalone`; a clean build reproduces it identically, so `git status` stays clean.
- **Electron app:** `npm run electron` needs a display and won't render in a headless cloud VM;
  prefer the browser dev server for verification here.

### Non-obvious gotchas
- **Use `localhost`, not `127.0.0.1`.** Vite binds to `localhost` (IPv6 `::1`) without `--host`,
  so tools/tests that hardcode `http://127.0.0.1:5173` get `ECONNREFUSED` (e.g.
  `output/verify_cinematic_battle.mjs`). The dev server is reachable at `http://localhost:5173`.
- **Playwright browser is a separate install.** `npm install` does not download the Chromium
  binary; run `npx playwright install chromium` before the `output/verify_*.mjs` tests.

### Tests (`output/verify_*.mjs`)
- These are standalone Playwright scripts, run individually while the dev server is up, e.g.
  `node output/verify_dev_panel.mjs`. There is no aggregate test runner.
- Many scripts are **stale relative to the current UI/state schema** (documented throughout
  `progress.md`). Some also import Playwright from a hardcoded macOS skill path
  (`~/.codex/skills/develop-web-game/...` or `/Users/.../node_modules/playwright`) and will
  fail here; the maintained ones fall back to the workspace Playwright via
  `createRequire(.../package.json)`. Known-current, passing examples:
  `verify_dev_panel.mjs`, `verify_tech_unlocks.mjs`, `verify_v13_tech.mjs`.
- The game exposes test hooks on `window` for scripting: `__newGame(seed)`,
  `__setBootPhase('playing')`, `getGameState()`, `render_game_to_text()`, `advanceTime(ms)`,
  `__forceResearch(id)`, `__devAction(...)`, `__saveSlot/__loadSlot`, `__buildOutpost(id)`.

### Title / boot flow
- On the title screen, **"New Campaign" starts a game directly** (short warp-intro cinematic
  ~6–8s, then the HUD/gameplay). **"Custom Campaign"** opens the options modal
  (`#new-game-modal`). Some older verify scripts wrongly expect "New Campaign" to open that
  modal, and their clicks time out on `#new-game-sandbox-btn`.
- Building an outpost takes ~20s of game time to complete before `Outpost Income` rises above 0.
