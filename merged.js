// ============================================================================
// Animations.js — three self-contained visual-feedback systems, each with its
// own spawn / update / draw functions:
//   • Motion Trail  — speed-dependent fading ghosts behind moving cars.
//   • Impact Flash  — a spark ring at the point of a car–car collision.
//   • Barrier Pulse — an expanding ripple where a car strikes a wall.
//
// All live particles are pooled in arrays and culled when their life expires.
// Background layers (trails, pulses) draw beneath the cars; the foreground
// layer (flashes) draws on top.
// ============================================================================

class AnimationSystem {
  constructor() {
    this.trails = [];
    this.flashes = [];
    this.pulses = [];
  }

  // --- Motion Trail ----------------------------------------------------------

  // Emit a fading ghost of the car. Emission opacity scales with speed, so slow
  // cars leave a barely-there trail and fast cars a vivid one.
  spawnTrail(car) {
    const speed = car.speed;
    if (speed < 1.2) return;
    const intensity = constrain(map(speed, 1.2, 9, 0.08, 0.5), 0, 0.5);
    this.trails.push({
      x: car.pos.x, y: car.pos.y, angle: car.angle,
      w: car.w, h: car.h,
      col: car.bodyColor,
      life: 1, decay: 0.045, alpha0: intensity
    });
  }

  // --- Impact Flash ----------------------------------------------------------

  spawnFlash(x, y, strength) {
    const sparks = [];
    const n = floor(map(strength, 0, 1, 6, 16));
    for (let i = 0; i < n; i++) {
      const a = random(TWO_PI);
      const sp = random(2, 5) * (0.5 + strength);
      sparks.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1 });
    }
    this.flashes.push({
      x, y, r: 4, maxR: 30 + strength * 50, life: 1, sparks
    });
  }

  // --- Barrier Pulse ---------------------------------------------------------

  spawnPulse(x, y, side) {
    this.pulses.push({
      x, y, side, r: 6, maxR: 80, life: 1
    });
  }

  // --- Update ----------------------------------------------------------------

  update() {
    for (let i = this.trails.length - 1; i >= 0; i--) {
      this.trails[i].life -= this.trails[i].decay;
      if (this.trails[i].life <= 0) this.trails.splice(i, 1);
    }
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.life -= 0.06;
      f.r = lerp(f.r, f.maxR, 0.25);
      for (const s of f.sparks) {
        s.x += s.vx; s.y += s.vy;
        s.vx *= 0.9; s.vy *= 0.9;
        s.life -= 0.06;
      }
      if (f.life <= 0) this.flashes.splice(i, 1);
    }
    for (let i = this.pulses.length - 1; i >= 0; i--) {
      const p = this.pulses[i];
      p.life -= 0.05;
      p.r = lerp(p.r, p.maxR, 0.18);
      if (p.life <= 0) this.pulses.splice(i, 1);
    }
  }

  // --- Draw: background (under cars) -----------------------------------------

  drawBackground() {
    push();
    noStroke();
    // Trails.
    rectMode(CENTER);
    for (const t of this.trails) {
      push();
      translate(t.x, t.y);
      rotate(t.angle);
      fill(red(t.col), green(t.col), blue(t.col), 255 * t.alpha0 * t.life);
      rect(0, 0, t.w, t.h, 8);
      pop();
    }
    // Barrier pulses (ripple rings).
    noFill();
    for (const p of this.pulses) {
      stroke(255, 180, 70, 220 * p.life);
      strokeWeight(3 * p.life + 1);
      ellipse(p.x, p.y, p.r * 2, p.r * 2);
    }
    pop();
  }

  // --- Draw: foreground (over cars) ------------------------------------------

  drawForeground() {
    push();
    // Impact flash rings + sparks, drawn additively for a bright spark look.
    blendMode(ADD);
    for (const f of this.flashes) {
      noFill();
      stroke(255, 230, 150, 220 * f.life);
      strokeWeight(3 * f.life + 1);
      ellipse(f.x, f.y, f.r * 2, f.r * 2);
      noStroke();
      for (const s of f.sparks) {
        fill(255, 220, 140, 230 * max(0, s.life));
        ellipse(s.x, s.y, 4, 4);
      }
    }
    blendMode(BLEND);
    pop();
  }
}
// ============================================================================
// Arena.js — the dodgem arena: perimeter barriers (matter.js) + the Start Zone.
// The arena owns four static bodies forming a thick, hard rectangular boundary
// and provides geometry helpers used by spawning/validation logic.
// ============================================================================

