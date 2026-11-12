# Phase 5 · hardening — security audit notes (MINI GTA, GDK build)

Auditor: gdk-security playbook (adversary-in-residence), applied to a
single-player spec.

## Scope note
This spec is single-player (`multiplayer.enabled: false`). Network-facing rules
(NET.*; SEC.RATE-LIMIT / SANITIZE / TRANSPORT) are reported by the gate as
honest N/A skips — they were NOT audited as passing, they are out of scope.
The multiplayer arena template (godot/arena-mp) demonstrates those rules live.

## Threats audited
| Threat | Finding | Rule |
|---|---|---|
| Gameplay state decided outside the sim | Clean: `score`/wanted/checkpoint mutations exist only in `src/sim/sim.ts` (GDK:AUTHORITATIVE). Renderer and main read state; main's input mapping is the only input→sim path. | SEC.NEVER-TRUST-CLIENT |
| Secrets in the tree | Clean: no credential-shaped strings in src/tests/html/json (gate scan). | SEC.SECRETS-SCAN |
| Frame-timer gameplay logic | Clean: gameplay timing is tick-based; `performance.now()` is used only for the render loop and FPS meter. | LOG.EVENTS-DETERMINISTIC |
| Speedhack-style input abuse (local) | Clamped: `sanitizeInput` rejects NaN/non-finite and clamps to [-1,1]; car speed capped at CAR_MAX_SPEED_MPS — proven by the clamp test. | NET.INPUT-VALIDATE analog |
| Save/replay tampering surface | Sim state is plain data (LOG.SAVE-SAFE advisory) — serializable, no node refs. | LOG.SAVE-SAFE |

## Verdict
Exploitable paths (within single-player scope): none found. Local builds have
no trust boundary to enforce, but the authority discipline above is what makes
this codebase drop-in ready for server-authoritative multiplayer later.
