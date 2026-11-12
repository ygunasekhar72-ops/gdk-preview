# GDK Preview — before / after case study

Public demo for [GDK — Game Development Kit for AI agents](https://github.com/ygunasekhar72-ops/gdk).

The same game design ("Mini GTA": top-down open-world driving) built twice by AI agents:

- **`baseline/`** — built without GDK: one 1,041-line script, variable timestep, no spec, no tests, no gates. Plays fine; unverifiable.
- **`gdk/`** — built through the GDK pipeline: declared spec → generated team plan → phased build with exit gates → **acceptance PASS (18 rules green, 9 honest N/A skips)** + a 7-test headless proof suite.

Live: https://ygunasekhar72-ops.github.io/gdk-preview/

Both embeds are playable. The kit, the gate reports, and the process notes are in each folder.