class Arena {
  constructor(world, w, h) {
    this.world = world;
    this.w = w;                 // 1400
    this.h = h;                 // 700
    this.wall = 42;             // barrier thickness (px)
    this.startZoneW = 300;      // width of the left-hand Start Zone

    // Inner play rectangle (the drivable floor, inside the barriers).
    this.inner = {
      x: this.wall,
      y: this.wall,
      w: this.w - this.wall * 2,
      h: this.h - this.wall * 2
    };

    // Start Zone rectangle (a band on the left of the inner area).
    this.startZone = {
      x: this.inner.x,
      y: this.inner.y,
      w: this.startZoneW,
      h: this.inner.h
    };

    this.barriers = [];
    this.buildBarriers();

    // Transient visual feedback: barrier segments briefly tint after a pulse.
    this.glowTop = 0;
    this.glowBottom = 0;
    this.glowLeft = 0;
    this.glowRight = 0;
  }

  // Create the four static perimeter walls as matter.js bodies. They are hard
  // surfaces, so restitution is high and friction low (cars skid off, not stick).
  buildBarriers() {
    const t = this.wall;
    const opts = { isStatic: true, restitution: 0.9, friction: 0.05, label: 'barrier' };

    const top = Matter.Bodies.rectangle(this.w / 2, t / 2, this.w, t, opts);
    const bottom = Matter.Bodies.rectangle(this.w / 2, this.h - t / 2, this.w, t, opts);
    const left = Matter.Bodies.rectangle(t / 2, this.h / 2, t, this.h, opts);
    const right = Matter.Bodies.rectangle(this.w - t / 2, this.h / 2, t, this.h, opts);

    top.side = 'top';
    bottom.side = 'bottom';
    left.side = 'left';
    right.side = 'right';

    this.barriers = [top, bottom, left, right];
    for (const b of this.barriers) {
      b.isBarrier = true;
      Matter.World.add(this.world, b);
    }
  }

  // Trigger the transient colour shift used by the Barrier Pulse animation.
  flashSide(side) {
    if (side === 'top') this.glowTop = 1;
    else if (side === 'bottom') this.glowBottom = 1;
    else if (side === 'left') this.glowLeft = 1;
    else if (side === 'right') this.glowRight = 1;
  }

  // --- Geometry helpers used by spawn validation -----------------------------

  isInsideArena(x, y) {
    return x > this.inner.x && x < this.inner.x + this.inner.w &&
           y > this.inner.y && y < this.inner.y + this.inner.h;
  }

  isInsideStartZone(x, y) {
    const z = this.startZone;
    return x > z.x && x < z.x + z.w && y > z.y && y < z.y + z.h;
  }

  update() {
    // Decay barrier glow back to neutral.
    this.glowTop = max(0, this.glowTop - 0.04);
    this.glowBottom = max(0, this.glowBottom - 0.04);
    this.glowLeft = max(0, this.glowLeft - 0.04);
    this.glowRight = max(0, this.glowRight - 0.04);
  }

  // Draw the floor and Start Zone (called before cars).
  drawFloor() {
    // Arena floor with a subtle radial vignette for depth.
    push();
    noStroke();
    fill(38, 42, 50);
    rect(0, 0, this.w, this.h);

    // Floor grid for a "rink" feel.
    stroke(48, 53, 62);
    strokeWeight(1);
    const step = 70;
    for (let x = this.inner.x; x <= this.inner.x + this.inner.w; x += step) {
      line(x, this.inner.y, x, this.inner.y + this.inner.h);
    }
    for (let y = this.inner.y; y <= this.inner.y + this.inner.h; y += step) {
      line(this.inner.x, y, this.inner.x + this.inner.w, y);
    }

    // Start Zone shading.
    const z = this.startZone;
    noStroke();
    fill(120, 200, 230, 60);
    rect(z.x, z.y, z.w, z.h);
    // Hatched edge / divider line on the right of the zone.
    stroke(150, 215, 240, 180);
    strokeWeight(3);
    line(z.x + z.w, z.y, z.x + z.w, z.y + z.h);

    // "START ZONE" vertical label.
    push();
    translate(z.x + z.w * 0.5, z.y + z.h * 0.5);
    rotate(-HALF_PI);
    noStroke();
    fill(235, 245, 250, 220);
    textAlign(CENTER, CENTER);
    textStyle(BOLD);
    textSize(34);
    text('START ZONE', 0, 0);
    pop();
    pop();
  }

