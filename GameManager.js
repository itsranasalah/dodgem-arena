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
