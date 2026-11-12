# MINI GTA — GDK build

The same game design as [baseline-gta-web](../../baseline-gta-web/) (top-down
open-world driving: walk, steal cars, evade police, deliver checkpoints), but
**built through the GDK pipeline**: a declared spec, a generated team plan,
pillar playbooks as the working rules, and quality gates that reject the build
until they pass.

## The GDK process this build went through

1. **Spec** — `gdk.game.json` (engine: web, single-player, 60 Hz physics, 60 FPS target).
2. **Plan** — `gdk plan` produced 5 phases and a 5-agent roster (netcode and the
   network-facing security specialist were correctly dropped for a
   single-player spec).
3. **Phases with exit gates** — every phase's gates had to pass before moving on:
   - Phase 1 · scaffold → `QA.SPEC-COMPLETE` ✓
   - Phase 2 · simulation → deterministic sim + FSM + headless proof suite ✓
   - Phase 4 · graphics → explicit renderer config within the FPS budget ✓
   - Phase 5 · hardening → authority audit, secrets scan (see `gate-reports/`)
   - Phase 6 · acceptance → **full gate run: PASS (18 rules, 9 honest N/A skips)**
4. **Gates never got edited to pass.** Where the build was wrong, the build was
   fixed (see below for real defects the gates caught).

## What the gates caught during this build

- **Wall-glue physics**: the first collision response made cars grind along
  walls at 0.07 m/s — the playtest bot exposed it, fixed with proper tangent
  sliding (the playtest gate is why it can't ship that way).
- **Dead missions after a bust**: a BUSTED respawn left the FSM in FREE_ROAM
  forever, so the mission could never complete — a genuine gameplay bug the
  scripted playtest caught.
- **Bot-the-test bugs**: two test defects (an FSM case asserting a legal
  transition should be rejected; a bot chasing uncatchable moving cars) —
  fixed the tests, not the gates.

## Structure (engine standards enforced by gates)

```
src/sim/sim.ts          GDK:AUTHORITATIVE — pure deterministic sim (tick 60 Hz, seeded RNG)
src/game/game_state.ts  explicit FSM (FREE_ROAM / MISSION_ACTIVE / BUSTED)
src/render/renderer.ts  reads state, draws it — never decides it
src/main.ts             fixed-timestep accumulator loop + input wiring
tests/gdk_sim.test.ts   GDK:TEST — determinism, clamp, collision, FSM, crime, playtest
gate-reports/           the audit trail: team plan + per-phase gate runs
```

## Run

```bash
npm install && npm run build
npm test            # headless proof suite (prints GDK:ALL-TESTS-PASS)
npx serve .         # or any static server; open http://localhost:3000
```

Controls: WASD/arrows to walk · E enter/exit car · W/S throttle · A/D steer ·
Space handbrake. Collect checkpoints, avoid five stars of police.

## Gate verdict (acceptance)

- **PASS** — 18 rules green with evidence, 0 failures
- 9 honest skips: netcode + network-security rules marked N/A by the spec
  (single-player), never silently upgraded to passes
