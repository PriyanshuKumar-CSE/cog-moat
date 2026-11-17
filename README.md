# cognecto · living model

Interactive 3D holographic model of how the Cognecto platform works, end to end.
Built for investor meetings, government presentations and the website.
All data is simulated and generated locally; there is no backend.

## Run

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # static site in dist/, works from any folder or sub-path
npm run preview      # serve the built site
npm test             # unit tests (ledger, IES records)
npm run e2e          # Playwright run of every scene, screenshots in tests/e2e/shots
```

Open a scene directly with a hash, for example `http://localhost:5173/#loop`.

The e2e run starts its own dev server on port 5199, or reuses one already running there.
If another project holds 5199, pick a free port: `E2E_PORT=5211 npm run e2e`.

## Controls

| Key | Action |
| --- | --- |
| `1`-`7` | Jump to a scene |
| `←` `→` | Previous / next scene |
| `Space` | Start or stop the autoplay tour |
| `H` | Hide the HUD |
| `P` | Projector mode (larger type, higher contrast) |
| `` ` `` | Presenter panel: hide any figure, name or place name |
| `Esc` | Close the JSON inspector |

Panels can be dragged by their header and collapsed with a double-click.

## Editing content

- `src/config/content.ts` holds every name, figure and claim, each with a `visible` flag.
- `src/config/tour.ts` holds the autoplay order and timing.
- `src/config/theme.ts` holds the colours.
- `src/sim/completionSpecs.ts` holds the completion specs (road and mine follow Cognecto's notes; water, forest and the building milestones are drafts).
- `src/sim/ies.ts` holds the IES record shape and the claim kinds (only `detection` is confirmed so far).

## Building scene

One simulated B+G+6 residential tower, verified milestone by milestone: excavation and piling, foundation, RCC frame, masonry, plumbing and water, electrical, plaster, flooring and waterproofing, paint.
Each milestone runs the same cycle: drone scan, check against BIM, verifier chain, human sign-off, certificate on the ledger, RA bill released.
An accepted milestone moves the build on with a short time-lapse; a rejection or hold repeats it after rework.
After paint the tower is handed over and structural health monitoring runs: settlement, tilt, strain, crack width and natural frequency.
A crack gauge drifting past its limit raises an inspection work order through the same human gate.
Click any milestone in the Building panel to jump to it.
Stage copy, checks and simulated figures live in `src/scenes/building/stages.ts`; specs in `src/sim/completionSpecs.ts`.

The Building panel switches between two views.
**Quality & sign-off** is the milestone cycle above.
**Project control** follows Cognecto's Project Control brochure: the six control levers measured on the same tower.
Worker productivity (working vs idle by crew), attendance (head-count by the hour against the muster roll), machinery uptime (working, idle, parked), rental equipment (hire hours billed vs seen working), material and haulage (every truck trip logged at the gate camera), and progress and cost (plan vs measured S-curve, slippage in days, cost per unit against the BOQ rate).
On site, crews, the excavator, tower crane, hoist, gondola and trucks are tagged with what Vision AI sees; the quality overlays step aside.
Hire hours queried by Cortex also appear on the approval card and the milestone certificate before the RA bill is released.
A site clock plays a working day (08:00 to 18:00) in 50 s.
During autoplay the view switches to Project control part way through the Building stop (`buildingControlAt` in `src/config/tour.ts`).
Simulated site figures live in `src/scenes/building/control.ts`.
Figures from Cognecto's live screens (23% productive share, 31h 26m idle, 336 min machine time, ₹82 Cr BOQ verified, 0.02 s per frame, 27 models) and the savings reference table live in `src/config/content.ts`; each is labelled LIVE SITE or ON RECORD and can be hidden from the presenter panel.

## Guardrails

- Every action passes a human approval card.
  In timed mode a clearly labelled simulated approver accepts after a countdown; switch it off in the presenter panel to wait for a click.
- A permanent "SIMULATED DATA" badge is shown.
- phyOS is used as a name only.
- The ledger cryptography is real (SHA-256 hash chain, Ed25519 signatures, daily Merkle anchor) but uses a fixed demo key.

## Map data

The globe and India plate use Natural Earth 1:10m admin 0 countries, India point of view (public domain).
India's boundary follows India's official depiction, including all of Jammu & Kashmir, Ladakh and Arunachal Pradesh.
To rebuild, download `ne_10m_admin_0_countries_ind.geojson` and run `node scripts/build-geo.mjs <path>`.

## Structure

```
src/
  config/     content, theme, tour
  core/       renderer, post effects, camera rig, scene router, director, store
  holo/       hologram shaders, grid, text, rings, dust
  hud/        panel kit, widgets, approval card, JSON view, chrome
  sim/        RNG, IES records, ledger, completion specs, loop case generator
  scenes/     one folder per scene: orbit, road, mine, water, forest, building, loop
  data/geo/   bundled map data, built by scripts/build-geo.mjs
tests/
  unit/       vitest
  e2e/        Playwright
```
