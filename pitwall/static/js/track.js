/**
 * track.js — Canvas track drawing module (OPTIMISED)
 *
 * Performance improvements over v1:
 *  - Offscreen canvas for the static track background (drawn ONCE, composited each frame)
 *  - requestAnimationFrame render loop — decoupled from the lap timer so animation is smooth
 *  - Car positions smoothly interpolated between lap snapshots (no jitter)
 *  - Shadow/glow effects only on user cars (shadows are the #1 canvas perf killer)
 *  - Minimal per-frame overdraw — only cars layer redraws each frame
 */

// ── Track path templates (normalised 0-1 coordinates) ─────────────────────
// Each circuit has a unique path approximation. Points form a closed loop.

const TRACK_PATHS = {

  "Albert Park": [
    {x:.50,y:.12},{x:.68,y:.10},{x:.80,y:.18},{x:.86,y:.30},
    {x:.83,y:.44},{x:.72,y:.52},{x:.76,y:.64},{x:.70,y:.76},
    {x:.55,y:.82},{x:.40,y:.80},{x:.28,y:.72},{x:.20,y:.58},
    {x:.22,y:.44},{x:.30,y:.32},{x:.40,y:.20},{x:.50,y:.12},
  ],

  "Shanghai": [
    {x:.48,y:.10},{x:.70,y:.10},{x:.84,y:.20},{x:.88,y:.36},
    {x:.80,y:.50},{x:.82,y:.64},{x:.74,y:.76},{x:.58,y:.82},
    {x:.42,y:.80},{x:.26,y:.72},{x:.18,y:.56},{x:.20,y:.40},
    {x:.30,y:.26},{x:.40,y:.16},{x:.48,y:.10},
  ],

  "Suzuka": [
    {x:.52,y:.08},{x:.72,y:.12},{x:.84,y:.24},{x:.86,y:.40},
    {x:.76,y:.52},{x:.82,y:.62},{x:.76,y:.72},{x:.62,y:.78},
    {x:.48,y:.80},{x:.32,y:.74},{x:.20,y:.62},{x:.16,y:.46},
    {x:.22,y:.32},{x:.36,y:.18},{x:.52,y:.08},
  ],

  "Bahrain Int'l": [
    {x:.50,y:.10},{x:.68,y:.08},{x:.82,y:.16},{x:.88,y:.30},
    {x:.84,y:.46},{x:.74,y:.54},{x:.80,y:.66},{x:.72,y:.76},
    {x:.56,y:.84},{x:.38,y:.82},{x:.24,y:.72},{x:.16,y:.56},
    {x:.18,y:.40},{x:.28,y:.26},{x:.40,y:.16},{x:.50,y:.10},
  ],

  "Jeddah Corniche": [
    {x:.52,y:.08},{x:.70,y:.06},{x:.84,y:.14},{x:.90,y:.28},
    {x:.88,y:.44},{x:.82,y:.58},{x:.84,y:.70},{x:.76,y:.80},
    {x:.60,y:.86},{x:.42,y:.84},{x:.28,y:.76},{x:.18,y:.62},
    {x:.16,y:.46},{x:.22,y:.30},{x:.36,y:.16},{x:.52,y:.08},
  ],

  "Barcelona": [
    {x:.50,y:.14},{x:.72,y:.12},{x:.84,y:.22},{x:.88,y:.36},
    {x:.82,y:.48},{x:.74,y:.56},{x:.80,y:.68},{x:.74,y:.78},
    {x:.58,y:.84},{x:.40,y:.82},{x:.24,y:.74},{x:.16,y:.58},
    {x:.18,y:.42},{x:.26,y:.28},{x:.38,y:.18},{x:.50,y:.14},
  ],

  "Monte Carlo": [
    {x:.52,y:.12},{x:.66,y:.10},{x:.76,y:.18},{x:.80,y:.30},
    {x:.76,y:.42},{x:.84,y:.54},{x:.80,y:.66},{x:.68,y:.74},
    {x:.54,y:.80},{x:.38,y:.76},{x:.26,y:.66},{x:.20,y:.52},
    {x:.22,y:.38},{x:.30,y:.26},{x:.42,y:.16},{x:.52,y:.12},
  ],

  "Gilles Villeneuve": [
    {x:.50,y:.10},{x:.70,y:.12},{x:.82,y:.22},{x:.86,y:.38},
    {x:.78,y:.52},{x:.82,y:.64},{x:.76,y:.76},{x:.60,y:.82},
    {x:.42,y:.80},{x:.26,y:.70},{x:.18,y:.54},{x:.20,y:.38},
    {x:.28,y:.24},{x:.40,y:.14},{x:.50,y:.10},
  ],

  "Silverstone": [
    {x:.50,y:.10},{x:.70,y:.10},{x:.84,y:.20},{x:.90,y:.36},
    {x:.84,y:.52},{x:.76,y:.60},{x:.80,y:.72},{x:.68,y:.80},
    {x:.50,y:.84},{x:.34,y:.80},{x:.22,y:.70},{x:.14,y:.54},
    {x:.16,y:.38},{x:.26,y:.24},{x:.40,y:.14},{x:.50,y:.10},
  ],

  "Monza": [
    {x:.50,y:.08},{x:.74,y:.10},{x:.88,y:.20},{x:.90,y:.36},
    {x:.82,y:.50},{x:.78,y:.60},{x:.84,y:.70},{x:.88,y:.80},
    {x:.76,y:.88},{x:.56,y:.90},{x:.38,y:.88},{x:.18,y:.78},
    {x:.12,y:.62},{x:.16,y:.46},{x:.22,y:.30},{x:.36,y:.16},
    {x:.50,y:.08},
  ],

  "Marina Bay": [
    {x:.50,y:.10},{x:.66,y:.08},{x:.78,y:.16},{x:.84,y:.28},
    {x:.80,y:.40},{x:.86,y:.50},{x:.82,y:.62},{x:.72,y:.70},
    {x:.60,y:.76},{x:.56,y:.86},{x:.44,y:.86},{x:.34,y:.78},
    {x:.24,y:.68},{x:.16,y:.54},{x:.18,y:.40},{x:.26,y:.28},
    {x:.38,y:.18},{x:.50,y:.10},
  ],

  "Yas Marina": [
    {x:.50,y:.12},{x:.70,y:.12},{x:.82,y:.22},{x:.86,y:.38},
    {x:.80,y:.52},{x:.82,y:.64},{x:.74,y:.76},{x:.58,y:.82},
    {x:.42,y:.80},{x:.26,y:.72},{x:.16,y:.56},{x:.18,y:.40},
    {x:.28,y:.26},{x:.40,y:.16},{x:.50,y:.12},
  ],
};

