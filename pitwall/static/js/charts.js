/**
 * charts.js — Live mini chart rendering
 * Draws three live-updating charts using raw Canvas 2D:
 *   - Gap to leader (seconds)
 *   - Tyre degradation delta (seconds vs fresh)
 *   - Lap time trend (raw lap seconds)
 *
 * Each chart stores a rolling history of values and redraws
 * from scratch each lap for clean, consistent rendering.
 */

// ── History buffers — rolling window of last N laps ───────────────────────
const HISTORY_SIZE = 45;   // How many laps to show on each chart

const gapHistory  = [];    // Gap-to-leader history (user P1 driver)
const degHistory  = [];    // Tyre delta history
const lapHistory  = [];    // Raw lap time history

// Canvas references (set after DOM is ready)
let gapCanvas, degCanvas, lapCanvas;
let gapCtx, degCtx, lapCtx;

/**
 * Initialise chart canvases. Called once the app starts.
 */
function chartsInit() {
  gapCanvas = document.getElementById('gap-chart');
  degCanvas = document.getElementById('deg-chart');
  lapCanvas = document.getElementById('lap-chart');

  if (gapCanvas) gapCtx = gapCanvas.getContext('2d');
  if (degCanvas) degCtx = degCanvas.getContext('2d');
  if (lapCanvas) lapCtx = lapCanvas.getContext('2d');
}

/**
 * Push a new data point and redraw all three charts.
 * Throttled to every 2 laps — charts don't need 60fps updates.
 *
 * @param {number} gap      - Gap to leader in seconds
 * @param {number} tyreDelta - Tyre performance delta in seconds
 * @param {number} lapTime  - Raw lap time in seconds
 */
let _chartPushCount = 0;
function chartsPush(gap, tyreDelta, lapTime) {
  gapHistory.push(gap);
  degHistory.push(tyreDelta);
  lapHistory.push(lapTime);

  if (gapHistory.length  > HISTORY_SIZE) gapHistory.shift();
  if (degHistory.length  > HISTORY_SIZE) degHistory.shift();
  if (lapHistory.length  > HISTORY_SIZE) lapHistory.shift();

  // Only redraw charts every 2 laps — they're slow to render
  _chartPushCount++;
  if (_chartPushCount % 2 !== 0) return;

  drawChart(gapCtx, gapCanvas, gapHistory,  '#3A9BD5', false);
  drawChart(degCtx, degCanvas, degHistory,  '#F0A500', true);
  drawChart(lapCtx, lapCanvas, lapHistory,  '#1BAF5B', false);
}

/**
 * Clear all chart history. Called on reset.
 */
function chartsReset() {
  gapHistory.length = 0;
  degHistory.length = 0;
  lapHistory.length = 0;
  _chartPushCount   = 0;
}

/**
 * Core chart drawing function.
 * Draws a filled area line chart with grid, labels, and a live dot.
 *
 * @param {CanvasRenderingContext2D} ctx     - Canvas context
 * @param {HTMLCanvasElement}        canvas  - Canvas element
 * @param {number[]}                 data    - Array of values to plot
 * @param {string}                   color   - Line and fill colour (hex)
 * @param {boolean}                  zeroCentre - If true, draw a zero reference line
 */
function drawChart(ctx, canvas, data, color, zeroCentre) {
  if (!ctx || !canvas || data.length < 2) return;

  // Match canvas pixel size to its display size
  const w = canvas.parentElement?.clientWidth  || canvas.offsetWidth  || 200;
  const h = canvas.parentElement?.clientHeight || canvas.offsetHeight || 100;
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width  = w;
    canvas.height = h;
  }

  // Layout padding
  const pad = { top: 8, right: 10, bottom: 18, left: 38 };
  const cw  = w - pad.left - pad.right;
  const ch  = h - pad.top  - pad.bottom;

  // Clear background
  ctx.fillStyle = '#0B1F3A';
  ctx.fillRect(0, 0, w, h);

  // Calculate data range with a small buffer
  const min   = Math.min(...data);
  const max   = Math.max(...data);
  const range = Math.max(max - min, 0.2);
  const lo    = min - range * 0.1;
  const hi    = max + range * 0.1;

  // Helper: convert data value to canvas Y coordinate
  const toY = v => pad.top + ch * (1 - (v - lo) / (hi - lo));

  // Helper: convert index to canvas X coordinate
  const toX = i => pad.left + (i / (data.length - 1)) * cw;

  // ── Grid lines & Y-axis labels ────────────────────────────────────────
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth   = 1;
  ctx.font        = '8px "Share Tech Mono"';
  ctx.fillStyle   = 'rgba(255,255,255,0.22)';
  ctx.textAlign   = 'right';

  const gridCount = 4;
  for (let i = 0; i <= gridCount; i++) {
    const v = lo + (i / gridCount) * (hi - lo);
    const y = toY(v);

    // Grid line
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(pad.left + cw, y);
    ctx.stroke();

    // Y label
    ctx.fillText(v.toFixed(1), pad.left - 4, y + 3);
  }

  // ── Zero reference line (for deg chart) ──────────────────────────────
  if (zeroCentre && lo < 0 && hi > 0) {
    const zeroY = toY(0);
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth   = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(pad.left, zeroY);
    ctx.lineTo(pad.left + cw, zeroY);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // ── Area fill ─────────────────────────────────────────────────────────
  const baselineY = zeroCentre ? toY(0) : pad.top + ch;

  ctx.beginPath();
  data.forEach((v, i) => {
    const x = toX(i);
    const y = toY(v);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.lineTo(toX(data.length - 1), baselineY);
  ctx.lineTo(toX(0), baselineY);
  ctx.closePath();

  const grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + ch);
  grad.addColorStop(0, color + '55');
  grad.addColorStop(1, color + '08');
  ctx.fillStyle = grad;
  ctx.fill();

  // ── Line ──────────────────────────────────────────────────────────────
  ctx.beginPath();
  data.forEach((v, i) => {
    const x = toX(i);
    const y = toY(v);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.strokeStyle = color;
  ctx.lineWidth   = 2;
  ctx.lineJoin    = 'round';
  ctx.lineCap     = 'round';
  ctx.stroke();

  // ── Live value dot ────────────────────────────────────────────────────
  const lastX = toX(data.length - 1);
  const lastY = toY(data[data.length - 1]);

  // Outer ring
  ctx.beginPath();
  ctx.arc(lastX, lastY, 5, 0, Math.PI * 2);
  ctx.fillStyle = color + '40';
  ctx.fill();

  // Inner dot
  ctx.beginPath();
  ctx.arc(lastX, lastY, 3, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();

  // ── Latest value label ───────────────────────────────────────────────
  ctx.fillStyle   = color;
  ctx.textAlign   = 'left';
  ctx.font        = 'bold 9px "Share Tech Mono"';
  const labelVal  = data[data.length - 1];
  const labelTxt  = (labelVal >= 0 ? '+' : '') + labelVal.toFixed(2);
  ctx.fillText(labelTxt, lastX + 6, lastY + 3);

  ctx.textAlign = 'left';
}