  // Draw the perimeter barriers (called after the floor; cars sit on top).
  drawBarriers() {
    push();
    noStroke();
    const base = color(28, 31, 38);

    this.drawWall(0, 0, this.w, this.wall, base, this.glowTop);                          // top
    this.drawWall(0, this.h - this.wall, this.w, this.wall, base, this.glowBottom);      // bottom
    this.drawWall(0, 0, this.wall, this.h, base, this.glowLeft);                         // left
    this.drawWall(this.w - this.wall, 0, this.wall, this.h, base, this.glowRight);       // right

    // Hazard stripes along the inner edge of the barrier for a fairground look.
    this.drawHazardStripes();
    pop();
  }

  drawWall(x, y, w, h, base, glow) {
    // Glow lerps the barrier toward a warm highlight when recently struck.
    const c = lerpColor(base, color(255, 170, 60), glow);
    fill(c);
    rect(x, y, w, h);
    // Inner bevel highlight along the leading edge.
    fill(255, 255, 255, 18);
    rect(x, y, w, min(h, 5));
  }

  drawHazardStripes() {
    const t = this.wall;
    const stripe = 26;
    push();
    strokeWeight(0);
    for (let x = 0; x < this.w; x += stripe * 2) {
      fill(245, 200, 40, 70);
      // top inner edge
      rect(x, t - 6, stripe, 6);
      // bottom inner edge
      rect(x + stripe, this.h - t, stripe, 6);
    }
    for (let y = 0; y < this.h; y += stripe * 2) {
      fill(245, 200, 40, 70);
      rect(t - 6, y + stripe, 6, stripe);                 // left inner edge
      rect(this.w - t, y, 6, stripe);                     // right inner edge
    }
    pop();
  }
}
// ============================================================================
// Car.js — a dodgem car. Each car wraps a single matter.js rigid body and adds
// driving behaviour (force-based throttle + steering), a max-velocity clamp,
// and a layered top-down drawing that reacts to motion (headlights, brake
// lights, squash on impact).
//
// Two physical types are supported:
//   'standard' — light, responsive, fast.
//   'slow'     — heavier, more air-drag, lower top speed and weaker engine.
// ============================================================================

class Car {
  constructor(world, x, y, opts = {}) {
    this.world = world;
    this.type = opts.type || 'standard';
    this.isPlayer = opts.isPlayer || false;
    this.label = opts.label || 'C';
    this.role = opts.role || null;          // 'hunter' | 'evader' for the AI extension
    this.bodyColor = opts.color || color(70, 130, 240);

    // Footprint.
    this.w = 50;
    this.h = 30;

    // Per-type physical parameters. Heavier density => more momentum in
    // collisions; higher frictionAir => quicker slow-down (sluggish feel).
    const profile = (this.type === 'slow')
      ? { density: 0.0042, frictionAir: 0.14, restitution: 0.35, maxSpeed: 4.6, engine: 0.85 }
      : { density: 0.0016, frictionAir: 0.07, restitution: 0.5,  maxSpeed: 9.0, engine: 1.0 };

    this.maxSpeed = profile.maxSpeed;
    this.engine = profile.engine;           // throttle strength multiplier

    this.body = Matter.Bodies.rectangle(x, y, this.w, this.h, {
      density: profile.density,
      frictionAir: profile.frictionAir,
      friction: 0.04,
      restitution: profile.restitution,
      chamfer: { radius: 8 },
      angle: opts.angle || 0,
      label: 'car'
    });
    this.body.gameRef = this;               // back-reference for collision routing
    this.body.isCar = true;
    Matter.World.add(this.world, this.body);

    // Driving / animation state.
    this.throttleInput = 0;                 // -1 reverse, 0, +1 forward (player)
    this.steerInput = 0;                    // -1 left, 0, +1 right (player)
    this.cruiseSpeed = 0;                   // target speed for self-driving opponents
    this.squash = 0;                        // 0..1 impact squash, decays each frame
    this.headingNoiseSeed = random(1000);   // used by Mode 3 sine trajectory
  }

  // --- Convenience accessors -------------------------------------------------

  get pos() { return this.body.position; }
  get angle() { return this.body.angle; }
  get speed() { return Matter.Vector.magnitude(this.body.velocity); }
  forward() { return { x: Math.cos(this.angle), y: Math.sin(this.angle) }; }

  // --- Player-style force-based driving --------------------------------------