// Fallback generic oval if circuit not found
function genericPath() {
  const pts = [];
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2;
    pts.push({
      x: 0.5 + (0.34 + 0.05 * Math.sin(a * 3)) * Math.cos(a),
      y: 0.5 + (0.29 + 0.04 * Math.cos(a * 2)) * Math.sin(a),
    });
  }
  pts.push(pts[0]);
  return pts;
}

// ── Module state ──────────────────────────────────────────────────────────

// ── Module state ──────────────────────────────────────────────────────────

let canvas, ctx;
let offscreen, offCtx;        // Offscreen canvas holds the static track background
let canvasW = 800, canvasH = 500;
let scaledPath  = [];          // Track path in canvas pixels
let pathLengths = [];          // Cumulative arc lengths for smooth position lookup
let totalLength = 0;
let circuitName = '';

// RAF animation loop state
let rafId       = null;        // requestAnimationFrame handle
let currentSnap = null;        // Latest lap snapshot to render
let carPositions = {};         // Smoothed {id: {x,y,tx,ty}} — current and target XY
let lastFrameTime = 0;

// ── Race circulation state ──────────────────────────────────────────────
// Cars actually drive AROUND the track. A continuous "race phase" advances by
// one lap each snapshot; the RAF loop eases the rendered phase toward it so the
// field sweeps smoothly. Each car sits at phase minus its gap (in lap-fractions)
// behind the leader — so on-track spacing reflects the real time gaps.
const LAP_REF        = 92;   // seconds ≈ one full lap of track for gap→distance
let   racePhaseTarget  = 0;  // laps completed (integer steps)
let   racePhaseCurrent = 0;  // smoothed phase actually rendered
let   focusedCarId     = null; // car the user clicked to follow (null = user cars)

