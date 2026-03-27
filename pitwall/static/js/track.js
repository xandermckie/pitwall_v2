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

// Stable per-car track offsets — computed once per lap, not per frame
// Prevents flickering from Math.random() being called inside the draw loop
let carTrackOffsets = {};

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

  buildScaledPath();
  bakeTrackBackground();
  startRafLoop();
}

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
  carTrackOffsets = {};
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
 * Does NOT draw directly. Instead it:
 *   1. Stores the new snapshot as the render target
 *   2. Computes stable target positions for each car (no Math.random in RAF loop)
 *   3. Lets the RAF loop handle smooth rendering at 60fps
 */
function trackDraw(lapSnap) {
  if (!lapSnap?.cars) return;
  currentSnap = lapSnap;

  // Compute stable target track positions for this lap.
  // Stored in carTrackOffsets so the RAF loop never calls Math.random().
  lapSnap.cars.forEach(car => {
    const gapFraction   = Math.min(car.gap / 90, 0.55);
    const baseProgress  = 1.0 - gapFraction;
    // One-time stable jitter per car per lap (not per frame)
    const jitter        = (car.id * 0.00137) % 0.004;
    carTrackOffsets[car.id] = (baseProgress + jitter) % 1;
  });
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

  // ── Draw cars — reverse order so P1 renders on top ────────────────────
  const cars = currentSnap.cars;

  // Batch all non-user car circles in one path (huge perf win)
  ctx.beginPath();
  for (let i = cars.length - 1; i >= 0; i--) {
    const car = cars[i];
    if (car.is_user) continue;
    const t   = carTrackOffsets[car.id] ?? 0;
    const pos = trackPositionAt(t);
    ctx.moveTo(pos.x + 5.5, pos.y);
    ctx.arc(pos.x, pos.y, 5.5, 0, Math.PI * 2);

    // Cache position for label drawing
    car._px = pos.x;
    car._py = pos.y;
  }
  // Fill all rival cars at once
  ctx.fillStyle = '#888'; // overridden per-car below, this is just for batching
  ctx.fill();

  // Re-fill with correct colours individually (still faster than separate paths)
  for (let i = cars.length - 1; i >= 0; i--) {
    const car = cars[i];
    if (car.is_user || car._px === undefined) continue;
    ctx.beginPath();
    ctx.arc(car._px, car._py, 5.5, 0, Math.PI * 2);
    ctx.fillStyle   = car.color;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.lineWidth   = 1;
    ctx.stroke();
  }

  // ── User cars — drawn last, on top, with glow ─────────────────────────
  for (let i = cars.length - 1; i >= 0; i--) {
    const car = cars[i];
    if (!car.is_user) continue;

    const t   = carTrackOffsets[car.id] ?? 0;
    const pos = trackPositionAt(t);
    car._px = pos.x;
    car._py = pos.y;

    // Glow ring (cheap: no shadowBlur — use a slightly larger circle instead)
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, 12, 0, Math.PI * 2);
    ctx.fillStyle = car.color + '30';
    ctx.fill();

    // Car body
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, 9, 0, Math.PI * 2);
    ctx.fillStyle   = car.color;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth   = 2;
    ctx.stroke();

    // Pit flash
    if (car.pitting) {
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, 15, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,80,0.85)';
      ctx.lineWidth   = 2.5;
      ctx.stroke();
    }
  }

  // ── Position labels — only top 5 + user cars ─────────────────────────
  ctx.font      = '8px "Barlow Condensed"';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#FFFFFF';

  for (let i = 0; i < cars.length; i++) {
    const car = cars[i];
    if ((car.position > 5 && !car.is_user) || car._px === undefined) continue;
    const r = car.is_user ? 9 : 5.5;
    ctx.fillText(`P${car.position}`, car._px, car._py - r - 4);
  }

  ctx.textAlign = 'left';

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