  // Apply throttle as a force along the car's heading. Force is scaled by mass
  // so the *acceleration* matches the engine profile regardless of body weight.
  applyThrottle() {
    if (this.throttleInput === 0) return;
    const accel = 0.0019 * this.engine * this.throttleInput;
    const f = this.forward();
    Matter.Body.applyForce(this.body, this.pos, {
      x: f.x * accel * this.body.mass,
      y: f.y * accel * this.body.mass
    });
  }

  // Steering rotates the body; rate eases with speed so a parked car barely
  // turns while a moving car carves — closer to real steering.
  applySteering() {
    if (this.steerInput !== 0) {
      const grip = constrain(this.speed / 3, 0.25, 1.4);
      Matter.Body.setAngularVelocity(this.body, this.steerInput * 0.06 * grip);
    } else {
      // Damp residual spin so the car settles to a straight line.
      Matter.Body.setAngularVelocity(this.body, this.body.angularVelocity * 0.85);
    }
  }

  // Clamp speed to the per-type maximum (applies to forward and reverse alike).
  clampSpeed() {
    const s = this.speed;
    if (s > this.maxSpeed) {
      const k = this.maxSpeed / s;
      Matter.Body.setVelocity(this.body, {
        x: this.body.velocity.x * k,
        y: this.body.velocity.y * k
      });
    }
  }

  // --- Self-driving helpers (opponents) --------------------------------------

  // Steer the velocity toward (heading * cruiseSpeed). Used by Modes 2/3 so
  // opponents hold an approximately constant speed yet still react to impacts.
  driveAlongHeading() {
    this.blendVelocityToward(
      Math.cos(this.angle) * this.cruiseSpeed,
      Math.sin(this.angle) * this.cruiseSpeed
    );
  }

  // Smoothly blend the body's velocity toward a desired velocity vector.
  // Self-driving opponents steer this way (rather than via raw forces) so the
  // motion is frame-rate stable and holds an approximately constant speed,
  // while collision impulses still perturb the car for a few frames.
  blendVelocityToward(vx, vy, k = 0.12) {
    Matter.Body.setVelocity(this.body, {
      x: this.body.velocity.x + (vx - this.body.velocity.x) * k,
      y: this.body.velocity.y + (vy - this.body.velocity.y) * k
    });
  }

  // Push the car's velocity toward an arbitrary desired velocity vector.
  // Used by the steering-AI extension.
  steerToVelocity(vx, vy, k = 0.12) {
    this.blendVelocityToward(vx, vy, k);
  }

  // Collision-policy responses for opponents.
  reverseHeading() {           // barrier contact: flip 180°
    Matter.Body.setAngle(this.body, this.angle + PI);
  }
  turn90(sign) {               // car–car contact: rotate ±90°
    Matter.Body.setAngle(this.body, this.angle + sign * HALF_PI);
  }