/**
 * Initialise the track canvas for a given circuit.
 * Creates an offscreen canvas to cache the static track background.
 */
function trackInit(name) {
  circuitName = name;
  canvas = document.getElementById('track-canvas');
  ctx    = canvas.getContext('2d', { alpha: false }); // alpha:false = faster compositing

  resizeCanvas();

  // Debounced resize handler
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      resizeCanvas();
      buildScaledPath();
      bakeTrackBackground();
    }, 150);
  });

  racePhaseTarget  = 0;
  racePhaseCurrent = 0;

  buildScaledPath();
  bakeTrackBackground();
  startRafLoop();
}

/** Follow a specific car on track (clicked in the timing tower). null = user cars. */
function trackSetFocus(id) { focusedCarId = id; }

/** Match canvas pixel dimensions to its CSS display size */
function resizeCanvas() {
  const wrap = document.getElementById('track-wrap');
  canvasW    = Math.floor(wrap.clientWidth);
  canvasH    = Math.floor(wrap.clientHeight);
  canvas.width  = canvasW;
  canvas.height = canvasH;
}

/**
 * Build the pixel-scaled track path and precompute arc lengths.
 * Only called on init and resize — not every frame.
 */
function buildScaledPath() {
  const raw   = TRACK_PATHS[circuitName] || genericPath();
  const padX  = canvasW * 0.08;
  const padY  = canvasH * 0.10;
  const drawW = canvasW - padX * 2;
  const drawH = canvasH - padY * 2;

  scaledPath = raw.map(p => ({
    x: padX + p.x * drawW,
    y: padY + p.y * drawH,
  }));

  // Precompute cumulative arc lengths for O(log n) position lookup
  pathLengths = [0];
  for (let i = 1; i < scaledPath.length; i++) {
    const dx = scaledPath[i].x - scaledPath[i - 1].x;
    const dy = scaledPath[i].y - scaledPath[i - 1].y;
    pathLengths.push(pathLengths[i - 1] + Math.sqrt(dx * dx + dy * dy));
  }
  totalLength = pathLengths[pathLengths.length - 1];
}

/**
 * Bake the static track visuals (tarmac, markings, grid texture)
 * onto an offscreen canvas. This is called once on init and on resize.
 * Each animation frame just blits this image instead of redrawing everything.
 */
function bakeTrackBackground() {
  offscreen        = document.createElement('canvas');
  offscreen.width  = canvasW;
  offscreen.height = canvasH;
  offCtx           = offscreen.getContext('2d', { alpha: false });

  const c = offCtx;

  // Background fill
  c.fillStyle = '#0B1F3A';
  c.fillRect(0, 0, canvasW, canvasH);

  // Subtle dot grid — drawn once, never again
  c.fillStyle = 'rgba(255,255,255,0.025)';
  for (let x = 20; x < canvasW; x += 40) {
    for (let y = 20; y < canvasH; y += 40) {
      c.fillRect(x, y, 1, 1);
    }
  }

  if (!scaledPath.length) return;

  const drawLine = (width, color, dash = []) => {
    c.strokeStyle = color;
    c.lineWidth   = width;
    c.lineCap     = 'round';
    c.lineJoin    = 'round';
    c.setLineDash(dash);
    c.beginPath();
    scaledPath.forEach((p, i) => i === 0 ? c.moveTo(p.x, p.y) : c.lineTo(p.x, p.y));
    c.closePath();
    c.stroke();
    c.setLineDash([]);
  };

  // Track layers (outermost to innermost)
  drawLine(30, '#1A3356');     // glow halo
  drawLine(24, '#1E2E42');     // tarmac
  drawLine(22, '#243345');     // surface
  drawLine(1,  'rgba(255,255,255,0.07)', [6, 14]); // centre dashes

  // Start / Finish line
  if (scaledPath.length >= 2) {
    const sf    = scaledPath[0];
    const sfN   = scaledPath[1];
    const angle = Math.atan2(sfN.y - sf.y, sfN.x - sf.x) + Math.PI / 2;
    c.save();
    c.translate(sf.x, sf.y);
    c.rotate(angle);
    for (let i = -2; i <= 2; i++) {
      c.fillStyle = i % 2 === 0 ? '#FFFFFF' : '#222';
      c.fillRect(i * 5, -3, 5, 6);
    }
    c.restore();
  }

  // Circuit name watermark
  c.font      = '11px "Share Tech Mono"';
  c.fillStyle = 'rgba(255,255,255,0.09)';
  c.fillText(circuitName.toUpperCase(), 14, canvasH - 32);
}

