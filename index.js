/**
 * AUTOTHRASH — Adaptive Autonomous Navigation Web Twin
 * SIH 2026 | Full Real-Driving Behavior Engine
 *
 * DRIVING STATE MACHINE (exact real-world sequence):
 *   CRUISING → detect obstacle → DECELERATING → speed drops below threshold
 *   → scan for clear bypass → if bypass found: STEERING_AROUND (smooth lateral shift) → RESUMING
 *   → if no bypass: STOPPED_WAITING → obstacle moves / clears → STEERING_AROUND → RESUMING
 *
 * Road crossing ONLY permitted in "Village Road" and "Crowded Market Road".
 * BEV (bird's-eye view) canvas is displayed in a large dedicated side panel.
 */

(function () {
  'use strict';

  // ─────────────────────────────────────────────────────────────────────────
  //  CONSTANTS  (mirror config.py)
  // ─────────────────────────────────────────────────────────────────────────
  const FPS            = 30;
  const TIME_STEP      = 1.0 / FPS;
  const ROAD_WIDTH     = 8.5;      // m  (total carriageway)
  const SHOULDER_W     = 2.2;      // m  (per side)
  const MAX_STEER      = 32.0;     // deg
  const CRUISE_SPD     = 32.0;     // km/h
  const MANEUVER_SPD   = 14.0;     // km/h  (max speed while shifting lane)
  const CREEP_SPD      = 6.0;      // km/h  (very slow, about to stop)
  const MAX_SPD        = 45.0;     // km/h

  // Driving state enum
  const DS = {
    CRUISE:        'CRUISING',
    DECELERATING:  'DECELERATING',
    STOPPED:       'STOPPED — WAITING FOR OBSTACLE',
    STEERING:      'STEERING AROUND OBSTACLE',
    RESUMING:      'RESUMING SPEED',
    CRAWL:         'CRAWL — FOLLOWING TRAFFIC',
    YIELDING:      'YIELDING'
  };

  // ─────────────────────────────────────────────────────────────────────────
  //  ROAD GEOMETRY  (from config.py get_road_center)
  // ─────────────────────────────────────────────────────────────────────────
  function getRoadCenter(y) {
    if (y < 12.0) return 0.0;
    const blend = Math.min(1.0, (y - 12.0) / 10.0);
    const curve = 2.4 * Math.sin((y - 12.0) * 0.040) +
                  1.1 * Math.sin((y - 12.0) * 0.018);
    return Math.round(blend * curve * 1000) / 1000;
  }

  function getRoadHeadingDeg(y) {
    const dy = 0.5;
    return Math.round(
      Math.atan2(getRoadCenter(y + dy) - getRoadCenter(y - dy), 2.0 * dy)
      * (180.0 / Math.PI) * 100
    ) / 100;
  }

  function allowsCrossing(scenName) {
    return scenName === 'Village Road' || scenName === 'Crowded Market Road';
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  ENTITY CLASS
  // ─────────────────────────────────────────────────────────────────────────
  class WorldEntity {
    constructor(id, cls, x, y, vx, vy, w, l, h, cMain, cAcc) {
      this.id   = id;
      this.className = cls;
      this.x    = x;  this.y = y;
      this.vx   = vx; this.vy = vy;
      this.width = w; this.length = l; this.height = h;
      this.colorMain   = cMain;
      this.colorAccent = cAcc;
      this.corridorOffset = x;
      this.customBehavior = null;
      this.pDet = 0.94; this.cMot = 0.88; this.risk = 0.15;
    }

    update(dt, avY) {
      if (this.customBehavior) {
        this.customBehavior(this, dt, avY);
      } else {
        this.y += this.vy * dt;
        if (this.vy !== 0.0 || this.corridorOffset !== 0.0) {
          this.x = getRoadCenter(this.y) + this.corridorOffset;
        } else {
          this.x += this.vx * dt;
        }
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  ENTITY FACTORIES
  // ─────────────────────────────────────────────────────────────────────────
  function mkAutorickshaw(id, x, y, vy = 5.5) {
    return new WorldEntity(id, 'Auto-Rickshaw', x, y, 0, vy, 1.3, 2.6, 1.7, '#facc15', '#15803d');
  }
  function mkPedestrian(id, x, y, vx = 0, vy = 1.0) {
    return new WorldEntity(id, 'Pedestrian', x, y, vx, vy, 0.6, 0.6, 1.7, '#f43f5e', '#e2e8f0');
  }
  function mkCow(id, x, y) {
    return new WorldEntity(id, 'Cow', x, y, 0.12, 0.2, 1.1, 2.2, 1.4, '#d4d4d8', '#71717a');
  }
  function mkMotorcycle(id, x, y, vy = 8.0) {
    return new WorldEntity(id, 'Motorcycle', x, y, 0, vy, 0.8, 1.9, 1.4, '#0284c7', '#1e293b');
  }
  function mkTruck(id, x, y, vy = 7.0) {
    return new WorldEntity(id, 'Truck', x, y, 0, vy, 2.4, 6.8, 2.8, '#ef4444', '#3b82f6');
  }
  function mkObstacle(id, x, y) {
    return new WorldEntity(id, 'Obstacle', x, y, 0, 0, 1.4, 1.4, 0.9, '#71717a', '#3f3f46');
  }

  // Crossing car: active road-crossing entity (ONLY in Village & Market scenarios)
  function mkCrossingCar(id, startX, startY, vx, vy) {
    const car = new WorldEntity(id, 'Crossing-Car', startX, startY, vx, vy, 1.8, 4.0, 1.5, '#38bdf8', '#1e293b');
    const maxLat = (ROAD_WIDTH * 0.5) + SHOULDER_W - 0.4;
    car.customBehavior = (c, dt) => {
      c.y += c.vy * dt;
      c.x += c.vx * dt;
      if (c.x > maxLat)  { c.x = maxLat;  c.vx = -Math.abs(c.vx); }
      if (c.x < -maxLat) { c.x = -maxLat; c.vx =  Math.abs(c.vx); }
    };
    return car;
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  SCENARIOS
  // ─────────────────────────────────────────────────────────────────────────
  const SCENARIOS = {
    'Village Road': () => [
      mkCrossingCar('cross_vlg', -2.8, 48.0,  1.2,  4.2),
      mkCow('cow_1', -1.8, 22.0),
      mkAutorickshaw('auto_1', 1.4, 38.0, 4.2),
      mkPedestrian('ped_1', -2.8, 14.0, 0.2, 0.8),
      mkMotorcycle('bike_1', 0.6, 52.0, 7.5),
      mkCow('cow_2', 2.4, 68.0)
    ],
    'Urban Intersection': () => [
      mkAutorickshaw('auto_1', -1.4, 18.0, 4.8),
      mkMotorcycle('bike_1', 1.8, 26.0, 6.5),
      mkPedestrian('ped_1', 2.2, 12.0, 0.0, 0.5),
      mkTruck('truck_1', -0.8, 46.0, 5.0),
      mkAutorickshaw('auto_2', 1.2, 60.0, 5.2)
    ],
    'Crowded Market Road': () => [
      mkCrossingCar('cross_mkt', 2.6, 36.0, -1.1, 3.0),
      mkPedestrian('ped_1', -1.2, 11.0, 0.3, 0.4),
      mkPedestrian('ped_2',  1.4, 15.0, -0.2, 0.5),
      mkAutorickshaw('auto_1', 0.8, 33.0, 3.2),
      mkMotorcycle('bike_1', -0.5, 48.0, 4.5),
      mkObstacle('pushcart_1', -2.0, 24.0)
    ],
    'Mixed-Traffic Highway': () => [
      mkTruck('truck_1', -1.8, 35.0, 7.5),
      mkMotorcycle('bike_1', 1.8, 20.0, 9.5),
      mkTruck('truck_2', 1.8, 62.0, 8.0),
      mkAutorickshaw('auto_1', -1.8, 50.0, 6.0)
    ],
    'Sudden Obstacle Event': () => [
      mkObstacle('rock_1', 0.0, 22.0),
      mkAutorickshaw('auto_1', -1.8, 32.0, 4.0),
      mkMotorcycle('bike_1', 1.8, 42.0, 7.0)
    ]
  };

  // ─────────────────────────────────────────────────────────────────────────
  //  EGO VEHICLE STATE
  // ─────────────────────────────────────────────────────────────────────────
  const av = {
    x: 0.0,                   // lateral offset from road centre (m)
    y: 0.0,                   // longitudinal world position (m)
    speedKmh: CRUISE_SPD,
    accelMs2: 0.0,
    steerDeg: 0.0,
    headingDeg: 0.0,
    distM: 0.0,
    completionPct: 0,

    // Scenario
    scenarioName: 'Village Road',
    isPaused: false,
    cameraElevated: false,
    cameraOccluded: false,
    bevExpanded: false,

    // Driving state machine
    drivingState: DS.CRUISE,
    activeOffsetX: 0.0,       // current lateral target (smoothly interpolated)
    targetOffsetX: 0.0,       // desired lateral target after bypass decision
    selectedRoute: 'ROUTE B',
    pendingRoute: 'ROUTE B',

    // Phase timers
    stopWaitTimer: 0.0,       // how long we've been stopped
    steerPhaseStarted: false, // true once lateral shift begins
    bypassAttempted: false,
    resumeTimer: 0.0,

    // Metrics
    replansCount: 0,
    replanLatencyMs: 14.2,
    minClearanceM: 2.5,
    pathSmoothness: 0.95,
    cycleTimeMs: 14.0,
    collisionDetected: false
  };

  let entities = SCENARIOS[av.scenarioName]();

  // Corridor status objects (updated each frame)
  const corridors = {
    'LEFT CORRIDOR':   { traversability: 0.75, status: 'FEASIBLE' },
    'CENTER CORRIDOR': { traversability: 0.60, status: 'FEASIBLE' },
    'RIGHT CORRIDOR':  { traversability: 0.85, status: 'FEASIBLE' }
  };

  const routes = {
    'ROUTE A': { offset: -2.6, safetyScore: 0.85, dynamicRisk: 0.15, minClearanceM: 2.8, status: 'CANDIDATE' },
    'ROUTE B': { offset:  0.0, safetyScore: 0.90, dynamicRisk: 0.10, minClearanceM: 3.2, status: 'SELECTED'  },
    'ROUTE C': { offset:  2.6, safetyScore: 0.80, dynamicRisk: 0.20, minClearanceM: 2.5, status: 'CANDIDATE' }
  };

  // ─────────────────────────────────────────────────────────────────────────
  //  CANVASES
  // ─────────────────────────────────────────────────────────────────────────
  const canvasRoad  = document.getElementById('mainSceneCanvas');
  const ctxRoad     = canvasRoad.getContext('2d');
  const canvasBev   = document.getElementById('bevCanvas');
  const ctxBev      = canvasBev.getContext('2d');
  const canvasSteer = document.getElementById('steerDialCanvas');
  const ctxSteer    = canvasSteer.getContext('2d');

  let camX = 0.0;
  const CAM_H    = 2.45;
  const CAM_DIST = 4.2;
  const FOCAL    = 590.0;

  function resizeAll() {
    [canvasRoad, canvasBev, canvasSteer].forEach(cv => {
      if (!cv) return;
      const r = cv.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        cv.width  = r.width  * window.devicePixelRatio;
        cv.height = r.height * window.devicePixelRatio;
      }
    });
  }
  window.addEventListener('resize', resizeAll);
  resizeAll();

  // ─────────────────────────────────────────────────────────────────────────
  //  PERSPECTIVE PROJECTION
  // ─────────────────────────────────────────────────────────────────────────
  function project3D(worldX, relY, z = 0.0, elevated = false) {
    const w = canvasRoad.width, h = canvasRoad.height;
    const effH = elevated ? 4.3 : CAM_H;
    const zRel = relY + CAM_DIST;
    if (zRel <= 0.8) return null;
    const scale   = FOCAL / zRel;
    const vanishX = w * 0.50;
    const vanishY = h * 0.35;
    return {
      sx: vanishX + (worldX - camX) * scale,
      sy: vanishY + (effH - z) * scale,
      scale
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  CORRIDOR / ROUTE EVALUATION  (pure function, no side-effects on av)
  // ─────────────────────────────────────────────────────────────────────────
  function evaluateCorridors() {
    const corrOffsets = {
      'LEFT CORRIDOR':   routes['ROUTE A'].offset,
      'CENTER CORRIDOR': routes['ROUTE B'].offset,
      'RIGHT CORRIDOR':  routes['ROUTE C'].offset
    };

    let bestRoute = 'ROUTE B', highestSafety = -1;

    for (const [cName, cOffset] of Object.entries(corrOffsets)) {
      let minClr = 9.0, dynRisk = 0.04;
      entities.forEach(ent => {
        const dy = ent.y - av.y;
        if (dy > 0 && dy < 45.0) {
          const dx   = Math.abs(ent.x - cOffset);
          const dist = Math.hypot(dx, dy * 0.4);
          if (dist < minClr) minClr = dist;
          if (dx < 1.7 && dy < 35.0) dynRisk += (14.0 / (dy + 4.0));
        }
      });
      dynRisk = Math.min(0.95, dynRisk);
      const trav   = Math.max(0.1, Math.min(0.98, 1.0 - dynRisk * 0.8));
      const safety = Math.max(0.05, 1.0 - dynRisk);
      corridors[cName].traversability = +trav.toFixed(2);
      corridors[cName].status = trav > 0.60 ? 'FEASIBLE' : (trav > 0.35 ? 'RESTRICTED' : 'BLOCKED');

      const rName = cName.startsWith('LEFT') ? 'ROUTE A' : (cName.startsWith('CENTER') ? 'ROUTE B' : 'ROUTE C');
      routes[rName].safetyScore   = +safety.toFixed(2);
      routes[rName].dynamicRisk   = +dynRisk.toFixed(2);
      routes[rName].minClearanceM = +minClr.toFixed(1);

      if (safety > highestSafety) { highestSafety = safety; bestRoute = rName; }
    }
    return bestRoute;
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  OBSTACLE SENSING
  //  frontClear: distance to closest entity in the direct forward path
  //  pathClear:  distance to closest entity in a wider safety envelope
  // ─────────────────────────────────────────────────────────────────────────
  function senseObstacles() {
    let frontClear = 999.0, frontEnt = null;
    let pathClear  = 999.0, pathEnt  = null;

    entities.forEach(ent => {
      const dy = ent.y - av.y;  // positive = ahead
      const dx = Math.abs(ent.x - av.x);

      // Ego vehicle body half-width = 0.9 m + 0.5 m safety margin = 1.4 m
      // Anything within this lateral envelope is a direct path threat
      if (dy > 0 && dy < 60.0 && dx < 1.4) {
        if (dy < frontClear) { frontClear = dy; frontEnt = ent; }
      }
      // Wider awareness envelope 2.6 m (full lane width / 2 + buffer)
      if (dy > 0 && dy < 60.0 && dx < 2.6) {
        if (dy < pathClear) { pathClear = dy; pathEnt = ent; }
      }
    });
    return { frontClear, frontEnt, pathClear, pathEnt };
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  SMOOTH SPEED CONTROLLER
  // ─────────────────────────────────────────────────────────────────────────
  function applySpeedControl(dt, targetKmh) {
    const diff = targetKmh - av.speedKmh;
    if (targetKmh < 0.5 && av.speedKmh < 0.8) {
      av.speedKmh = 0.0; av.accelMs2 = 0.0; return;
    }
    if (diff < -0.8) {
      // Smooth progressive braking — ramps up from -1.5 to -4.5 m/s²
      av.accelMs2 = Math.max(-4.5, diff * 0.52);
    } else if (diff > 0.8) {
      // Gentle smooth acceleration
      av.accelMs2 = Math.min(1.8, diff * 0.32);
    } else {
      av.accelMs2 = 0.0;
    }
    av.speedKmh = Math.max(0.0, Math.min(MAX_SPD, av.speedKmh + av.accelMs2 * dt * 3.6));
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  STEERING CONTROLLER (smooth pure-pursuit style)
  // ─────────────────────────────────────────────────────────────────────────
  function applySteeringControl(dt, crossing) {
    const latErr     = av.activeOffsetX - av.x;
    const k          = crossing ? 10.0 : 7.0;
    const targetSteer = Math.max(-MAX_STEER, Math.min(MAX_STEER, latErr * k));
    const maxRate    = 28.0 * dt;
    const diff       = targetSteer - av.steerDeg;
    av.steerDeg += Math.sign(diff) * Math.min(Math.abs(diff), maxRate);

    const speedMps = av.speedKmh / 3.6;
    const latVel   = speedMps * Math.sin((av.steerDeg * Math.PI) / 180.0) * 0.95;
    av.x += latVel * dt;

    if (!crossing) {
      av.x = Math.max(-2.2, Math.min(2.2, av.x));
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  MAIN SIMULATION UPDATE — Full real-driving state machine
  // ─────────────────────────────────────────────────────────────────────────
  function updateSimulation(dt) {
    if (av.isPaused) return;

    const crossing = allowsCrossing(av.scenarioName);

    // Route offsets — wide enough to actually dodge obstacles
    if (crossing) {
      routes['ROUTE A'].offset = -2.8;
      routes['ROUTE B'].offset =  0.0;
      routes['ROUTE C'].offset =  2.8;
    } else {
      // Non-crossing: still use real lane offsets so car can steer past obstacles
      routes['ROUTE A'].offset = -1.8;
      routes['ROUTE B'].offset =  0.0;
      routes['ROUTE C'].offset =  1.8;
    }

    // Chase camera
    const targetCamX = av.x * 0.65;
    camX += (targetCamX - camX) * 0.09;

    // Update all entities
    entities.forEach(ent => {
      ent.update(dt, av.y);
      // Live probabilistic metrics
      const dy = Math.max(1, ent.y - av.y);
      ent.pDet = +(0.90 + Math.random() * 0.07).toFixed(2);
      ent.cMot = +(0.85 + Math.random() * 0.09).toFixed(2);
      ent.risk = +Math.max(0.04, Math.min(0.96, (28.0 / (dy + 5.0)) * 0.25)).toFixed(2);
    });

    // Recycle old entities — respawn 80–110 m ahead, staggered so they never all block centre
    let recycleCount = 0;
    entities.forEach(ent => {
      if (ent.y - av.y < -10.0) {
        ent.y = av.y + 80.0 + Math.random() * 30.0 + recycleCount * 8.0;
        recycleCount++;
        if (crossing) {
          // Scatter across full road width but leave one side with a gap
          const side = Math.random();
          ent.x = side < 0.4 ? -(1.5 + Math.random() * 2.0)
               : side < 0.7 ?  (1.5 + Math.random() * 2.0)
               :               (Math.random() - 0.5) * 1.2;
          if (ent.corridorOffset !== undefined) ent.corridorOffset = ent.x;
        } else {
          // Alternate sides so there is always at least one open corridor
          const side = recycleCount % 2 === 0 ? -1 : 1;
          ent.x = side * (1.4 + Math.random() * 0.6);
          if (ent.corridorOffset !== undefined) ent.corridorOffset = ent.x;
        }
      }
    });

    // Evaluate corridors and routes
    const bestRoute = evaluateCorridors();

    // ── SENSE: Find closest truly-blocking entity in forward cone ─────────────
    // An entity is BLOCKING only if it is SLOWER than the ego vehicle or stationary.
    // Fast-moving entities ahead (already overtaking) are NOT obstacles.
    const avSpeedMps = av.speedKmh / 3.6;

    let frontClear  = 999.0, frontEnt  = null;
    let leftGapMin  = 999.0, centGapMin = 999.0, rightGapMin = 999.0;

    // Lane x-positions for gap evaluation
    const laneL = crossing ? -2.8 : -1.8;
    const laneC = 0.0;
    const laneR = crossing ?  2.8 :  1.8;
    const halfCarW = 0.95; // half ego-car width + margin

    entities.forEach(ent => {
      const dy = ent.y - av.y;  // positive = ahead of ego
      if (dy < 0.5 || dy > 55.0) return; // behind or too far — ignore

      const entSpeedMps = Math.hypot(ent.vx, ent.vy); // entity absolute speed
      const relSpeed    = avSpeedMps - entSpeedMps;    // positive = ego closing in

      // Only a BLOCKING threat if ego is closing in on it (rel > -1 m/s)
      // This means: stationary obstacles, slow traffic, and things cutting across
      const isBlocking = relSpeed > -1.0;

      // Ego forward path half-width
      const dxFromEgo = Math.abs(ent.x - av.x);

      if (isBlocking && dxFromEgo < halfCarW + 0.5) {
        if (dy < frontClear) { frontClear = dy; frontEnt = ent; }
      }

      // Gap scan: how far ahead is the closest blocker in each lane?
      if (isBlocking) {
        if (Math.abs(ent.x - laneL) < halfCarW + 0.6 && dy < leftGapMin)  leftGapMin  = dy;
        if (Math.abs(ent.x - laneC) < halfCarW + 0.6 && dy < centGapMin)  centGapMin  = dy;
        if (Math.abs(ent.x - laneR) < halfCarW + 0.6 && dy < rightGapMin) rightGapMin = dy;
      }
    });

    // Obstruction flags based purely on blocking threats
    const GAP_SAFE  = 12.0; // m — a gap this large means lane is clear enough to use
    const leftOpen  = leftGapMin  > GAP_SAFE;
    const centOpen  = centGapMin  > GAP_SAFE;
    const rightOpen = rightGapMin > GAP_SAFE;
    const anyLaneOpen = leftOpen || centOpen || rightOpen;

    // Comfort-distance thresholds (relative to closing speed)
    const safeFollow  = Math.max(10.0, avSpeedMps * 3.0); // 3-second rule
    const brakeZone   = Math.max( 6.0, avSpeedMps * 1.8); // hard-brake zone
    const stopZone    = 2.0;                               // physically must stop

    const needsFollow   = frontClear < safeFollow && frontClear > brakeZone;
    const needsBrake    = frontClear < brakeZone  && frontClear > stopZone;
    const mustStop      = frontClear < stopZone;

    // ── FIND BEST LATERAL TARGET ──────────────────────────────────────────────
    // Score each lane: higher gap distance = better. Car picks it and steers there.
    function bestLane() {
      const scores = [
        { lane: 'L', x: laneL, gap: leftGapMin  },
        { lane: 'C', x: laneC, gap: centGapMin  },
        { lane: 'R', x: laneR, gap: rightGapMin }
      ];
      // Bias slightly toward centre to avoid shoulder
      scores[1].gap += 2.0;
      // Bias toward the side currently closest to avoid large unnecessary swings
      const currentDist = [
        Math.abs(av.activeOffsetX - laneL),
        Math.abs(av.activeOffsetX - laneC),
        Math.abs(av.activeOffsetX - laneR)
      ];
      for (let i = 0; i < scores.length; i++) scores[i].gap -= currentDist[i] * 0.5;
      scores.sort((a, b) => b.gap - a.gap);
      return scores[0];
    }

    // Compute the ideal following speed behind a slow entity
    function followSpeed() {
      if (frontEnt === null) return CRUISE_SPD;
      const entKmh = Math.hypot(frontEnt.vx, frontEnt.vy) * 3.6;
      // Match their speed + a small gap-closing/maintaining factor
      const dist = Math.max(1, frontClear);
      const gapFactor = (dist - 8.0) / 8.0; // positive = open up, negative = slow more
      return Math.max(CREEP_SPD, Math.min(CRUISE_SPD, entKmh + gapFactor * 4.0));
    }

    // ── EMERGENCY: true physical unavoidable collision ────────────────────────
    if (mustStop && av.speedKmh > 0.5) {
      // Hard-slam brakes
      av.accelMs2 = -7.0;
      av.speedKmh = Math.max(0.0, av.speedKmh + av.accelMs2 * dt * 3.6);
      if (av.speedKmh < 0.5) { av.speedKmh = 0.0; av.accelMs2 = 0.0; }
      // While braking hard, still try to steer into an open lane
      if (anyLaneOpen) {
        const best = bestLane();
        av.targetOffsetX  = best.x;
        av.activeOffsetX += (best.x - av.activeOffsetX) * Math.min(1, 3.5 * dt);
      }
      av.drivingState = DS.STOPPED;
      av.stopWaitTimer = 0.0;
      applySteeringControl(dt, crossing);
      av.y += (av.speedKmh / 3.6) * dt;
      av.distM = av.y;
      av.headingDeg = getRoadHeadingDeg(av.y);
      av.completionPct = Math.min(100, Math.floor((av.y / 180.0) * 100));
      av.collisionDetected = false;
      av.pathSmoothness = +(0.98 - 0.3).toFixed(2);
      av.cycleTimeMs = +(13.5 + Math.random() * 2.5).toFixed(1);
      return;
    }

    // ── MAIN REAL-DRIVING LOGIC ───────────────────────────────────────────────
    // Principle: the car ALWAYS moves unless physically impossible.
    // Priority order:
    //   1. If path ahead is clear → cruise at full speed
    //   2. If path ahead is slowing-range → steer into best open lane while slowing
    //   3. If path ahead is brake-range → steer hard into open lane + brake
    //   4. Only if ALL lanes blocked AND must-stop → crawl to halt and wait

    if (!needsFollow && !needsBrake) {
      // ── FREE CRUISE ──────────────────────────────────────────────────────────
      av.drivingState = DS.CRUISE;
      applySpeedControl(dt, CRUISE_SPD);
      // Drift back toward chosen lane centre
      av.activeOffsetX += (routes[av.selectedRoute].offset - av.activeOffsetX) * 0.04;

    } else if (needsFollow && anyLaneOpen) {
      // ── FOLLOW or BYPASS: path is occupied ahead, but a lane is open ─────────
      const best = bestLane();
      const distToTarget = Math.abs(av.activeOffsetX - best.x);

      if (distToTarget > 0.3) {
        // Steering into the better lane
        av.drivingState = DS.STEERING;
        av.targetOffsetX = best.x;
        // Speed: slow a bit during lateral move, but keep moving
        const laneChangSpd = Math.max(MANEUVER_SPD, CRUISE_SPD * (frontClear / safeFollow));
        applySpeedControl(dt, laneChangSpd);
        av.activeOffsetX += Math.sign(best.x - av.activeOffsetX)
                          * Math.min(Math.abs(best.x - av.activeOffsetX), (crossing ? 2.8 : 1.8) * dt);
      } else {
        // Already in a good lane — follow at safe speed
        av.drivingState = DS.CRUISE;
        av.targetOffsetX = best.x;
        av.activeOffsetX = best.x;
        applySpeedControl(dt, followSpeed());
      }
      av.selectedRoute = best.lane === 'L' ? 'ROUTE A' : (best.lane === 'C' ? 'ROUTE B' : 'ROUTE C');
      av.pendingRoute  = av.selectedRoute;

    } else if (needsBrake && anyLaneOpen) {
      // ── BRAKE + STEER INTO OPEN LANE ─────────────────────────────────────────
      av.drivingState = DS.STEERING;
      const best = bestLane();
      av.targetOffsetX = best.x;
      // Brake toward following speed but don't stop
      const brakeTgt = Math.max(CREEP_SPD, followSpeed() * 0.75);
      applySpeedControl(dt, brakeTgt);
      av.activeOffsetX += Math.sign(best.x - av.activeOffsetX)
                        * Math.min(Math.abs(best.x - av.activeOffsetX), (crossing ? 3.2 : 2.2) * dt);
      av.selectedRoute = best.lane === 'L' ? 'ROUTE A' : (best.lane === 'C' ? 'ROUTE B' : 'ROUTE C');
      av.pendingRoute  = av.selectedRoute;

    } else if ((needsFollow || needsBrake) && !anyLaneOpen) {
      // ── TRAFFIC CRAWL: all lanes occupied — follow the slowest at safe gap ────
      av.drivingState = DS.DECELERATING;
      const crawlSpd = needsBrake ? Math.max(CREEP_SPD * 0.5, followSpeed() * 0.6)
                                  : Math.max(CREEP_SPD, followSpeed());
      applySpeedControl(dt, crawlSpd);
      // Tiny lateral jitter to try to find a gap (real drivers nudge left/right)
      av.activeOffsetX += Math.sin(Date.now() * 0.002) * 0.008;

    } else {
      // Fallback — cruise
      av.drivingState = DS.CRUISE;
      applySpeedControl(dt, CRUISE_SPD);
    }

    // Update replan counter whenever we steer or decelerate
    if (av.drivingState === DS.STEERING && !av.steerPhaseStarted) {
      av.steerPhaseStarted = true;
      av.replansCount++;
      av.replanLatencyMs = +(10.0 + Math.random() * 3.0).toFixed(1);
    } else if (av.drivingState !== DS.STEERING) {
      av.steerPhaseStarted = false;
    }

    // Clamp lateral position
    const maxX = crossing ? 3.8 : 2.2;
    av.activeOffsetX = Math.max(-maxX, Math.min(maxX, av.activeOffsetX));
    av.targetOffsetX = Math.max(-maxX, Math.min(maxX, av.targetOffsetX));

    // ── APPLY STEERING ─────────────────────────────────────────────────────
    applySteeringControl(dt, crossing);

    // ── ADVANCE LONGITUDINAL ───────────────────────────────────────────────
    const speedMps = av.speedKmh / 3.6;
    av.y           += speedMps * dt;
    av.distM        = av.y;
    av.headingDeg   = getRoadHeadingDeg(av.y);
    av.completionPct = Math.min(100, Math.floor((av.y / 180.0) * 100));

    // Collision only registers if:
    //  1. Obstacle is < 0.5 m away (actual physical overlap)
    //  2. Car is moving faster than 3 km/h (not already stopped)
    //  3. We are NOT in a braking/stopped/steering protective state
    const inProtectiveState = (av.drivingState === DS.STOPPED
                            || av.drivingState === DS.DECELERATING
                            || av.drivingState === DS.STEERING);
    av.collisionDetected = (!inProtectiveState && frontClear < 0.5 && av.speedKmh > 3.0);

    // Path smoothness heuristic
    const steerNorm   = Math.abs(av.steerDeg) / MAX_STEER;
    const accelNorm   = Math.abs(av.accelMs2) / 4.5;
    av.pathSmoothness = +Math.max(0.5, Math.min(0.99, 0.98 - steerNorm * 0.25 - accelNorm * 0.18)).toFixed(2);
    av.cycleTimeMs    = +(13.5 + Math.random() * 2.5).toFixed(1);
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  DRIVING STATE LABEL  (human readable)
  // ─────────────────────────────────────────────────────────────────────────
  function getDrivingLabel() {
    const crossing = allowsCrossing(av.scenarioName);
    switch (av.drivingState) {
      case DS.CRUISE:       return crossing ? 'CRUISING — UNSTRUCTURED ROAD' : 'CRUISING — LANE KEEPING';
      case DS.DECELERATING: return 'TRAFFIC CRAWL — FOLLOWING SLOW VEHICLE';
      case DS.STOPPED:      return `EMERGENCY STOP — OBSTACLE AT ${av.minClearanceM.toFixed(1)} m`;
      case DS.STEERING:     return crossing ? 'BYPASSING — THREADING THROUGH TRAFFIC' : 'LANE CHANGE — OBSTACLE AVOIDANCE';
      case DS.RESUMING:     return 'RESUMING — MERGING TO CENTRE';
      default:              return av.drivingState;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  2.5D ROAD RENDERER
  // ─────────────────────────────────────────────────────────────────────────
  function renderMainScene() {
    const w = canvasRoad.width, h = canvasRoad.height;
    ctxRoad.clearRect(0, 0, w, h);

    const isDay    = document.documentElement.getAttribute('data-theme') === 'day';
    const elevated = av.cameraElevated;
    const vanishY  = h * 0.35;

    // ── SKY ──────────────────────────────────────────────────────────────
    const skyGrad = ctxRoad.createLinearGradient(0, 0, 0, vanishY);
    if (!isDay) {
      skyGrad.addColorStop(0,   '#080c16');
      skyGrad.addColorStop(0.4, '#0f172a');
      skyGrad.addColorStop(0.8, '#172338');
      skyGrad.addColorStop(1,   '#24324a');
    } else {
      skyGrad.addColorStop(0,   '#0369a1');
      skyGrad.addColorStop(0.5, '#38bdf8');
      skyGrad.addColorStop(1,   '#7dd3fc');
    }
    ctxRoad.fillStyle = skyGrad;
    ctxRoad.fillRect(0, 0, w, vanishY);

    // Stars (night)
    if (!isDay) {
      ctxRoad.fillStyle = '#ffffff';
      [[0.08,0.06],[0.18,0.13],[0.27,0.04],[0.38,0.16],[0.50,0.08],
       [0.60,0.18],[0.70,0.05],[0.80,0.14],[0.89,0.07],[0.95,0.20]
      ].forEach(([sx,sy]) => ctxRoad.fillRect(sx*w, sy*vanishY, 2, 2));
    }

    // Mountain silhouette
    ctxRoad.beginPath();
    ctxRoad.moveTo(0, vanishY);
    for (let x = 0; x <= w; x += 28) {
      const my = vanishY - 28 - Math.sin((x + av.y * 1.5) * 0.011) * 18;
      ctxRoad.lineTo(x, my);
    }
    ctxRoad.lineTo(w, vanishY);
    ctxRoad.fillStyle = isDay ? '#475569' : '#131b28';
    ctxRoad.fill();

    // ── TERRAIN ───────────────────────────────────────────────────────────
    ctxRoad.fillStyle = isDay ? '#92400e' : '#23190e';
    ctxRoad.fillRect(0, vanishY, w * 0.5, h - vanishY);
    ctxRoad.fillStyle = isDay ? '#166534' : '#152014';
    ctxRoad.fillRect(w * 0.5, vanishY, w * 0.5, h - vanishY);

    // ── ROAD SLICES (far→near) ────────────────────────────────────────────
    const halfRw = ROAD_WIDTH * 0.5;
    const halfSw = halfRw + SHOULDER_W;
    const step   = 3.0;

    for (let dist = 84; dist > 0; dist -= step) {
      const nearDist = Math.max(0.5, dist - step);
      const rcFar = getRoadCenter(av.y + dist);
      const rcNr  = getRoadCenter(av.y + nearDist);

      const pFL  = project3D(rcFar - halfRw, dist, 0, elevated);
      const pFR  = project3D(rcFar + halfRw, dist, 0, elevated);
      const pFSl = project3D(rcFar - halfSw, dist, 0, elevated);
      const pFSr = project3D(rcFar + halfSw, dist, 0, elevated);
      const pNL  = project3D(rcNr - halfRw, nearDist, 0, elevated);
      const pNR  = project3D(rcNr + halfRw, nearDist, 0, elevated);
      const pNSl = project3D(rcNr - halfSw, nearDist, 0, elevated);
      const pNSr = project3D(rcNr + halfSw, nearDist, 0, elevated);

      if (!pFL || !pNL || !pFR || !pNR) continue;

      const shoulderCol = isDay ? '#a17036' : '#38291c';

      // Left shoulder
      if (pFSl && pNSl) {
        ctxRoad.beginPath();
        ctxRoad.moveTo(pFSl.sx, pFSl.sy);
        ctxRoad.lineTo(pFL.sx, pFL.sy);
        ctxRoad.lineTo(pNL.sx, pNL.sy);
        ctxRoad.lineTo(pNSl.sx, pNSl.sy);
        ctxRoad.fillStyle = shoulderCol; ctxRoad.fill();
      }
      // Right shoulder
      if (pFSr && pNSr) {
        ctxRoad.beginPath();
        ctxRoad.moveTo(pFR.sx, pFR.sy);
        ctxRoad.lineTo(pFSr.sx, pFSr.sy);
        ctxRoad.lineTo(pNSr.sx, pNSr.sy);
        ctxRoad.lineTo(pNR.sx, pNR.sy);
        ctxRoad.fillStyle = shoulderCol; ctxRoad.fill();
      }

      // Asphalt
      const dep = dist / 85.0;
      const aspCol = isDay ? (dep > 0.55 ? '#334155' : '#1e293b')
                           : (dep > 0.55 ? '#15181f' : '#1c222b');
      ctxRoad.beginPath();
      ctxRoad.moveTo(pFL.sx, pFL.sy);
      ctxRoad.lineTo(pFR.sx, pFR.sy);
      ctxRoad.lineTo(pNR.sx, pNR.sy);
      ctxRoad.lineTo(pNL.sx, pNL.sy);
      ctxRoad.fillStyle = aspCol; ctxRoad.fill();

      // Painted kerb stones (alternating red/white every 4 m)
      const even = (Math.floor((av.y + dist) / 4.0) % 2 === 0);
      const curbCol = isDay ? (even ? '#dc2626' : '#ffffff') : (even ? '#b91c1c' : '#f1f5f9');
      ctxRoad.beginPath();
      ctxRoad.moveTo(pFL.sx, pFL.sy); ctxRoad.lineTo(pNL.sx, pNL.sy);
      ctxRoad.moveTo(pFR.sx, pFR.sy); ctxRoad.lineTo(pNR.sx, pNR.sy);
      ctxRoad.strokeStyle = curbCol;
      ctxRoad.lineWidth = Math.max(1, pNL.scale * 0.06);
      ctxRoad.stroke();

      // Cat-eye reflectors every 8 m
      if (Math.floor(av.y + dist) % 8 < step) {
        const rd = Math.max(1.5, pNL.scale * 0.04);
        ctxRoad.fillStyle = isDay ? '#0284c7' : '#38bdf8';
        ctxRoad.fillRect(pNL.sx - rd, pNL.sy - rd, rd*2, rd*2);
        ctxRoad.fillStyle = '#facc15';
        ctxRoad.fillRect(pNR.sx - rd, pNR.sy - rd, rd*2, rd*2);
      }
    }

    // ── CENTRE-LINE DASHES ────────────────────────────────────────────────
    const dashInterval = 8.0, dashLen = 3.8;
    const scroll       = av.distM % dashInterval;
    for (let dBase = 4; dBase < 80; dBase += dashInterval) {
      const effD = dBase - scroll;
      if (effD < 1.5) continue;
      const p1 = project3D(getRoadCenter(av.y + effD),          effD,          0, elevated);
      const p2 = project3D(getRoadCenter(av.y + effD + dashLen), effD + dashLen, 0, elevated);
      if (p1 && p2) {
        ctxRoad.beginPath();
        ctxRoad.moveTo(p1.sx, p1.sy); ctxRoad.lineTo(p2.sx, p2.sy);
        ctxRoad.strokeStyle = '#facc15';
        ctxRoad.lineWidth = Math.max(2, p1.scale * 0.12);
        ctxRoad.stroke();
      }
    }

    // ── ROADSIDE PROPS (trees, milestones) ────────────────────────────────
    for (const dRaw of [72.0, 52.0, 34.0, 18.0]) {
      const dist  = dRaw - (av.distM % 20.0);
      if (dist < 2.0) continue;
      const worldY = av.y + dist;
      const rc     = getRoadCenter(worldY);

      // Milestone
      const msX  = rc - halfSw - 0.7;
      const pMsB = project3D(msX, dist, 0.0, elevated);
      const pMsT = project3D(msX, dist, 0.9, elevated);
      if (pMsB && pMsT) {
        const mw = Math.max(4, 0.55 * pMsB.scale);
        const mh = Math.abs(pMsB.sy - pMsT.sy);
        ctxRoad.fillStyle = '#ffffff';
        ctxRoad.fillRect(pMsB.sx - mw*0.5, pMsB.sy - mh, mw, mh);
        ctxRoad.fillStyle = '#facc15';
        ctxRoad.beginPath();
        ctxRoad.arc(pMsB.sx, pMsB.sy - mh, mw*0.5, Math.PI, 0);
        ctxRoad.fill();
      }

      // Roadside tree
      const trX  = rc + halfSw + 2.5;
      const pTrB = project3D(trX, dist, 0.0, elevated);
      const pTrT = project3D(trX, dist, 5.0, elevated);
      if (pTrB && pTrT) {
        const trR = Math.max(5, pTrB.scale * 0.40);
        ctxRoad.beginPath();
        ctxRoad.moveTo(pTrB.sx, pTrB.sy); ctxRoad.lineTo(pTrT.sx, pTrT.sy);
        ctxRoad.strokeStyle = '#78350f';
        ctxRoad.lineWidth = Math.max(2, pTrB.scale * 0.10);
        ctxRoad.stroke();
        ctxRoad.beginPath();
        ctxRoad.arc(pTrT.sx, pTrT.sy, trR, 0, Math.PI * 2);
        ctxRoad.fillStyle = isDay ? '#15803d' : '#14532d';
        ctxRoad.fill();
      }
    }

    // ── LiDAR FAN ────────────────────────────────────────────────────────
    const pEgo = project3D(av.x, 0.0, 0.0, elevated);
    if (pEgo) {
      const lg = ctxRoad.createRadialGradient(pEgo.sx, pEgo.sy, 10, pEgo.sx, vanishY + 50, w * 0.35);
      lg.addColorStop(0, 'rgba(16,185,129,0.22)');
      lg.addColorStop(1, 'rgba(16,185,129,0)');
      ctxRoad.fillStyle = lg;
      ctxRoad.beginPath();
      ctxRoad.moveTo(pEgo.sx, pEgo.sy);
      ctxRoad.arc(pEgo.sx, pEgo.sy, w * 0.4, Math.PI + 0.5, -0.5);
      ctxRoad.closePath();
      ctxRoad.fill();
    }

    // ── CANDIDATE TRAJECTORY NEON LINES ──────────────────────────────────
    [
      { name: 'ROUTE A', col: '#38bdf8' },
      { name: 'ROUTE B', col: '#a78bfa' },
      { name: 'ROUTE C', col: '#f59e0b' }
    ].forEach(r => {
      const isSel = (r.name === av.selectedRoute);
      ctxRoad.beginPath();
      let started = false;
      for (let dist = 2.0; dist <= 42.0; dist += 2.0) {
        const blend = Math.min(1.0, dist / 14.0);
        const lat   = av.x + (routes[r.name].offset - av.x) * blend;
        const pt    = project3D(lat, dist, 0.0, elevated);
        if (!pt) continue;
        if (!started) { ctxRoad.moveTo(pt.sx, pt.sy); started = true; }
        else { ctxRoad.lineTo(pt.sx, pt.sy); }
      }
      ctxRoad.strokeStyle = isSel ? '#10b981' : r.col;
      ctxRoad.lineWidth   = isSel ? 5 : 2;
      ctxRoad.stroke();
    });

    // ── TRAFFIC ENTITIES (far→near) ───────────────────────────────────────
    [...entities].sort((a, b) => b.y - a.y).forEach(ent => {
      const relY = ent.y - av.y;
      if (relY < 0.5 || relY > 85.0) return;
      const p = project3D(ent.x, relY, 0.0, elevated);
      if (!p) return;

      const sc = p.scale;
      const bw = Math.max(10, ent.width  * sc * 0.85);
      const bh = Math.max(12, ent.height * sc * 0.85);
      const cx = p.sx, cy = p.sy;

      if (ent.className === 'Auto-Rickshaw') {
        ctxRoad.fillStyle = ent.colorAccent;
        ctxRoad.fillRect(cx - bw*0.45, cy - bh*0.55, bw*0.9, bh*0.55);
        ctxRoad.fillStyle = ent.colorMain;
        ctxRoad.fillRect(cx - bw*0.48, cy - bh,      bw*0.96, bh*0.5);
      } else if (ent.className === 'Crossing-Car') {
        ctxRoad.fillStyle = '#0284c7';
        ctxRoad.fillRect(cx - bw*0.5, cy - bh*0.6, bw, bh*0.6);
        ctxRoad.fillStyle = '#f8fafc';
        ctxRoad.fillRect(cx - bw*0.4, cy - bh,     bw*0.8, bh*0.45);
        ctxRoad.fillStyle = '#ef4444';
        ctxRoad.fillRect(cx - bw*0.45, cy - bh*0.3, bw*0.2, bh*0.15);
        ctxRoad.fillRect(cx + bw*0.25, cy - bh*0.3, bw*0.2, bh*0.15);
      } else if (ent.className === 'Cow') {
        ctxRoad.fillStyle = ent.colorMain;
        ctxRoad.beginPath();
        ctxRoad.ellipse(cx, cy - bh*0.5, bw*0.5, bh*0.35, 0, 0, Math.PI*2);
        ctxRoad.fill();
        ctxRoad.beginPath();
        ctxRoad.arc(cx + bw*0.25, cy - bh*0.75, bw*0.2, 0, Math.PI*2);
        ctxRoad.fill();
      } else if (ent.className === 'Truck') {
        ctxRoad.fillStyle = ent.colorMain;
        ctxRoad.fillRect(cx - bw*0.5, cy - bh, bw, bh);
        ctxRoad.fillStyle = '#facc15';
        ctxRoad.fillRect(cx - bw*0.4, cy - bh*0.3, bw*0.8, bh*0.2);
      } else if (ent.className === 'Obstacle') {
        ctxRoad.fillStyle = ent.colorMain;
        ctxRoad.beginPath();
        ctxRoad.moveTo(cx - bw*0.5, cy);
        ctxRoad.lineTo(cx - bw*0.3, cy - bh);
        ctxRoad.lineTo(cx + bw*0.3, cy - bh);
        ctxRoad.lineTo(cx + bw*0.5, cy);
        ctxRoad.closePath();
        ctxRoad.fill();
      } else {
        // Pedestrian / Motorcycle
        ctxRoad.fillStyle = ent.colorMain;
        ctxRoad.fillRect(cx - bw*0.35, cy - bh, bw*0.7, bh);
      }

      // Detection bounding box + label
      const isHighRisk = (relY < 22.0 && Math.abs(ent.x - av.x) < 2.0);
      ctxRoad.strokeStyle = isHighRisk ? '#f85149' : '#38bdf8';
      ctxRoad.lineWidth = 1;
      ctxRoad.strokeRect(cx - bw*0.55, cy - bh*1.1, bw*1.1, bh*1.15);
      ctxRoad.fillStyle = isHighRisk ? '#f85149' : '#38bdf8';
      ctxRoad.font = 'bold 9px Segoe UI';
      ctxRoad.textAlign = 'center';
      ctxRoad.fillText(`${ent.className} | ${relY.toFixed(1)}m`, cx, cy - bh*1.2);
    });

    // ── EGO VEHICLE (foreground) ──────────────────────────────────────────
    const dx  = av.x - camX;
    const vCx = w * 0.50 + dx * 42.0;
    const vCy = h - 22;
    const vW  = 116, vH = 72;
    const tilt = Math.max(-8, Math.min(8, av.steerDeg * 0.25));

    // Night underglow
    if (!isDay) {
      ctxRoad.fillStyle = '#042f2e';
      ctxRoad.beginPath();
      ctxRoad.ellipse(vCx, vCy, vW*0.52, 10, 0, 0, Math.PI*2);
      ctxRoad.fill();
    }

    // Body
    ctxRoad.fillStyle   = isDay ? '#1d4ed8' : '#1e293b';
    ctxRoad.strokeStyle = isDay ? '#60a5fa' : '#38bdf8';
    ctxRoad.lineWidth   = 2;
    ctxRoad.beginPath();
    ctxRoad.moveTo(vCx - vW*0.48 - tilt, vCy - vH);
    ctxRoad.lineTo(vCx + vW*0.48 + tilt, vCy - vH);
    ctxRoad.lineTo(vCx + vW*0.46,         vCy - 4);
    ctxRoad.lineTo(vCx - vW*0.46,         vCy - 4);
    ctxRoad.closePath();
    ctxRoad.fill();
    ctxRoad.stroke();

    // Rear windshield
    ctxRoad.fillStyle = '#0b1120';
    ctxRoad.fillRect(vCx - vW*0.35, vCy - vH + 8, vW*0.7, 24);

    // Brake lights (red glow when braking or stopped)
    const isBraking = (av.accelMs2 < -0.4 || av.drivingState === DS.DECELERATING
                        || av.drivingState === DS.STOPPED || av.drivingState === DS.STEERING);
    ctxRoad.fillStyle = isBraking ? '#ef4444' : '#991b1b';
    ctxRoad.fillRect(vCx - vW*0.44, vCy - vH*0.4, 14, 8);
    ctxRoad.fillRect(vCx + vW*0.32, vCy - vH*0.4, 14, 8);

    // Turn blinkers
    const blinkOn   = (Math.floor(Date.now() / 240) % 2 === 0);
    const turnLeft  = (av.steerDeg < -2.0 || av.activeOffsetX < av.x - 0.2);
    const turnRight = (av.steerDeg >  2.0 || av.activeOffsetX > av.x + 0.2);
    if (turnLeft  && blinkOn) {
      ctxRoad.fillStyle = '#f59e0b';
      ctxRoad.beginPath(); ctxRoad.arc(vCx - vW*0.42, vCy - vH*0.36, 5, 0, Math.PI*2); ctxRoad.fill();
    }
    if (turnRight && blinkOn) {
      ctxRoad.fillStyle = '#f59e0b';
      ctxRoad.beginPath(); ctxRoad.arc(vCx + vW*0.42, vCy - vH*0.36, 5, 0, Math.PI*2); ctxRoad.fill();
    }

    // Roof LiDAR pod
    ctxRoad.fillStyle = '#0284c7';
    ctxRoad.fillRect(vCx - 14, vCy - vH - 12, 28, 12);
    ctxRoad.fillStyle = '#38bdf8';
    const pulseX = vCx + Math.sin(Date.now() * 0.008) * 9;
    ctxRoad.fillRect(pulseX - 3, vCy - vH - 16, 6, 4);

    // Stop — "STOPPED" text indicator
    if (av.drivingState === DS.STOPPED) {
      ctxRoad.fillStyle = 'rgba(239,68,68,0.92)';
      ctxRoad.beginPath();
      ctxRoad.roundRect(vCx - 55, vCy - vH - 38, 110, 20, 4);
      ctxRoad.fill();
      ctxRoad.fillStyle = '#ffffff';
      ctxRoad.font = 'bold 10px Segoe UI';
      ctxRoad.textAlign = 'center';
      ctxRoad.fillText('⛔ STOPPED — WAITING', vCx, vCy - vH - 24);
    }

    // Pause overlay
    if (av.isPaused) {
      ctxRoad.fillStyle = 'rgba(0,0,0,0.65)';
      ctxRoad.fillRect(0, 0, w, h);
      ctxRoad.fillStyle = '#facc15';
      ctxRoad.font = 'bold 20px Segoe UI';
      ctxRoad.textAlign = 'center';
      ctxRoad.fillText('⏸ SIMULATION PAUSED — PRESS SPACE TO RESUME', w/2, h/2);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  BEV (BIRD'S-EYE VIEW) RENDERER  — Large, clear top-down map
  // ─────────────────────────────────────────────────────────────────────────
  function renderBevMap() {
    const w = canvasBev.width, h = canvasBev.height;
    ctxBev.clearRect(0, 0, w, h);

    const cx    = w * 0.50;
    const cy    = h - 30.0;
    // Adaptive scale so BEV always fills the canvas
    const scale = Math.min(w / 28.0, (h - 40.0) / 62.0);

    // ── BACKGROUND ───────────────────────────────────────────────────────
    ctxBev.fillStyle = '#07090f';
    ctxBev.fillRect(0, 0, w, h);

    // Grid
    const gridStep = Math.round(10 * scale);
    ctxBev.strokeStyle = 'rgba(30,41,59,0.5)';
    ctxBev.lineWidth = 1;
    for (let gx = cx % gridStep; gx < w; gx += gridStep) {
      ctxBev.beginPath(); ctxBev.moveTo(gx, 0); ctxBev.lineTo(gx, h); ctxBev.stroke();
    }
    for (let gy = cy % gridStep; gy < h; gy += gridStep) {
      ctxBev.beginPath(); ctxBev.moveTo(0, gy); ctxBev.lineTo(w, gy); ctxBev.stroke();
    }

    // ── RANGE ARCS ───────────────────────────────────────────────────────
    [10, 20, 30, 40, 50, 60].forEach(rM => {
      const rPx = rM * scale;
      if (cy - rPx < -15) return;
      ctxBev.beginPath();
      ctxBev.arc(cx, cy, rPx, Math.PI, 0, false);
      ctxBev.strokeStyle = 'rgba(56,189,248,0.25)';
      ctxBev.lineWidth = 1;
      ctxBev.setLineDash([3, 4]);
      ctxBev.stroke();
      ctxBev.setLineDash([]);
      ctxBev.fillStyle = '#64748b';
      ctxBev.font = 'bold 9px Segoe UI';
      ctxBev.textAlign = 'left';
      ctxBev.fillText(`${rM}m`, cx + rPx + 3, cy - 2);
    });

    // ── SWEEPING RADAR CONE ───────────────────────────────────────────────
    const tSweep    = Date.now() * 0.0022;
    const sweepAng  = (Math.PI / 2) + Math.sin(tSweep) * 0.55;
    const sweepLen  = 58 * scale;
    const rGrad     = ctxBev.createRadialGradient(cx, cy, 8, cx, cy, sweepLen);
    rGrad.addColorStop(0, 'rgba(14,165,233,0.30)');
    rGrad.addColorStop(1, 'rgba(14,165,233,0.0)');
    ctxBev.fillStyle = rGrad;
    ctxBev.beginPath();
    ctxBev.moveTo(cx, cy);
    ctxBev.arc(cx, cy, sweepLen, Math.PI + 0.35, -0.35, false);
    ctxBev.closePath();
    ctxBev.fill();
    // Needle
    const bx = cx + Math.cos(Math.PI - sweepAng) * sweepLen;
    const by = cy - Math.sin(Math.PI - sweepAng) * sweepLen;
    ctxBev.beginPath();
    ctxBev.moveTo(cx, cy); ctxBev.lineTo(bx, by);
    ctxBev.strokeStyle = 'rgba(56,189,248,0.80)';
    ctxBev.lineWidth = 1.5;
    ctxBev.stroke();

    // ── ROAD BOUNDARIES ───────────────────────────────────────────────────
    const halfRw = ROAD_WIDTH * 0.5;
    // Left edge
    ctxBev.beginPath();
    for (let rY = 0; rY <= 60; rY += 2) {
      const rc  = getRoadCenter(av.y + rY);
      const sx  = cx + (rc - halfRw - av.x) * scale;
      const sy  = cy - rY * scale;
      if (rY === 0) ctxBev.moveTo(sx, sy); else ctxBev.lineTo(sx, sy);
    }
    ctxBev.strokeStyle = '#38bdf8'; ctxBev.lineWidth = 1.5; ctxBev.stroke();

    // Right edge
    ctxBev.beginPath();
    for (let rY = 0; rY <= 60; rY += 2) {
      const rc  = getRoadCenter(av.y + rY);
      const sx  = cx + (rc + halfRw - av.x) * scale;
      const sy  = cy - rY * scale;
      if (rY === 0) ctxBev.moveTo(sx, sy); else ctxBev.lineTo(sx, sy);
    }
    ctxBev.strokeStyle = '#38bdf8'; ctxBev.lineWidth = 1.5; ctxBev.stroke();

    // Road fill (transparent)
    ctxBev.beginPath();
    for (let rY = 0; rY <= 60; rY += 2) {
      const rc = getRoadCenter(av.y + rY);
      const sx = cx + (rc - halfRw - av.x) * scale;
      const sy = cy - rY * scale;
      if (rY === 0) ctxBev.moveTo(sx, sy); else ctxBev.lineTo(sx, sy);
    }
    for (let rY = 60; rY >= 0; rY -= 2) {
      const rc = getRoadCenter(av.y + rY);
      const sx = cx + (rc + halfRw - av.x) * scale;
      const sy = cy - rY * scale;
      ctxBev.lineTo(sx, sy);
    }
    ctxBev.closePath();
    ctxBev.fillStyle = 'rgba(56,189,248,0.05)';
    ctxBev.fill();

    // Centre dashed yellow line
    ctxBev.beginPath();
    for (let rY = 0; rY <= 60; rY += 2) {
      const rc = getRoadCenter(av.y + rY);
      const sx = cx + (rc - av.x) * scale;
      const sy = cy - rY * scale;
      if (rY === 0) ctxBev.moveTo(sx, sy); else ctxBev.lineTo(sx, sy);
    }
    ctxBev.strokeStyle = 'rgba(250,204,21,0.55)';
    ctxBev.lineWidth = 1;
    ctxBev.setLineDash([4, 4]);
    ctxBev.stroke();
    ctxBev.setLineDash([]);

    // ── CANDIDATE TRAJECTORY SPLINES ─────────────────────────────────────
    [
      { name: 'ROUTE A', col: '#38bdf8' },
      { name: 'ROUTE B', col: '#a78bfa' },
      { name: 'ROUTE C', col: '#f59e0b' }
    ].forEach(r => {
      const isSel = (r.name === av.selectedRoute);
      ctxBev.beginPath();
      for (let rY = 0; rY <= 45; rY += 2) {
        const blend = Math.min(1.0, rY / 14.0);
        const rc    = getRoadCenter(av.y + rY);
        const lat   = av.x + (routes[r.name].offset - av.x) * blend;
        const sx    = cx + (rc + lat - av.x) * scale;
        const sy    = cy - rY * scale;
        if (rY === 0) ctxBev.moveTo(sx, sy); else ctxBev.lineTo(sx, sy);
      }
      ctxBev.strokeStyle = isSel ? '#10b981' : r.col;
      ctxBev.lineWidth   = isSel ? 3.5 : 1.2;
      ctxBev.stroke();
    });

    // ── RISK HEATMAP OVERLAY (near ego) ───────────────────────────────────
    entities.forEach(ent => {
      const relY = ent.y - av.y;
      const relX = ent.x - av.x;
      if (relY < -2 || relY > 62) return;
      const ex = cx + relX * scale;
      const ey = cy - relY * scale;
      const dist = Math.hypot(relX, relY);
      if (dist < 20.0) {
        const haloR = Math.max(10, (20.0 - dist) * scale * 0.55);
        ctxBev.beginPath();
        ctxBev.arc(ex, ey, haloR, 0, Math.PI * 2);
        ctxBev.strokeStyle = `rgba(248,81,73,${Math.min(0.9, 0.3 + (20 - dist) * 0.03)})`;
        ctxBev.setLineDash([2, 3]);
        ctxBev.lineWidth = 1.5;
        ctxBev.stroke();
        ctxBev.setLineDash([]);
      }
    });

    // ── TRAFFIC ENTITIES ──────────────────────────────────────────────────
    entities.forEach(ent => {
      const relY = ent.y - av.y;
      const relX = ent.x - av.x;
      if (relY < -2 || relY > 62) return;
      const ex = cx + relX * scale;
      const ey = cy - relY * scale;
      const bw = Math.max(6, ent.width  * scale);
      const bl = Math.max(8, ent.length * scale);

      ctxBev.fillStyle = (ent.className === 'Crossing-Car') ? '#0284c7' : ent.colorMain;
      ctxBev.fillRect(ex - bw*0.5, ey - bl*0.5, bw, bl);
      ctxBev.strokeStyle = '#ffffff';
      ctxBev.lineWidth = 1;
      ctxBev.strokeRect(ex - bw*0.5, ey - bl*0.5, bw, bl);

      // Label
      ctxBev.fillStyle = '#e0f2fe';
      ctxBev.font = 'bold 8px Segoe UI';
      ctxBev.textAlign = 'left';
      ctxBev.fillText(ent.className.slice(0, 5), ex + bw*0.6, ey + 3);

      // Velocity arrow
      ctxBev.beginPath();
      ctxBev.moveTo(ex, ey);
      ctxBev.lineTo(ex + ent.vx * 8, ey - Math.max(6, ent.vy * 3.5));
      ctxBev.strokeStyle = '#38bdf8';
      ctxBev.lineWidth = 1.8;
      ctxBev.stroke();
    });

    // ── EGO VEHICLE (centre-bottom of BEV) ───────────────────────────────
    const egoW = 1.8 * scale;
    const egoL = 4.2 * scale;
    ctxBev.save();
    ctxBev.translate(cx, cy);
    ctxBev.rotate((-av.steerDeg * Math.PI) / 180 * 0.4);

    ctxBev.fillStyle   = '#0284c7';
    ctxBev.shadowColor = '#38bdf8';
    ctxBev.shadowBlur  = 10;
    ctxBev.fillRect(-egoW*0.5, -egoL*0.5, egoW, egoL);
    ctxBev.shadowBlur  = 0;
    ctxBev.strokeStyle = '#ffffff';
    ctxBev.lineWidth   = 1.2;
    ctxBev.strokeRect(-egoW*0.5, -egoL*0.5, egoW, egoL);

    // Headlight beams
    ctxBev.fillStyle = 'rgba(254,240,138,0.22)';
    ctxBev.beginPath();
    ctxBev.moveTo(-egoW*0.4, -egoL*0.5);
    ctxBev.lineTo(-egoW*1.6, -egoL*2.0);
    ctxBev.lineTo(egoW*1.6,  -egoL*2.0);
    ctxBev.lineTo(egoW*0.4,  -egoL*0.5);
    ctxBev.closePath();
    ctxBev.fill();

    // Safety perimeter
    ctxBev.beginPath();
    ctxBev.ellipse(0, 0, egoW*1.7, egoL*1.5, 0, 0, Math.PI*2);
    ctxBev.strokeStyle = 'rgba(56,189,248,0.65)';
    ctxBev.setLineDash([3, 3]);
    ctxBev.lineWidth = 1;
    ctxBev.stroke();
    ctxBev.setLineDash([]);

    ctxBev.restore();

    // ── BEV TITLE LABEL (in-canvas) ───────────────────────────────────────
    ctxBev.fillStyle = 'rgba(0,0,0,0.55)';
    ctxBev.beginPath();
    ctxBev.roundRect(6, 6, 180, 20, 3);
    ctxBev.fill();
    ctxBev.fillStyle = '#38bdf8';
    ctxBev.font = 'bold 10px Segoe UI';
    ctxBev.textAlign = 'left';
    ctxBev.fillText('⬟ LOCAL TOP-DOWN RISK MAP (BEV)', 12, 20);

    // Speed label
    ctxBev.fillStyle = av.speedKmh < 1 ? '#ef4444' : '#10b981';
    ctxBev.font = 'bold 11px Consolas';
    ctxBev.textAlign = 'right';
    ctxBev.fillText(`${av.speedKmh.toFixed(1)} km/h`, w - 10, 20);
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  STEERING DIAL
  // ─────────────────────────────────────────────────────────────────────────
  function renderSteerDial() {
    const w = canvasSteer.width, h = canvasSteer.height;
    ctxSteer.clearRect(0, 0, w, h);
    const cx = w * 0.5, cy = h * 0.85;
    const radius = Math.min(w * 0.42, h * 0.72);

    ctxSteer.beginPath();
    ctxSteer.arc(cx, cy, radius, Math.PI, 0, false);
    ctxSteer.strokeStyle = '#30363d'; ctxSteer.lineWidth = 4; ctxSteer.stroke();

    const angle  = (Math.PI / 2) + (av.steerDeg * (Math.PI / 180));
    const nx     = cx + Math.sin(angle) * (radius - 4);
    const ny     = cy - Math.cos(angle) * (radius - 4);

    ctxSteer.beginPath();
    ctxSteer.moveTo(cx, cy); ctxSteer.lineTo(nx, ny);
    ctxSteer.strokeStyle = '#ef4444'; ctxSteer.lineWidth = 2.5; ctxSteer.stroke();

    ctxSteer.beginPath();
    ctxSteer.arc(cx, cy, 3.5, 0, Math.PI * 2);
    ctxSteer.fillStyle = '#f0f6fc'; ctxSteer.fill();
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  UI SYNC
  // ─────────────────────────────────────────────────────────────────────────
  function syncUI() {
    const crossing = allowsCrossing(av.scenarioName);
    const label    = getDrivingLabel();

    // Status pill
    const pill = document.getElementById('simStatusPill');
    if (pill) {
      pill.textContent = av.isPaused ? 'SIM PAUSED' : 'SIM RUNNING';
      pill.style.background = av.isPaused ? '#78350f' : '#064e3b';
      pill.style.color      = av.isPaused ? '#fef08a' : '#6ee7b7';
    }

    // Detection table
    const probBox = document.getElementById('probTableRows');
    if (probBox) {
      let html = '';
      entities.forEach(ent => {
        const dy = Math.max(0.1, ent.y - av.y);
        if (dy < 65) {
          html += `<div class="prob-row">
            <div class="th-class" style="color:${ent.colorMain};font-weight:700">${ent.className.slice(0,9)}</div>
            <div class="th-dist">${dy.toFixed(1)}m</div>
            <div class="th-pdet">${ent.pDet}</div>
            <div class="th-cmot">${ent.cMot}</div>
            <div class="th-risk" style="color:${ent.risk>0.4?'var(--status-danger)':'var(--text-primary)'}">${ent.risk}</div>
          </div>`;
        }
      });
      probBox.innerHTML = html;
    }

    // Corridors
    ['Left','Center','Right'].forEach(cId => {
      const k   = `${cId.toUpperCase()} CORRIDOR`;
      const val = corridors[k].traversability;
      const sta = corridors[k].status;
      const bar   = document.getElementById(`bar${cId}`);
      const valEl = document.getElementById(`val${cId}`);
      const badge = document.getElementById(`badge${cId}`);
      if (bar) {
        bar.style.width      = `${Math.round(val*100)}%`;
        bar.style.background = val > 0.60 ? 'var(--status-ok)' : (val > 0.35 ? 'var(--status-warning)' : 'var(--status-danger)');
      }
      if (valEl) valEl.textContent = val.toFixed(2);
      if (badge) { badge.textContent = sta; badge.className = `corridor-badge ${sta.toLowerCase()}`; }
    });

    // Routes
    ['A','B','C'].forEach(rid => {
      const rk   = `ROUTE ${rid}`;
      const r    = routes[rk];
      const isSel = (av.selectedRoute === rk);
      const box   = document.getElementById(`boxRoute${rid}`);
      const stat  = document.getElementById(`statRoute${rid}`);
      const sLbl  = document.getElementById(`safetyRoute${rid}`);
      const rLbl  = document.getElementById(`riskRoute${rid}`);
      const cLbl  = document.getElementById(`clrRoute${rid}`);
      if (box)  box.className = isSel ? 'route-box selected' : 'route-box';
      if (stat) { stat.textContent = isSel ? 'SELECTED' : 'CANDIDATE'; stat.style.color = isSel ? 'var(--status-ok)' : 'var(--text-muted)'; }
      if (sLbl) sLbl.textContent = `Safety: ${r.safetyScore.toFixed(2)}`;
      if (rLbl) rLbl.textContent = `Risk: ${r.dynamicRisk.toFixed(2)}`;
      if (cLbl) cLbl.textContent = `Clr: ${r.minClearanceM.toFixed(1)}m`;
    });

    // Feasibility badge
    const feasBadge = document.getElementById('feasDecisionBadge');
    if (feasBadge) {
      if (crossing) {
        feasBadge.textContent = 'ROAD CROSSING: PERMITTED (UNSTRUCTURED BYPASS)';
        feasBadge.style.background = '#064e3b'; feasBadge.style.color = '#6ee7b7';
      } else {
        feasBadge.textContent = 'ROAD CROSSING: PROHIBITED (LANE-KEEPING)';
        feasBadge.style.background = '#1e3a8a'; feasBadge.style.color = '#93c5fd';
      }
    }

    // Telemetry
    const spd = document.getElementById('telSpeedVal');
    if (spd) {
      spd.textContent = av.speedKmh.toFixed(1);
      spd.style.color = av.speedKmh < 1 ? 'var(--status-danger)' : av.speedKmh < MANEUVER_SPD ? 'var(--status-warning)' : 'var(--text-accent)';
    }
    const mode = document.getElementById('telModeBadge');
    if (mode) {
      mode.textContent = label;
      mode.style.background = av.drivingState === DS.STOPPED ? '#7f1d1d'
                            : av.drivingState === DS.DECELERATING ? '#78350f'
                            : av.drivingState === DS.STEERING ? '#1e3a8a'
                            : '#064e3b';
      mode.style.color = av.drivingState === DS.STOPPED ? '#fca5a5'
                       : av.drivingState === DS.DECELERATING ? '#fef08a'
                       : av.drivingState === DS.STEERING ? '#93c5fd'
                       : '#6ee7b7';
    }
    const steerTxt = document.getElementById('telSteerText');
    if (steerTxt) steerTxt.textContent = `STEER: ${av.steerDeg.toFixed(1)}°`;
    const accel = document.getElementById('telAccel');
    if (accel) accel.textContent = `Accel: ${(av.accelMs2 >= 0 ? '+' : '') + av.accelMs2.toFixed(1)} m/s²`;
    const hdg = document.getElementById('telHeading');
    if (hdg) hdg.textContent = `Heading: ${av.headingDeg.toFixed(1)}°`;
    const wp = document.getElementById('telWaypoint');
    if (wp) wp.textContent = `Waypoint: (${routes[av.selectedRoute].offset.toFixed(1)}, ${(av.y+15).toFixed(1)})`;
    const dst = document.getElementById('telDist');
    if (dst) dst.textContent = `Dist: ${av.distM.toFixed(1)} m`;

    // Metrics
    const mComp = document.getElementById('mCompletion');
    if (mComp) mComp.textContent = `${av.completionPct}%`;
    const mColl = document.getElementById('mCollision');
    if (mColl) { mColl.textContent = av.collisionDetected ? 'COLLISION' : 'NONE'; mColl.style.color = av.collisionDetected ? 'var(--status-danger)' : 'var(--status-ok)'; }
    const mRep = document.getElementById('mReplans');
    if (mRep) mRep.textContent = av.replansCount;
    const mLat = document.getElementById('mLatency');
    if (mLat) mLat.textContent = `${av.replanLatencyMs} ms`;
    const mClr = document.getElementById('mClearance');
    if (mClr) mClr.textContent = `${routes[av.selectedRoute].minClearanceM} m`;
    const mSm  = document.getElementById('mSmoothness');
    if (mSm) mSm.textContent = av.pathSmoothness;
    const mCyc = document.getElementById('mCycleTime');
    if (mCyc) mCyc.textContent = `${av.cycleTimeMs} ms`;
    const mScen = document.getElementById('mScenarioMode');
    if (mScen) mScen.textContent = av.scenarioName;
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  ANIMATION LOOP
  // ─────────────────────────────────────────────────────────────────────────
  let lastT = performance.now();
  function loop(now) {
    const dt = Math.min(0.04, (now - lastT) / 1000.0);
    lastT = now;

    updateSimulation(dt);
    renderMainScene();
    renderBevMap();
    renderSteerDial();
    syncUI();

    requestAnimationFrame(loop);
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  GLOBAL ACTIONS
  // ─────────────────────────────────────────────────────────────────────────
  window.toggleBevExpanded = function () {
    av.bevExpanded = !av.bevExpanded;
    const bb  = document.querySelector('.bottom-band');
    const btn = document.getElementById('btnToggleBevSize');
    if (bb)  bb.classList.toggle('bev-maximized', av.bevExpanded);
    if (btn) btn.textContent = av.bevExpanded ? '🗗 NORMAL BEV' : '⛶ ENLARGE BEV';
    setTimeout(resizeAll, 50);
  };

  window.togglePause = function () {
    av.isPaused = !av.isPaused;
    const btn = document.getElementById('btnPlayPause');
    if (btn) btn.textContent = av.isPaused ? '▶ RESUME' : '⏸ PAUSE';
  };

  window.stepOnce = function () {
    av.isPaused = false;
    updateSimulation(TIME_STEP);
    av.isPaused = true;
    const btn = document.getElementById('btnPlayPause');
    if (btn) btn.textContent = '▶ RESUME';
  };

  window.resetSim = function () {
    av.x = 0; av.y = 0;
    av.activeOffsetX = 0; av.targetOffsetX = 0;
    av.speedKmh = CRUISE_SPD;
    av.drivingState = DS.CRUISE;
    av.steerDeg = 0;
    av.selectedRoute = 'ROUTE B';
    av.pendingRoute  = 'ROUTE B';
    av.replansCount  = 0;
    av.stopWaitTimer = 0;
    av.steerPhaseStarted = false;
    av.bypassAttempted   = false;
    entities = SCENARIOS[av.scenarioName]();
    resizeAll();
  };

  window.manualUnstick = function () {
    av.x = 0; av.activeOffsetX = 0; av.targetOffsetX = 0;
    av.speedKmh = 10.0;
    av.drivingState = DS.RESUMING;
    av.bypassAttempted = false;
  };

  window.toggleTheme = function () {
    const cur  = document.documentElement.getAttribute('data-theme') || 'night';
    const next = cur === 'night' ? 'day' : 'night';
    document.documentElement.setAttribute('data-theme', next);
    const btn = document.getElementById('btnTheme');
    if (btn) btn.textContent = next === 'night' ? '☀️ DAY THEME' : '🌙 NIGHT THEME';
  };

  window.onScenarioChange = function (val) {
    if (SCENARIOS[val]) {
      av.scenarioName = val;
      window.resetSim();
    }
  };

  window.toggleElevateCamera = function () {
    av.cameraElevated = !av.cameraElevated;
    const btn = document.getElementById('btnElevate');
    if (btn) {
      btn.textContent     = av.cameraElevated ? 'RESTORE NORMAL CAM VIEW' : 'ELEVATE CAMERA VIEW';
      btn.style.background = av.cameraElevated ? '#78350f' : 'var(--btn-bg)';
      btn.style.color      = av.cameraElevated ? '#fef08a' : 'var(--text-accent)';
    }
  };

  window.triggerPedestrianEvent = function () {
    const rc  = getRoadCenter(av.y + 18.0);
    const ped = mkPedestrian(`inj_ped_${Date.now()}`, rc + 2.6, av.y + 18.0, -1.8, 0.2);
    ped.customBehavior = (p, dt) => { p.x += p.vx * dt; p.y += p.vy * dt; };
    entities.push(ped);
  };

  window.triggerObstacleEvent = function () {
    const rc  = getRoadCenter(av.y + 20.0);
    const obs = mkObstacle(`inj_rock_${Date.now()}`, rc, av.y + 20.0);
    entities.push(obs);
  };

  window.toggleOcclusionEvent = function () {
    av.cameraOccluded = !av.cameraOccluded;
    const banner   = document.getElementById('occlusionBanner');
    const badgeCam = document.getElementById('badgeCamera');
    const confCam  = document.getElementById('confCamera');
    if (banner) {
      banner.textContent     = av.cameraOccluded ? 'VIEW: CAMERA OCCLUDED (TRUCK SMOKE)' : 'VIEW: CLEAR LINE-OF-SIGHT';
      banner.style.background = av.cameraOccluded ? '#7f1d1d' : '#064e3b';
      banner.style.color      = av.cameraOccluded ? '#fca5a5' : '#a7f3d0';
    }
    if (badgeCam) {
      badgeCam.textContent = av.cameraOccluded ? 'OCCLUDED' : 'ACTIVE';
      badgeCam.className   = `sensor-badge ${av.cameraOccluded ? 'occluded' : 'active'}`;
    }
    if (confCam) confCam.textContent = av.cameraOccluded ? '0.22' : '0.92';
  };

  // ── KEYBOARD SHORTCUTS ────────────────────────────────────────────────
  window.addEventListener('keydown', e => {
    switch (e.code) {
      case 'Space':
        e.preventDefault();
        window.togglePause();
        break;
      case 'KeyR':
        window.resetSim();
        break;
      case 'KeyT':
        window.toggleTheme();
        break;
      case 'KeyU':
        window.manualUnstick();
        break;
      case 'Digit1': case 'Digit2': case 'Digit3': case 'Digit4': case 'Digit5': {
        const idx = parseInt(e.key) - 1;
        const sel = Object.keys(SCENARIOS)[idx];
        if (sel) {
          const dd = document.getElementById('scenarioSelect');
          if (dd) dd.value = sel;
          window.onScenarioChange(sel);
        }
        break;
      }
      case 'ArrowLeft':
        av.pendingRoute   = 'ROUTE A';
        av.targetOffsetX  = routes['ROUTE A'].offset;
        av.drivingState   = DS.DECELERATING;
        break;
      case 'ArrowDown':
        av.pendingRoute   = 'ROUTE B';
        av.targetOffsetX  = routes['ROUTE B'].offset;
        av.drivingState   = DS.DECELERATING;
        break;
      case 'ArrowRight':
        av.pendingRoute   = 'ROUTE C';
        av.targetOffsetX  = routes['ROUTE C'].offset;
        av.drivingState   = DS.DECELERATING;
        break;
    }
  });

  // ── START ─────────────────────────────────────────────────────────────
  requestAnimationFrame(loop);
})();