  // Turn the car gradually toward its direction of travel (used by the AI
  // extension). Easing the angle — rather than snapping it — stops the twitchy
  // spinning that happens when the steering vector changes direction quickly.
  faceVelocity(turn = 0.18) {
    if (this.speed > 0.4) {
      const target = Math.atan2(this.body.velocity.y, this.body.velocity.x);
      let diff = target - this.body.angle;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));   // shortest signed turn
      Matter.Body.setAngle(this.body, this.body.angle + diff * turn);
    }
  }

  registerImpact(strength) {
    this.squash = min(1, this.squash + strength);
  }

  // --- Per-frame update ------------------------------------------------------

  update() {
    this.clampSpeed();
    this.squash = max(0, this.squash - 0.06);
  }

  // --- Drawing ---------------------------------------------------------------

  display() {
    const p = this.pos;
    push();
    translate(p.x, p.y);

    // Ground shadow (drawn before rotating so it stays axis-aligned-ish).
    noStroke();
    fill(0, 0, 0, 60);
    ellipse(4, 6, this.w * 1.05, this.h * 1.05);

    rotate(this.angle);

    // Squash & stretch on impact: widen across the hit, shorten along travel.
    const sx = 1 - this.squash * 0.18;
    const sy = 1 + this.squash * 0.18;
    scale(sx, sy);

    const moving = this.speed > 0.6;

    // Headlight beams when moving forward.
    if (moving && this.throttleInputForGlow() >= 0) {
      this.drawHeadlightBeams();
    }

    // Chassis (bumper ring) — a darker rounded rectangle slightly larger
    // than the body, giving the classic dodgem rubber bumper.
    fill(20, 22, 28);
    rectMode(CENTER);
    rect(0, 0, this.w + 8, this.h + 8, 12);

    // Main body with a vertical light gradient.
    this.drawBodyGradient();

    // Cabin / windshield.
    fill(30, 40, 55, 230);
    rect(2, 0, this.w * 0.42, this.h * 0.62, 6);
    fill(150, 200, 230, 180);
    rect(6, 0, this.w * 0.22, this.h * 0.52, 4);

    // Front headlights.
    fill(255, 245, 200);
    ellipse(this.w * 0.46, -this.h * 0.28, 7, 6);
    ellipse(this.w * 0.46, this.h * 0.28, 7, 6);

    // Rear brake lights — glow red when braking/reversing.
    const braking = this.throttleInput < 0;
    fill(braking ? color(255, 60, 50) : color(150, 40, 40));
    ellipse(-this.w * 0.46, -this.h * 0.26, 6, 5);
    ellipse(-this.w * 0.46, this.h * 0.26, 6, 5);

    // Wheels.
    fill(15);
    rect(this.w * 0.28, -this.h * 0.5, 12, 6, 2);
    rect(this.w * 0.28, this.h * 0.5, 12, 6, 2);
    rect(-this.w * 0.28, -this.h * 0.5, 12, 6, 2);
    rect(-this.w * 0.28, this.h * 0.5, 12, 6, 2);

    // Player ring highlight so the player is instantly identifiable.
    if (this.isPlayer) {
      noFill();
      stroke(255, 235, 90);
      strokeWeight(3);
      ellipse(0, 0, this.w + 26, this.h + 26);
      noStroke();
    }

    // Label (un-rotate so text stays upright).
    rotate(-this.angle);
    fill(255);
    textAlign(CENTER, CENTER);
    textStyle(BOLD);
    textSize(13);
    text(this.label, 0, 0);

    pop();

    // AI extension: hunters draw a faint targeting line to their prey.
    if (this.aiTargetPos) {
      push();
      stroke(red(this.bodyColor), green(this.bodyColor), blue(this.bodyColor), 70);
      strokeWeight(1.5);
      line(p.x, p.y, this.aiTargetPos.x, this.aiTargetPos.y);
      pop();
    }
  }

  throttleInputForGlow() {
    // Opponents have throttleInput 0 but are moving; treat them as forward.
    return this.isPlayer ? this.throttleInput : 1;
  }

  drawHeadlightBeams() {
    const reach = 70 + this.speed * 6;
    noStroke();
    for (const off of [-this.h * 0.28, this.h * 0.28]) {
      fill(255, 240, 180, 38);
      triangle(this.w * 0.46, off,
               this.w * 0.46 + reach, off - 26,
               this.w * 0.46 + reach, off + 26);
    }
  }

  drawBodyGradient() {
    const top = lerpColor(this.bodyColor, color(255), 0.28);
    const bot = lerpColor(this.bodyColor, color(0), 0.28);
    const steps = 10;
    rectMode(CENTER);
    noStroke();
    for (let i = 0; i < steps; i++) {
      const t = i / (steps - 1);
      fill(lerpColor(top, bot, t));
      const segH = this.h / steps;
      rect(0, -this.h / 2 + segH * (i + 0.5), this.w, segH + 1, i === 0 || i === steps - 1 ? 8 : 0);
    }
  }

  remove() {
    Matter.World.remove(this.world, this.body);
  }
}
// ============================================================================
// GameManager.js — orchestrates the simulation: the active mode, the roster of
// cars, the arm-and-click player spawn, opponent driving per mode, and the
// collision-response policy. Keeps sketch.js thin.
//
// Opponent roster (all modes): carNumbers cars, "two of each type" —
// half "standard", half "slow", per the brief.
// ============================================================================

class GameManager {
  constructor(world, arena, anim) {
    this.world = world;
    this.arena = arena;
    this.anim = anim;

    this.cars = [];
    this.player = null;
    this.mode = 1;
    this.armed = false;        // set by pressing 'i'; consumed by a valid click

    // Palette for opponents (player gets its own highlighted colour).
    this.palette = [
      [70, 200, 90], [230, 90, 200], [80, 150, 255],
      [60, 200, 220], [240, 150, 40], [200, 80, 80]
    ];
  }

  // --- Mode selection --------------------------------------------------------

  startMode(n) {
    this.mode = n;
    this.clearCars();
    this.armed = false;

    if (n === 1) this.spawnStaticOpponents();
    else this.spawnRandomOpponents(n === 'ai');   // modes 2, 3 and the AI extension
  }