/**
 * Start the requestAnimationFrame render loop.
 * This runs at 60fps independently of the lap simulation timer.
 * Cars are smoothly interpolated between lap positions.
 */
function startRafLoop() {
  if (rafId) cancelAnimationFrame(rafId);

  function frame(timestamp) {
    rafId = requestAnimationFrame(frame);

    // Throttle to ~60fps max but don't block if tab is backgrounded
    const dt = timestamp - lastFrameTime;
    if (dt < 14) return; // skip frames faster than ~70fps
    lastFrameTime = timestamp;

    renderFrame();
  }

  rafId = requestAnimationFrame(frame);
}

/** Stop the RAF loop (called on reset) */
function trackStop() {
  if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
  currentSnap = null;
  carPositions = {};
  racePhaseTarget  = 0;
  racePhaseCurrent = 0;
  focusedCarId     = null;
}

/**
 * Returns {x, y} canvas coordinates for a normalised track progress t (0–1).
 * Uses linear interpolation between path points.
 */
function trackPositionAt(t) {
  const target = ((t % 1) + 1) % 1 * totalLength;
  let lo = 0, hi = pathLengths.length - 1;

  // Binary search for the segment
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (pathLengths[mid] <= target) lo = mid;
    else hi = mid;
  }

  const seg   = pathLengths[hi] - pathLengths[lo];
  const frac  = seg > 0 ? (target - pathLengths[lo]) / seg : 0;
  const a     = scaledPath[lo];
  const b     = scaledPath[Math.min(hi, scaledPath.length - 1)];

  return {
    x: a.x + (b.x - a.x) * frac,
    y: a.y + (b.y - a.y) * frac,
  };
}

/**
 * trackDraw — Called by app.js each lap with new data.
 * Sets the render target and advances the race phase by one lap. The RAF loop
 * eases the rendered phase toward the target so cars circulate smoothly; their
 * on-track positions are derived from gap each frame (see renderFrame).
 *
 * `scrub` = true when the user drags the lap timeline — jump phase instantly
 * (no easing animation) so scrubbing feels direct.
 */
function trackDraw(lapSnap, scrub = false) {
  if (!lapSnap?.cars) return;
  currentSnap = lapSnap;

  racePhaseTarget = lapSnap.lap;
  if (scrub) racePhaseCurrent = racePhaseTarget;
}

/**
 * renderFrame — The actual draw function, called by requestAnimationFrame at 60fps.
 * Blits the pre-baked track background, then draws only the cars layer on top.
 * This is ~10x faster than redrawing everything from scratch each frame.
 */
