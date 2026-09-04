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
