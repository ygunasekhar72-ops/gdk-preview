# GDK Team Plan — mini-gta-gdk (web)

## Phases
### 1 · scaffold
- **Goal:** Project exists, spec declared, engine config matches spec.
- **Agents:** gdk-scaffold
- **Exit gates:** QA.SPEC-COMPLETE

### 2 · simulation
- **Goal:** Deterministic shared sim + FSM exist and pass headless tests.
- **Agents:** gdk-physics, gdk-logic
- **Exit gates:** PHY.FIXED-TIMESTEP, PHY.SANITY-SIM, PHY.UNIT-CONSIST, LOG.FSM, LOG.SIM-RENDER-SEPARATION

### 4 · graphics
- **Goal:** Look and feel within the FPS/asset budget; quality config explicit.
- **Agents:** gdk-graphics
- **Exit gates:** GFX.FPS-BUDGET, GFX.RENDER-SCALE, GFX.ASSET-BUDGET

### 5 · hardening
- **Goal:** Hostile-client audit passes; secrets scan clean; rate limiting in place.
- **Agents:** gdk-security
- **Exit gates:** SEC.NEVER-TRUST-CLIENT, SEC.SECRETS-SCAN, SEC.RATE-LIMIT, SEC.SANITIZE, SEC.TRANSPORT

### 6 · acceptance
- **Goal:** All gates green; scripted playtest completes the full loop.
- **Agents:** gdk-qa
- **Exit gates:** QA.TESTS-PRESENT, QA.TESTS-PASS, QA.SPEC-COMPLETE, QA.PLAYTEST-SCRIPT

## Roster
### gdk-scaffold — Project bootstrap
- **Goal:** Create the project from the GDK engine template and wire gdk.game.json + engine config to spec values.
- **Load skills:** gdk/gdk-lead
- **Owns rules:** QA.SPEC-COMPLETE
- **Deliverables:** project tree; gdk.game.json; engine config matching spec

### gdk-physics — Sim & maths specialist
- **Goal:** Build the deterministic shared sim (tick loop, integration, clamped inputs) as pure data logic; write the determinism and sanity tests.
- **Load skills:** gdk/gdk-physics
- **Owns rules:** PHY.FIXED-TIMESTEP, PHY.DETERMINISM, PHY.SANITY-SIM, PHY.UNIT-CONSIST
- **Deliverables:** shared sim module (GDK:AUTHORITATIVE); tests/sim determinism + sanity

### gdk-logic — Game-rules specialist
- **Goal:** Express game flow as an explicit FSM with tick-stamped events; keep sim pure and headless-testable.
- **Load skills:** gdk/gdk-logic
- **Owns rules:** LOG.FSM, LOG.SIM-RENDER-SEPARATION, LOG.EVENTS-DETERMINISTIC, LOG.SAVE-SAFE
- **Deliverables:** FSM module; tick event bus; FSM transition tests

### gdk-graphics — Visuals specialist
- **Goal:** Deliver the best-looking frame that fits the FPS budget: declared renderer/quality config, budgeted assets, instancing discipline.
- **Load skills:** gdk/gdk-graphics
- **Owns rules:** GFX.FPS-BUDGET, GFX.RENDER-SCALE, GFX.ASSET-BUDGET, GFX.LOD-DRAWCALL
- **Deliverables:** rendering config; scenes/materials within budget

### gdk-qa — Gatekeeper
- **Goal:** Run the GDK gates, drive scripted playtests, and block the build until every blocker/major rule passes.
- **Load skills:** gdk/gdk-qa
- **Owns rules:** QA.TESTS-PRESENT, QA.TESTS-PASS, QA.SPEC-COMPLETE, QA.PLAYTEST-SCRIPT
- **Deliverables:** gate report; playtest log; final verdict

