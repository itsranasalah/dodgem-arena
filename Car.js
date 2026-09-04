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
