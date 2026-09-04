# Dodgem Arena

A top-down bumper-car arena built with **p5.js** for rendering and **Matter.js** for rigid-body physics. Four opponent modes, force-based driving, three pooled particle systems, and a set of autonomous opponents that hunt or flee you using classic Reynolds steering behaviours.

Built as Coursework 1 for **CM2030 Graphics Programming** (University of London, Goldsmiths).

<img width="1752" height="876" alt="image" src="https://github.com/user-attachments/assets/ee683b4a-75d4-4e34-a48e-14a60e18ce99" />

---

## Run it

No build step, no dependencies to install — the libraries are vendored in `libraries/`.

```bash
python -m http.server 8000
```

Then open <http://localhost:8000>. (Opening `index.html` straight from the filesystem also works in most browsers.)

## Controls

| Key | Action |
| --- | --- |
| `1` | Mode 1 — Practice, static opponents |
| `2` | Mode 2 — Random opponents, straight paths |
| `3` | Mode 3 — Advanced opponents, sine trajectories |
| `4` | Extension — Smart AI opponents (steering behaviours) |
| `i` | Arm the spawner, then **click inside the Start Zone** to insert your car |
| `↑` / `↓` | Throttle / reverse |
| `←` / `→` | Steer |

The Start Zone is the shaded band on the left. Clicks outside it, or too close to another car, are rejected with a message on the HUD instead of spawning you on top of someone.

---

## How it works

### Physics

Every car and wall is a real Matter.js body. The view is top-down, so **world gravity is disabled** and road grip is modelled with per-body `frictionAir` rather than a gravity-driven normal force. The arena perimeter is four static rectangles with high restitution (`0.9`) and low friction, so cars rebound crisply off a hard rink wall instead of sticking to it.

Two car types give a genuine difference in feel:

| Type | Density | Air drag | Max speed | Character |
| --- | --- | --- | --- | --- |
| `standard` | 0.0016 | 0.07 | 9.0 | Light, responsive, quick |
| `slow` | 0.0042 | 0.14 | 4.6 | Heavy, lazy off the line, shoves hard |

Throttle is force-based, and the applied force is **multiplied by body mass** so the resulting *acceleration* matches the engine profile rather than being diluted by weight. A per-frame `clampSpeed()` caps forward and reverse velocity. Steering scales angular velocity by speed, so a parked car barely turns while a moving car carves — cheap, but it reads as real steering.

Physics runs on a fixed 60 Hz timestep, which keeps the simulation frame-rate independent.

### Opponent behaviour

- **Mode 1** — opponents are parked static bodies inside the Start Zone. Good for learning the handling.
- **Mode 2** — each opponent gets a fixed random heading and holds an approximately constant speed. Hitting a barrier flips the heading 180°; a car–car hit rotates each opponent ±90°, then it carries on.
- **Mode 3** — same spawn, but each heading oscillates sinusoidally around its base (`baseHeading + sin(t)·amp`), producing smooth S-shaped paths.
- **Extension (`4`)** — see below.

All random spawns use rejection sampling with a minimum-gap check, so cars never start overlapping.

### Animations

`AnimationSystem` pools three particle types, each with its own spawn/update/draw pass:

- **Motion Trail** — fading car-shaped ghosts whose opacity scales with speed.
- **Impact Flash** — an additively-blended expanding ring plus radial sparks, placed at the exact collision support point reported by Matter.js.
- **Barrier Pulse** — an expanding ripple that briefly tints the struck wall segment.

Trails and pulses draw beneath the cars; flashes draw on top so impacts read as bright sparks.

### The extension: smart AI opponents

`SteeringAI` blends weighted Reynolds behaviours into a single desired-velocity vector:

- **Pursuit** — `standard` cars are *hunters*: they chase the player's **predicted** position (`position + velocity × lookahead`), with an arrival ease-off so they don't jitter on top of you.
- **Evasion** — `slow` cars are *evaders*: they flee that same predicted point.
- **Wall avoidance** and **separation** are layered on so nobody wedges in a corner or piles up.

The blend is *limited* rather than normalised to cruise speed, so when behaviours cancel a car settles instead of buzzing between directions. The result is applied by steering the car's Matter.js velocity toward it — the behaviour still runs entirely through the physics engine, never by teleporting bodies. What comes out is an emergent multi-agent chase built from a handful of vector rules, with no scripted paths anywhere.

---

## File map

| File | Role |
| --- | --- |
| `sketch.js` | Entry point: engine setup, input wiring, draw loop, HUD, responsive canvas |
| `Arena.js` | Perimeter barriers, Start Zone geometry, floor rendering, wall flash |
| `Car.js` | One car: body, force-based driving, speed clamp, layered top-down rendering |
| `GameManager.js` | Mode selection, roster, arm-and-click spawning, opponent driving, collision policy |
| `SteeringAI.js` | The extension — pursuit, evasion, wall avoidance, separation |
| `Animations.js` | Trail / flash / pulse particle systems |
| `libraries/` | Vendored p5.js and Matter.js |

`merged.js` is every class concatenated into one file, and `index (4).html` is a single-file obfuscated bundle — both are submission artefacts, not the source you want to read or edit.

## Notes

The canvas is a fixed 1400×700 simulation surface scaled with CSS to fit the window, so the physics always runs at native resolution regardless of screen size. Matter.js gravity is written to both `world.gravity` and `engine.gravity` so the sketch works across 0.14 and 0.19 builds.
