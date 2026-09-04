// ============================================================================
// sketch.js — CM2030 Graphics Programming, Coursework 1: Dodgem Arena.
// Entry point: sets up matter.js + p5, wires global input, draws each frame,
// and renders the HUD. Simulation logic lives in the supporting classes
// (Arena, Car, AnimationSystem, SteeringAI, GameManager).
//
// >>> COMMENTARY is at the very bottom of this file. <<<
// ============================================================================

const ARENA_W = 1400;
const ARENA_H = 700;

// Number of opponent cars (per brief: defined as a global variable).
var carNumbers = 4;

let engine, world;
let arena, manager, anim;
let cnv;
let statusMsg = 'Select a mode (1/2/3 or 4 = AI). Press "i", then click the Start Zone.';

function setup() {
  cnv = createCanvas(ARENA_W, ARENA_H);
  fitCanvasToWindow();

  // Matter.js engine. Top-down view => no gravity; the floor "grip" is modelled
  // with per-body frictionAir rather than a gravity-driven normal force.
  engine = Matter.Engine.create();
  world = engine.world;
  // Top-down view => disable gravity. Written to work across matter.js versions:
  // older builds (e.g. 0.14) store gravity on world.gravity, newer ones (0.19)
  // also expose engine.gravity. Setting both keeps the sketch portable.
  world.gravity.x = 0;
  world.gravity.y = 0;
  if (engine.gravity) {
    engine.gravity.x = 0;
    engine.gravity.y = 0;
  }

  arena = new Arena(world, ARENA_W, ARENA_H);
  anim = new AnimationSystem();
  manager = new GameManager(world, arena, anim);

  // Route matter.js collision events to the manager (policy) and animations.
  Matter.Events.on(engine, 'collisionStart', (e) => manager.handleCollisions(e.pairs));

  manager.startMode(1);
  textFont('Arial');
}

function draw() {
  // Fixed-timestep physics update (60 Hz) keeps the simulation deterministic.
  Matter.Engine.update(engine, 1000 / 60);

  background(14, 17, 22);
  arena.update();
  manager.update();
  anim.update();

  // Layered render order: floor -> trails/pulses -> cars -> barriers -> flashes.
  arena.drawFloor();
  anim.drawBackground();
  manager.drawCars();
  arena.drawBarriers();
  anim.drawForeground();

  drawHUD();
}

// ----------------------------------------------------------------------------
// Input
// ----------------------------------------------------------------------------

function keyPressed() {
  if (key === '1') manager.startMode(1);
  else if (key === '2') manager.startMode(2);
  else if (key === '3') manager.startMode(3);
  else if (key === '4') manager.startMode('ai');     // creative extension
  else if (key === 'i' || key === 'I') {
    manager.arm();
    statusMsg = 'Armed — click inside the Start Zone to insert your car.';
  }
}

function mousePressed() {
  // p5 maps mouseX/mouseY to canvas coordinates even when the canvas is
  // CSS-scaled, so no manual rescaling is needed here.
  if (mouseX < 0 || mouseX > ARENA_W || mouseY < 0 || mouseY > ARENA_H) return;
  const result = manager.trySpawnPlayer(mouseX, mouseY);
  statusMsg = result.msg;
}

// ----------------------------------------------------------------------------
// HUD
// ----------------------------------------------------------------------------

function drawHUD() {
  push();
  // Top banner.
  noStroke();
  fill(0, 0, 0, 150);
  rect(arena.wall, arena.wall, 560, 92, 8);

  fill(255);
  textAlign(LEFT, TOP);
  textStyle(BOLD);
  textSize(20);
  text(manager.modeName(), arena.wall + 14, arena.wall + 12);

  textStyle(NORMAL);
  textSize(13);
  fill(210);
  text('Keys: 1/2/3 modes · 4 = Smart-AI · i then click Start Zone to spawn',
       arena.wall + 14, arena.wall + 42);
  text('Drive: ↑ throttle  ↓ reverse  ← → steer', arena.wall + 14, arena.wall + 62);

  // Status line (bottom-left).
  fill(255, 235, 120);
  textSize(14);
  textAlign(LEFT, BOTTOM);
  text(statusMsg, arena.wall + 6, ARENA_H - arena.wall - 8);

  // Armed indicator pulsing over the Start Zone.
  if (manager.armed) {
    const z = arena.startZone;
    const a = 120 + 100 * sin(millis() / 150);
    noFill();
    stroke(255, 230, 90, a);
    strokeWeight(4);
    rect(z.x + 4, z.y + 4, z.w - 8, z.h - 8, 6);
  }
  pop();
}

