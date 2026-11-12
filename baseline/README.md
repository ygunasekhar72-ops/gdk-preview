# MINI GTA — top-down canvas demo

A small top-down open-city sandbox in pure HTML/JS/CSS. No build step, no
dependencies, no assets — everything is drawn procedurally on a canvas.

## Run

Open `index.html` in any modern browser (double-click works, `file://` is fine).

## Controls

| Key | Action |
| --- | --- |
| W / Up | Walk forward / accelerate |
| S / Down | Walk back / brake + reverse |
| A / Left | Walk left / steer left |
| D / Right | Walk right / steer right |
| E | Enter nearest car / exit current car |
| Space | Handbrake (drift) while driving |

## How to play

- Reach the glowing green checkpoint circles: +$500 each, a new one spawns elsewhere.
- Running over pedestrians raises your WANTED level (up to 5 stars) — police
  cars spawn from the map edges and ram you. Keep 560+ px away from every cop
  for 10 seconds to evade (stars reset, cops despawn).
- If the police stay in contact with you for ~2 seconds you are BUSTED:
  -$200 and you respawn on foot.
- Steal parked cars or traffic cars with E. Traffic stops for you and pedestrians;
  peds wander sidewalks and cross at corners.

City layout is generated from a fixed seed, so it is identical every run.
