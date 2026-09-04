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