  modeName() {
    if (this.mode === 1) return 'Mode 1 — Practice (static opponents)';
    if (this.mode === 2) return 'Mode 2 — Random Opponents (straight paths)';
    if (this.mode === 3) return 'Mode 3 — Advanced Opponents (sine trajectories)';
    if (this.mode === 'ai') return 'Extension — Smart AI Opponents (steering behaviours)';
    return '';
  }

  clearCars() {
    for (const c of this.cars) c.remove();
    this.cars = [];
    this.player = null;
  }

  // --- Opponent type/colour assignment ---------------------------------------

  // Two of each type: first half "standard", second half "slow".
  typeForIndex(i) {
    return (i < Math.floor(carNumbers / 2)) ? 'standard' : 'slow';
  }

  // For the AI extension: standard cars hunt, slow cars evade.
  roleForType(type) {
    return (type === 'standard') ? 'hunter' : 'evader';
  }

  // --- Spawning --------------------------------------------------------------

  // Mode 1: opponents parked (static) in a column inside the Start Zone.
  spawnStaticOpponents() {
    const z = this.arena.startZone;
    const gap = z.h / (carNumbers + 1);
    for (let i = 0; i < carNumbers; i++) {
      const type = this.typeForIndex(i);
      const car = new Car(this.world, z.x + z.w * 0.62, z.y + gap * (i + 1), {
        type,
        color: color(...this.palette[i % this.palette.length]),
        label: 'C' + (i + 1),
        angle: 0
      });
      Matter.Body.setStatic(car.body, true);
      this.cars.push(car);
    }
  }

  // Modes 2 / 3 / AI: opponents at random, non-overlapping positions with
  // random headings and initial motion. `ai` assigns hunter/evader roles.
  spawnRandomOpponents(ai) {
    for (let i = 0; i < carNumbers; i++) {
      const type = this.typeForIndex(i);
      const spot = this.findFreeSpot();
      if (!spot) break;
      const heading = random(TWO_PI);
      const car = new Car(this.world, spot.x, spot.y, {
        type,
        color: color(...this.palette[i % this.palette.length]),
        label: 'C' + (i + 1),
        angle: heading,
        role: ai ? this.roleForType(type) : null
      });
      car.cruiseSpeed = (type === 'slow') ? 3.0 : 5.0;
      car.baseHeading = heading;
      // Start with motion along the heading.
      Matter.Body.setVelocity(car.body, {
        x: Math.cos(heading) * car.cruiseSpeed,
        y: Math.sin(heading) * car.cruiseSpeed
      });
      this.cars.push(car);
    }
  }

  // Rejection-sample a position inside the play area (right of the Start Zone)
  // that does not overlap existing cars. Returns null if it cannot place one.
  findFreeSpot() {
    const inner = this.arena.inner;
    const margin = 70;
    const minGap = 90;
    const xMin = this.arena.startZone.x + this.arena.startZone.w + margin;
    for (let attempt = 0; attempt < 200; attempt++) {
      const x = random(xMin, inner.x + inner.w - margin);
      const y = random(inner.y + margin, inner.y + inner.h - margin);
      if (this.spotIsFree(x, y, minGap)) return { x, y };
    }
    return null;
  }

  spotIsFree(x, y, minGap) {
    for (const c of this.cars) {
      if (dist(x, y, c.pos.x, c.pos.y) < minGap) return false;
    }
    return true;
  }

  // --- Player spawn (arm + click) --------------------------------------------

  arm() { this.armed = true; }

  // Called on mouse click. Validates: armed, inside arena, inside Start Zone,
  // and not overlapping any existing car. Spawns the player on success.
  trySpawnPlayer(x, y) {
    if (!this.armed) return { ok: false, msg: 'Press "i" to arm, then click the Start Zone.' };
    if (!this.arena.isInsideArena(x, y)) return { ok: false, msg: 'Click inside the arena.' };
    if (!this.arena.isInsideStartZone(x, y)) return { ok: false, msg: 'Click inside the Start Zone.' };
    if (!this.spotIsFree(x, y, 80)) return { ok: false, msg: 'Too close to another car — pick a clear spot.' };

    const player = new Car(this.world, x, y, {
      type: 'standard',
      isPlayer: true,
      color: color(255, 210, 40),
      label: 'P',
      angle: 0
    });
    this.cars.push(player);
    this.player = player;
    this.armed = false;
    return { ok: true, msg: 'Player spawned — drive with the arrow keys.' };
  }

  // --- Per-frame update ------------------------------------------------------