function renderFrame() {
  if (!ctx || !offscreen) return;

  // ── Blit pre-baked track background (single drawImage call) ───────────
  ctx.drawImage(offscreen, 0, 0);

  // ── SC / rain tints ───────────────────────────────────────────────────
  if (currentSnap?.in_sc) {
    ctx.fillStyle = 'rgba(240,165,0,0.055)';
    ctx.fillRect(0, 0, canvasW, canvasH);
  } else if (currentSnap?.is_raining) {
    ctx.fillStyle = 'rgba(0,103,255,0.06)';
    ctx.fillRect(0, 0, canvasW, canvasH);
  }

  if (!currentSnap?.cars || !scaledPath.length) return;

  // ── Ease the rendered race phase toward the target lap ────────────────
  // This is what makes the whole field sweep smoothly around the circuit.
  racePhaseCurrent += (racePhaseTarget - racePhaseCurrent) * 0.12;

  const cars      = currentSnap.cars;
  const now       = performance.now();
  const isHi      = car => car.is_user || car.id === focusedCarId;

  // Compute every car's on-track point from its gap behind the leader.
  for (const car of cars) {
    const t  = (((racePhaseCurrent - car.gap / LAP_REF) % 1) + 1) % 1;
    const p  = trackPositionAt(t);
    car._px = p.x; car._py = p.y;
  }

  // ── DRS battle links — faint line to the car ahead when within range ──
  const byPos = {};
  for (const car of cars) byPos[car.position] = car;
  ctx.lineWidth = 1.5;
  for (const car of cars) {
    if (!car.drs) continue;
    const ahead = byPos[car.position - 1];
    if (!ahead) continue;
    ctx.strokeStyle = 'rgba(57,181,74,0.55)';   // DRS green
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(car._px, car._py);
    ctx.lineTo(ahead._px, ahead._py);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // ── Rival cars (not highlighted) ──────────────────────────────────────
  for (let i = cars.length - 1; i >= 0; i--) {
    const car = cars[i];
    if (isHi(car)) continue;
    ctx.beginPath();
    ctx.arc(car._px, car._py, 5.5, 0, Math.PI * 2);
    ctx.fillStyle   = car.color;
    ctx.fill();
    ctx.strokeStyle = car.drs ? 'rgba(57,181,74,0.9)' : 'rgba(255,255,255,0.2)';
    ctx.lineWidth   = car.drs ? 1.6 : 1;
    ctx.stroke();
  }

  // ── Highlighted cars (your cars + followed car) — on top, with glow ───
  for (let i = cars.length - 1; i >= 0; i--) {
    const car = cars[i];
    if (!isHi(car)) continue;
    const followed = car.id === focusedCarId;

    // Glow ring (cheap: larger translucent circle, no shadowBlur)
    ctx.beginPath();
    ctx.arc(car._px, car._py, 12, 0, Math.PI * 2);
    ctx.fillStyle = car.color + '30';
    ctx.fill();

    // Body
    ctx.beginPath();
    ctx.arc(car._px, car._py, 9, 0, Math.PI * 2);
    ctx.fillStyle   = car.color;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth   = 2;
    ctx.stroke();

    // Followed car gets a pulsing white ring so it stands out from your cars
    if (followed) {
      const pulse = 14 + Math.sin(now / 200) * 2.5;
      ctx.beginPath();
      ctx.arc(car._px, car._py, pulse, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.65)';
      ctx.lineWidth   = 1.5;
      ctx.stroke();
    }

    // Pit flash
    if (car.pitting) {
      ctx.beginPath();
      ctx.arc(car._px, car._py, 16, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,80,0.85)';
      ctx.lineWidth   = 2.5;
      ctx.stroke();
    }
  }

  // ── Position labels — top 5 + highlighted cars ────────────────────────
  ctx.font         = 'bold 9px "Barlow Condensed"';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  for (const car of cars) {
    if (car.position > 5 && !isHi(car)) continue;
    const r = isHi(car) ? 9 : 5.5;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(`P${car.position}`, car._px, car._py - r - 7);
  }
  ctx.textAlign    = 'left';
  ctx.textBaseline = 'alphabetic';

  // ── Lap counter overlay ───────────────────────────────────────────────
  if (currentSnap) {
    ctx.font      = '10px "Share Tech Mono"';
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.fillText(`LAP ${currentSnap.lap}`, 14, canvasH - 14);

    if (currentSnap.in_sc) {
      ctx.fillStyle = 'rgba(240,165,0,0.75)';
      ctx.font      = 'bold 10px "Share Tech Mono"';
      ctx.fillText('SAFETY CAR', 80, canvasH - 14);
    } else if (currentSnap.is_raining) {
      ctx.fillStyle = 'rgba(100,180,255,0.75)';
      ctx.font      = 'bold 10px "Share Tech Mono"';
      ctx.fillText('RAIN', 80, canvasH - 14);
    }
  }
}
