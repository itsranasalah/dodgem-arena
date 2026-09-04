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