  update() {
    const ctx = { player: this.player, cars: this.cars, arena: this.arena };

    for (const car of this.cars) {
      if (car.isPlayer) this.drivePlayer(car);
      else this.driveOpponent(car, ctx);
      car.update();
      this.anim.spawnTrail(car);
    }
  }

  drivePlayer(car) {
    car.throttleInput = (keyIsDown(UP_ARROW) ? 1 : 0) + (keyIsDown(DOWN_ARROW) ? -1 : 0);
    car.steerInput = (keyIsDown(RIGHT_ARROW) ? 1 : 0) + (keyIsDown(LEFT_ARROW) ? -1 : 0);
    car.applyThrottle();
    car.applySteering();
  }

  driveOpponent(car, ctx) {
    if (this.mode === 1) return;                         // static: parked

    if (this.mode === 2) {
      car.driveAlongHeading();                           // straight path
    } else if (this.mode === 3) {
      // Sine-wave trajectory: oscillate the heading around its base.
      const t = millis() / 1000;
      const target = car.baseHeading + Math.sin(t * 1.4 + car.headingNoiseSeed) * 0.6;
      Matter.Body.setAngle(car.body, target);
      car.driveAlongHeading();
    } else if (this.mode === 'ai') {
      const desired = SteeringAI.computeDesired(car, ctx);
      car.steerToVelocity(desired.x, desired.y, 0.07);   // lower gain = more inertia
      car.faceVelocity();
    }
  }

  // --- Collision policy ------------------------------------------------------

  handleCollisions(pairs) {
    for (const pair of pairs) {
      const a = pair.bodyA, b = pair.bodyB;
      const point = this.contactPoint(pair);

      if (a.isBarrier && b.isCar) this.carHitsBarrier(b.gameRef, a, point);
      else if (b.isBarrier && a.isCar) this.carHitsBarrier(a.gameRef, b, point);
      else if (a.isCar && b.isCar) this.carHitsCar(a.gameRef, b.gameRef, pair, point);
    }
  }

  carHitsBarrier(car, barrier, point) {
    this.anim.spawnPulse(point.x, point.y, barrier.side);
    this.arena.flashSide(barrier.side);
    car.registerImpact(0.5);
    // Self-driving straight/sine opponents reverse heading on barrier contact.
    if (!car.isPlayer && (this.mode === 2 || this.mode === 3)) {
      car.reverseHeading();
      car.baseHeading += PI;
    }
  }

  carHitsCar(a, b, pair, point) {
    const rel = Matter.Vector.magnitude(
      Matter.Vector.sub(a.body.velocity, b.body.velocity)
    );
    const strength = constrain(rel / 9, 0.15, 1);
    this.anim.spawnFlash(point.x, point.y, strength);
    a.registerImpact(strength);
    b.registerImpact(strength);

    // Car–car policy: rotate opponent heading by ±90°, then continue.
    if (this.mode === 2 || this.mode === 3) {
      if (!a.isPlayer) { const s = random() < 0.5 ? -1 : 1; a.turn90(s); a.baseHeading += s * HALF_PI; }
      if (!b.isPlayer) { const s = random() < 0.5 ? -1 : 1; b.turn90(s); b.baseHeading += s * HALF_PI; }
    }
    // In the AI mode the cars resolve contact through their steering instead.
  }

  contactPoint(pair) {
    const sup = pair.collision && pair.collision.supports;
    if (sup && sup.length > 0) return { x: sup[0].x, y: sup[0].y };
    return {
      x: (pair.bodyA.position.x + pair.bodyB.position.x) / 2,
      y: (pair.bodyA.position.y + pair.bodyB.position.y) / 2
    };
  }

  // --- Drawing ---------------------------------------------------------------

  drawCars() {
    for (const c of this.cars) c.display();
  }
}
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
// ============================================================================
// SteeringAI.js — CREATIVE EXTENSION.
//
// Autonomous "smart" opponents built from the vectors & forces taught in
// Topics 1–2. Each opponent computes a desired-velocity vector by blending
// classic Reynolds steering behaviours:
//   • Pursuit  — hunters predict the player's FUTURE position and chase it.
//   • Evasion  — evaders predict that same point and flee from it.
//   • Wall avoidance — steer back toward the floor when nearing a barrier.
//   • Separation     — push apart from nearby cars to avoid pile-ups.
//
// The blended result is returned as a desired velocity; the GameManager pushes
// each car's velocity toward it via Car.steerToVelocity(), so the behaviour is
// still expressed entirely through matter.js forces.
// ============================================================================