// ----------------------------------------------------------------------------
// Responsive canvas: scale the fixed 1400×700 surface to fit the window while
// preserving aspect ratio (the simulation always runs at native resolution).
// ----------------------------------------------------------------------------

function fitCanvasToWindow() {
  const s = Math.min(windowWidth / ARENA_W, windowHeight / ARENA_H, 1);
  cnv.style('width', (ARENA_W * s) + 'px');
  cnv.style('height', (ARENA_H * s) + 'px');
}

function windowResized() {
  fitCanvasToWindow();
}

// ============================================================================
// COMMENTARY (≤ 500 words)
// ----------------------------------------------------------------------------
// 1. PHYSICS. All bodies are matter.js rigid bodies. The arena is four static
// rectangles forming a thick perimeter; barriers use high restitution (0.9) and
// low friction so cars rebound crisply, like a hard rink wall. Because the view
// is top-down, world gravity is disabled and the "road grip" that slows a
// coasting car is modelled with per-body frictionAir. The two car types differ
// in mass and drag, giving a meaningful feel difference: "standard" cars are
// light (density 0.0016), low-drag and fast (max speed 9); "slow" cars are
// heavy (density 0.0042), high-drag and capped at 4.6, so they shove hard but
// accelerate lazily. Throttle is force-based: applyThrottle() adds a force along
// the heading each frame, and crucially the force is multiplied by the body mass
// so the resulting ACCELERATION matches the engine profile rather than being
// diluted by weight. A per-frame clampSpeed() caps forward and reverse velocity.
// Steering sets angular velocity scaled by speed, so a near-stationary car
// barely turns while a moving car carves — a cheap but convincing handling model.
//
// 2. OPPONENT LOGIC. Mode 2 gives each opponent a fixed random heading and
// drives it with driveAlongHeading(), which blends its matter.js velocity toward
// heading×cruiseSpeed — holding an approximately constant speed (frame-rate
// stable) while still being perturbed by collision impulses for a few frames.
// On barrier contact the heading flips 180°; on car–car
// contact each opponent rotates ±90°, then resumes. Mode 3 reuses the random
// spawn but oscillates each heading sinusoidally (baseHeading + sin(t)·amp),
// producing smooth S-shaped paths at roughly constant speed. All spawns use
// rejection sampling with a minimum-gap separation check to guarantee no overlap.
//
// 3. ANIMATIONS. AnimationSystem pools three particle types, each with spawn/
// update/draw functions. Motion Trail emits fading car-shaped ghosts whose
// opacity scales with speed. Impact Flash spawns an additively-blended expanding
// ring plus radial sparks at the exact collision support point. Barrier Pulse
// emits an expanding ripple and briefly tints the struck wall segment. Trails and
// pulses draw beneath the cars; flashes draw on top for a bright spark read.
//
// 4. EXTENSION — SMART AI OPPONENTS (key 4). This applies the module's vector/
// force foundations directly. SteeringAI blends Reynolds behaviours into a
// desired-velocity vector: "standard" cars are HUNTERS that pursue the player's
// predicted future position (position + velocity×lookahead); "slow" cars are
// EVADERS that flee that same point. Both add weighted wall-avoidance and
// neighbour separation so they never wedge or pile up. The result is applied by
// steering each car's matter.js velocity toward it via steerToVelocity(), and
// faceVelocity() points each car where it travels. It is more interesting than
// scoring because it is an
// emergent multi-agent system: predictive pursuit/evasion plus avoidance create
// lifelike chases that arise from simple vector rules rather than scripted paths.
// ============================================================================