class SteeringAI {
  // How many frames ahead a hunter/evader predicts the player's motion.
  static get LOOKAHEAD() { return 16; }

  // Main entry point: returns a p5.Vector desired velocity for `car`.
  static computeDesired(car, ctx) {
    const pos = createVector(car.pos.x, car.pos.y);
    const cruise = car.maxSpeed * 0.85;

    const primary = this.targetBehaviour(car, ctx, pos, cruise);
    const walls = this.avoidWalls(pos, ctx.arena, cruise);
    const sep = this.separation(car, pos, ctx.cars, cruise);

    // Weighted blend. Crucially we clamp (limit) the result rather than forcing
    // it to full cruise speed, so when the behaviours cancel the car simply
    // slows and settles instead of buzzing in a flickering direction.
    const out = createVector(0, 0);
    out.add(p5.Vector.mult(primary, 1.0));
    out.add(p5.Vector.mult(walls, 1.6));
    out.add(p5.Vector.mult(sep, 0.9));

    out.limit(cruise);
    return out;
  }

  // Pursuit (hunter) / evasion (evader) of the player's predicted position.
  static targetBehaviour(car, ctx, pos, cruise) {
    const player = ctx.player;
    if (!player || player === car || !player.body) {
      car.aiTargetPos = null;
      // No prey yet: amble along the current heading.
      return createVector(Math.cos(car.angle), Math.sin(car.angle)).setMag(cruise * 0.6);
    }

    const pPos = createVector(player.pos.x, player.pos.y);
    const pVel = createVector(player.body.velocity.x, player.body.velocity.y);
    const future = p5.Vector.add(pPos, p5.Vector.mult(pVel, this.LOOKAHEAD));

    if (car.role === 'hunter') {
      car.aiTargetPos = { x: future.x, y: future.y };   // drives the targeting line
      const toTarget = p5.Vector.sub(future, pos);
      const d = toTarget.mag();
      if (d < 0.001) return createVector(0, 0);
      // Arrival: ease the speed down inside a slowing radius so the hunter
      // circles its prey gently instead of jamming and twitching on top of it.
      const slowR = 140;
      const speed = (d < slowR) ? map(d, 0, slowR, 0, cruise) : cruise;
      return toTarget.setMag(speed);
    }

    // Evader: only flee when the player is genuinely close; otherwise cruise
    // calmly so it does not jitter while the player is far away.
    car.aiTargetPos = null;
    const flee = p5.Vector.sub(pos, future);
    const d = flee.mag();
    const panicR = 260;
    if (d > panicR || d < 0.001) {
      return createVector(Math.cos(car.angle), Math.sin(car.angle)).setMag(cruise * 0.6);
    }
    return flee.setMag(cruise);
  }

  // Steer away from any barrier the car is approaching. The strength ramps
  // smoothly from zero at the margin edge to full cruise at the wall, so cars
  // riding near a wall do not judder as the force switches on and off.
  static avoidWalls(pos, arena, cruise) {
    const m = 150;
    const inner = arena.inner;
    const steer = createVector(0, 0);

    const left = (inner.x + m) - pos.x;
    const right = pos.x - (inner.x + inner.w - m);
    const top = (inner.y + m) - pos.y;
    const bottom = pos.y - (inner.y + inner.h - m);
    if (left > 0) steer.x += left;
    if (right > 0) steer.x -= right;
    if (top > 0) steer.y += top;
    if (bottom > 0) steer.y -= bottom;

    if (steer.mag() > 0) {
      const depth = constrain(steer.mag() / m, 0, 1);   // 0 at edge → 1 at wall
      steer.setMag(cruise * depth);
    }
    return steer;
  }

  // Average repulsion from neighbours, with strength scaled smoothly by how
  // close they are (full at contact, fading to zero at the edge of range).
  static separation(car, pos, cars, cruise) {
    const range = 90;
    const steer = createVector(0, 0);
    let count = 0;

    for (const other of cars) {
      if (other === car || !other.body) continue;
      const d = dist(pos.x, pos.y, other.pos.x, other.pos.y);
      if (d > 0 && d < range) {
        const away = createVector(pos.x - other.pos.x, pos.y - other.pos.y);
        away.setMag(map(d, 0, range, 1, 0));            // closer = stronger
        steer.add(away);
        count++;
      }
    }
    if (count > 0) {
      steer.div(count);
      const strength = constrain(steer.mag(), 0, 1);
      steer.setMag(cruise * strength);
    }
    return steer;
  }
}