/**
 * app.js — Main application controller
 *
 * Responsibilities:
 *   1. Bootstrap: fetch races/teams/tyre data from Python API
 *   2. Setup UI: build dropdowns and stint form
 *   3. Simulation: POST strategy to /api/simulate, receive full lap data
 *   4. Playback: step through lap snapshots, update all UI panels
 *   5. Events: detect pit stops, overtakes, SC, rain
 */

// ── API base URL — points to the Flask Python server ──────────────────────
const API = 'http://localhost:5000';

// ── Global state ──────────────────────────────────────────────────────────
let RACE_DATA   = null;   // Full simulation response from Python
let TYRE_META   = null;   // Tyre model metadata from /api/tyre_model
let ALL_TEAMS   = null;   // Teams list from /api/teams
let ALL_RACES   = null;   // Races list from /api/races

let playbackIdx  = 0;     // Current lap index into RACE_DATA.laps
let playTimer    = null;  // setInterval handle
let isPaused     = false;
let lapSpeed     = 400;   // ms between laps

// Track which events we've already logged (prevents duplicates)
const loggedEvents = new Set();

// Previous position tracking for overtake detection
const prevPositions = {};


// =============================================================================
// BOOTSTRAP — Load API data and set up the form
// =============================================================================

/**
 * Entry point. Fetches all reference data from the Python backend,
 * then populates the setup form dropdowns.
 */
async function bootstrap() {
  setApiStatus('loading', 'Connecting to Python server...');

  try {
    // Fetch all reference data in parallel for speed
    const [races, teams, tyre] = await Promise.all([
      apiFetch('/api/races'),
      apiFetch('/api/teams'),
      apiFetch('/api/tyre_model'),
    ]);

    ALL_RACES  = races;
    ALL_TEAMS  = teams;
    TYRE_META  = tyre;

    populateRaceSelect(races);
    populateTeamSelect(teams);
    buildStintUI();
    chartsInit();

    setApiStatus('ok', `Python server connected · ${races.length} races · ${teams.length} teams loaded`);
    document.getElementById('launch-btn').disabled = false;

  } catch (err) {
    setApiStatus('error', `Cannot connect to Python server — is app.py running on :5000?`);
    console.error('Bootstrap failed:', err);
  }
}

/**
 * Generic API fetch helper with error handling.
 */
async function apiFetch(path, options = {}) {
  const res = await fetch(API + path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) throw new Error(`API ${path} → ${res.status}`);
  return res.json();
}

/** Update the API status indicator in the setup form */
function setApiStatus(state, message) {
  const el   = document.getElementById('api-status');
  const text = document.getElementById('api-status-text');
  el.className       = `api-status ${state}`;
  text.textContent   = message;
}

/** Fill the Grand Prix dropdown from the /api/races response */
function populateRaceSelect(races) {
  const sel = document.getElementById('cfg-race');
  sel.innerHTML = races.map(r =>
    `<option value="${r.id}">${r.name} — ${r.circuit} (${r.laps}L)</option>`
  ).join('');
  // Default to Spanish GP
  sel.value = '5';
}

/** Fill the Team dropdown from /api/teams */
function populateTeamSelect(teams) {
  const sel = document.getElementById('cfg-team');
  sel.innerHTML = teams.map(t =>
    `<option value="${t.name}" style="color:${t.color}">${t.name}</option>`
  ).join('');
  onTeamChange();
}

/** Called when team selection changes — updates the driver preview cards */
function onTeamChange() {
  if (!ALL_TEAMS) return;
  const teamName = document.getElementById('cfg-team').value;
  const team     = ALL_TEAMS.find(t => t.name === teamName);
  if (!team) return;

  const preview = document.getElementById('driver-preview');
  preview.innerHTML = team.drivers.map((d, i) => `
    <div class="dp-card" style="border-left-color:${team.color}">
      <div style="width:8px;height:8px;border-radius:50%;background:${team.color};flex-shrink:0"></div>
      <div>
        <div class="dp-name">${d}</div>
        <div class="dp-role">${i === 0 ? 'DRIVER 1 — YOUR STRATEGY' : 'DRIVER 2 — AUTONOMOUS'}</div>
      </div>
    </div>`).join('');
}

/**
 * Dynamically build the stint input rows based on selected stop count.
 * Default compounds and lap lengths are suggested per stop configuration.
 */
function buildStintUI() {
  const stops   = parseInt(document.getElementById('cfg-stops')?.value || 2);
  const stints  = stops + 1;

  // Sensible default strategy suggestions
  const defaults = {
    1: [['MEDIUM', 33], ['HARD', 33]],
    2: [['MEDIUM', 22], ['HARD', 26], ['SOFT', 18]],
    3: [['SOFT', 14], ['MEDIUM', 18], ['HARD', 20], ['SOFT', 14]],
  };
  const defs = defaults[stops] || defaults[2];

  const builder = document.getElementById('stint-builder');
  if (!builder) return;

  builder.innerHTML = `<div class="form-label" style="margin-bottom:10px">STINT CONFIGURATION</div>` +
    Array.from({ length: stints }, (_, i) => {
      const [defCmp, defLaps] = defs[i] || ['MEDIUM', 20];
      return `
        <div class="stint-row">
          <span class="stint-label">STINT ${i + 1}</span>
          <select class="form-select" id="cmp-${i}">
            <option value="SOFT"   ${defCmp === 'SOFT'   ? 'selected' : ''}>SOFT</option>
            <option value="MEDIUM" ${defCmp === 'MEDIUM' ? 'selected' : ''}>MEDIUM</option>
            <option value="HARD"   ${defCmp === 'HARD'   ? 'selected' : ''}>HARD</option>
            <option value="INTER"  ${defCmp === 'INTER'  ? 'selected' : ''}>INTERMEDIATE</option>
            <option value="WET"    ${defCmp === 'WET'    ? 'selected' : ''}>WET</option>
          </select>
          <input class="form-input" type="number" id="laps-${i}"
                 min="3" max="78" value="${defLaps}" placeholder="Laps">
        </div>`;
    }).join('');
}


// =============================================================================
// LAUNCH — Collect config, POST to Python, start playback
// =============================================================================

/**
 * Called when user hits LAUNCH RACE SIMULATION.
 * Builds the strategy config object, sends it to Flask,
 * then starts the animated playback.
 */
async function launchRace() {
  const raceId  = parseInt(document.getElementById('cfg-race').value);
  const team    = document.getElementById('cfg-team').value;
  const grid    = parseInt(document.getElementById('cfg-grid').value);
  const weather = document.getElementById('cfg-weather').value;
  const scExp   = document.getElementById('cfg-sc').value === 'true';
  lapSpeed      = parseInt(document.getElementById('cfg-speed').value);

  const stops  = parseInt(document.getElementById('cfg-stops').value);
  const stints = [];
  for (let i = 0; i <= stops; i++) {
    stints.push({
      compound: document.getElementById(`cmp-${i}`).value,
      laps:     parseInt(document.getElementById(`laps-${i}`).value),
    });
  }

  // Hide setup screen
  document.getElementById('setup-screen').style.display = 'none';

  // Show compute overlay while Python runs
  document.getElementById('compute-overlay').classList.remove('hidden');
  document.getElementById('compute-sub').textContent = 'Sending strategy to Python engine...';

  try {
    // POST strategy to Python backend
    const payload = {
      race_id:              raceId,
      team,
      grid_position:        grid,
      stints,
      weather,
      safety_car_expected:  scExp,
    };

    document.getElementById('compute-sub').textContent = 'Running Monte Carlo simulation...';
    RACE_DATA = await apiFetch('/api/simulate', {
      method: 'POST',
      body:   JSON.stringify(payload),
    });

    if (RACE_DATA.error) {
      alert(`Simulation error: ${RACE_DATA.error}`);
      resetApp();
      return;
    }

    // Initialise the track canvas
    trackInit(RACE_DATA.meta.race.circuit);

    // Build the stint visualisation bar
    renderStintBar(RACE_DATA.meta.stints, RACE_DATA.meta.race.laps);

    // Setup info strip total laps
    document.getElementById('si-total').textContent = `/ ${RACE_DATA.meta.total_laps}`;

    // Enable controls
    document.getElementById('pause-btn').disabled  = false;

    // Set live speed selector to match setup choice
    document.getElementById('speed-live').value = lapSpeed;

    // Reset playback state
    playbackIdx   = 0;
    isPaused      = false;
    loggedEvents.clear();
    Object.keys(prevPositions).forEach(k => delete prevPositions[k]);
    chartsReset();

    // Hide compute overlay and start playback
    document.getElementById('compute-overlay').classList.add('hidden');
    startPlayback();

  } catch (err) {
    document.getElementById('compute-overlay').classList.add('hidden');
    alert(`Failed to connect to Python server.\n\nMake sure app.py is running:\n  python app.py\n\nError: ${err.message}`);
    document.getElementById('setup-screen').style.display = 'flex';
  }
}


// =============================================================================
// PLAYBACK ENGINE
// =============================================================================

/** Start the lap-by-lap playback loop */
function startPlayback() {
  isPaused = false;
  document.getElementById('pause-btn').textContent = '⏸ PAUSE';

  playTimer = setInterval(() => {
    if (isPaused) return;

    if (playbackIdx >= RACE_DATA.laps.length) {
      clearInterval(playTimer);
      showFinish();
      return;
    }

    renderLap(RACE_DATA.laps[playbackIdx]);
    playbackIdx++;

  }, lapSpeed);
}

/** Toggle pause/resume */
function togglePause() {
  isPaused = !isPaused;
  document.getElementById('pause-btn').textContent = isPaused ? '▶ RESUME' : '⏸ PAUSE';
}

/** Update playback speed from the live control */
function updateSpeed() {
  lapSpeed = parseInt(document.getElementById('speed-live').value);
  if (playTimer) {
    clearInterval(playTimer);
    startPlayback();
  }
}

/**
 * Main per-lap render function.
 * Updates every UI panel with the current lap snapshot.
 * Heavy DOM updates (timing tower) are throttled to avoid layout thrashing.
 */
function renderLap(snap) {
  updateInfoStrip(snap);

  // Timing tower is the most expensive DOM update — throttle to every 3 laps
  if (playbackIdx % 3 === 0) updateTimingTower(snap);

  updateDriverCards(snap);
  updateStintProgress(snap.lap, RACE_DATA.meta.stints, RACE_DATA.meta.total_laps);

  // Pass snap to track — RAF loop handles actual drawing at 60fps
  trackDraw(snap);

  updateLiveCharts(snap);
  detectEvents(snap);

  // SC banner
  document.getElementById('sc-banner').classList.toggle('hidden', !snap.in_sc);
}


// =============================================================================
// UI PANEL UPDATERS
// =============================================================================

/** Info strip — lap counter, leader, user position, gap, tyre */
function updateInfoStrip(snap) {
  const leader   = snap.cars[0];
  const userCar  = snap.cars.find(c => c.is_user && c.driver === RACE_DATA.meta.stints && true) ||
                   snap.cars.find(c => c.is_user);

  document.getElementById('si-lap').textContent    = snap.lap;
  document.getElementById('si-leader').textContent = leader?.driver || '—';

  if (userCar) {
    const posEl = document.getElementById('si-pos');
    posEl.textContent = `P${userCar.position}`;
    posEl.className   = `strip-val ${userCar.position <= 3 ? 'amber' : userCar.position <= 10 ? 'green' : 'red'}`;

    document.getElementById('si-gap').textContent  =
      userCar.gap > 0 ? `+${userCar.gap.toFixed(2)}s` : 'LEADER';

    // Tyre with colour dot
    const tyre  = TYRE_META?.[userCar.compound];
    const label = tyre ? `${userCar.compound} (${tyre.label})` : userCar.compound;
    document.getElementById('si-tyre').textContent  = label;
    document.getElementById('si-age').textContent   = `L${userCar.tyre_age}`;
  }

  // Fastest lap
  const fl = snap.fastest_lap;
  if (fl?.driver) {
    document.getElementById('si-fl').textContent = `${fl.driver} ${formatTime(fl.time)}`;
  }
}

/** Timing tower — all 20 cars sorted by position */
function updateTimingTower(snap) {
  const html = snap.cars.map(car => {
    const pos      = car.position;
    const posCls   = pos === 1 ? 'p1' : pos === 2 ? 'p2' : pos === 3 ? 'p3' : '';
    const tyre     = TYRE_META?.[car.compound];
    const tyreColor = tyre?.color || '#888';
    const tyreLabel = tyre?.label || '?';
    const gapTxt   = pos === 1 ? 'LEAD' : `+${car.gap.toFixed(2)}`;

    // Highlight: user car or gaining position
    const wasPos  = prevPositions[car.driver];
    const gaining = wasPos && car.position < wasPos;
    const rowCls  = car.is_user ? 'user-car' : gaining ? 'gaining' : '';
    prevPositions[car.driver] = car.position;

    return `
      <div class="t-row ${rowCls}">
        <span class="t-pos ${posCls}">${pos}</span>
        <div class="t-bar" style="background:${car.color}"></div>
        <div class="t-info">
          <div class="t-driver">${car.driver}</div>
          <div class="t-team">${car.team.toUpperCase()}</div>
        </div>
        <div class="t-tyre" style="background:${tyreColor}">${tyreLabel}</div>
        <span class="t-gap">${gapTxt}</span>
      </div>`;
  }).join('');

  document.getElementById('tower-body').innerHTML = html;
}

/** Driver cards in right panel — user's two cars only */
function updateDriverCards(snap) {
  const userCars = snap.cars.filter(c => c.is_user);
  const html     = userCars.map(car => {
    const tyre      = TYRE_META?.[car.compound];
    const tyreColor = tyre?.color || '#888';
    const posColor  = car.position <= 3 ? '#F0A500' : car.position <= 10 ? '#1BAF5B' : '#D62828';

    return `
      <div class="dc" style="border-left-color:${car.color}">
        <div class="dc-name">${car.driver}</div>
        <div class="dc-pos" style="color:${posColor}">P${car.position}</div>
        <div class="dc-tyre">
          <div class="tyre-pip" style="background:${tyreColor}"></div>
          <span class="dc-meta">${car.compound} · L${car.tyre_age}</span>
        </div>
        <div class="dc-laptime">${formatTime(car.lap_time)}</div>
        <div class="dc-meta" style="margin-top:4px">
          ${car.gap > 0 ? '+' + car.gap.toFixed(2) + 's' : 'LEADER'}
        </div>
      </div>`;
  }).join('');

  document.getElementById('driver-cards').innerHTML = html;
}

/**
 * Render the stint bar in the right panel (static bars, progress fills live).
 * Called once after simulation loads.
 */
function renderStintBar(stints, totalLaps) {
  const bar = document.getElementById('stint-viz-bar');

  bar.innerHTML = stints.map((s, i) => {
    const tyre  = TYRE_META?.[s.compound];
    const color = tyre?.color || '#666';
    const label = tyre?.label || s.compound[0];
    const flex  = (s.laps / totalLaps) * 100;

    return `
      <div class="stint-seg" id="seg-${i}"
           style="flex:${flex};background:${color}"
           title="${s.compound} — ${s.laps} laps">
        <div class="stint-seg-progress" id="seg-prog-${i}" style="width:0%"></div>
        ${s.laps > 8 ? label : ''}
      </div>`;
  }).join('');

  // Pit stop notes
  let cum = 0;
  const pitLaps = stints.slice(0, -1).map(s => { cum += s.laps; return `L${cum}`; });
  document.getElementById('pit-notes').textContent =
    pitLaps.length ? `PIT WINDOWS: ${pitLaps.join(' · ')}` : 'NO PLANNED STOPS';
}

/** Update the progress fill inside each stint segment as the race progresses */
function updateStintProgress(currentLap, stints, totalLaps) {
  let cumLaps = 0;
  stints.forEach((s, i) => {
    const start = cumLaps;
    const end   = cumLaps + s.laps;
    const prog  = document.getElementById(`seg-prog-${i}`);
    if (!prog) return;

    if (currentLap > end) {
      prog.style.width = '100%';
    } else if (currentLap > start) {
      prog.style.width = ((currentLap - start) / s.laps * 100).toFixed(1) + '%';
    }
    cumLaps = end;
  });
}

/** Push new data points to the live mini charts */
function updateLiveCharts(snap) {
  const userCar = snap.cars.find(c => c.is_user);
  if (!userCar) return;

  chartsPush(
    userCar.gap,
    parseFloat(userCar.tyre_delta),
    parseFloat(userCar.lap_time),
  );
}


// =============================================================================
// RACE EVENTS LOG
// =============================================================================

/**
 * Scan current lap for notable events and append them to the events log.
 * Uses a Set to prevent the same event being logged twice.
 */
function detectEvents(snap) {
  // Safety car deployed
  if (snap.in_sc && snap.lap === snap.sc_lap) {
    logEvent(snap.lap, '🟡', `<strong>SAFETY CAR DEPLOYED</strong> — pit window now open`);
  }

  // SC ending
  if (snap.sc_lap && snap.lap === snap.sc_lap + (RACE_DATA.meta.sc_dur || 0) && !snap.in_sc) {
    logEvent(snap.lap, '🟢', `<strong>SAFETY CAR ENDING</strong> — racing resumes next lap`);
  }

  // Rain starts
  if (snap.is_raining && snap.lap === RACE_DATA.meta.rain_lap) {
    logEvent(snap.lap, '🌧️', `<strong>RAIN BEGINS</strong> — intermediate tyre window opens`);
  }

  // Pit stops
  snap.cars.forEach(car => {
    if (!car.pitting) return;
    const key = `pit-${car.driver}-${snap.lap}`;
    if (loggedEvents.has(key)) return;
    loggedEvents.add(key);

    const tyre  = TYRE_META?.[car.compound];
    const icon  = car.is_user ? '🔵' : '⬛';
    logEvent(snap.lap, icon,
      `<strong>${car.driver}</strong> pits → fits <strong>${car.compound}</strong> (${tyre?.label || '?'})`);
  });

  // Position changes for user's cars
  snap.cars.filter(c => c.is_user).forEach(car => {
    const prev = prevPositions[`${car.driver}-pos`];
    if (prev !== undefined && prev !== car.position) {
      const gained = prev - car.position;
      if (gained > 0) {
        logEvent(snap.lap, '⬆️',
          `<strong>${car.driver}</strong> gains ${gained} place${gained > 1 ? 's' : ''} → <strong>P${car.position}</strong>`);
      } else if (gained < -1) {
        logEvent(snap.lap, '⬇️',
          `<strong>${car.driver}</strong> drops to P${car.position}`);
      }
    }
    prevPositions[`${car.driver}-pos`] = car.position;
  });

  // Fastest lap set
  const fl = snap.fastest_lap;
  if (fl?.lap === snap.lap) {
    const key = `fl-${snap.lap}`;
    if (!loggedEvents.has(key)) {
      loggedEvents.add(key);
      logEvent(snap.lap, '🟣', `<strong>FASTEST LAP</strong> — ${fl.driver} ${formatTime(fl.time)}`);
    }
  }
}

/** Prepend a new event row to the events log */
function logEvent(lap, icon, text) {
  const log = document.getElementById('events-log');
  const el  = document.createElement('div');
  el.className = 'ev';
  el.innerHTML = `
    <span class="ev-lap">L${lap}</span>
    <span class="ev-icon">${icon}</span>
    <span class="ev-text">${text}</span>`;
  log.insertBefore(el, log.firstChild);
}


// =============================================================================
// FINISH OVERLAY
// =============================================================================

/** Show the post-race finish overlay with podium and stats */
function showFinish() {
  const lastSnap = RACE_DATA.laps[RACE_DATA.laps.length - 1];
  const podium   = lastSnap.cars.slice(0, 3);
  const stats    = RACE_DATA.stats;

  const posColors = ['#F0A500', '#C0C0C0', '#CD7F32'];
  const posLabels = ['1ST', '2ND', '3RD'];

  document.getElementById('podium-cards').innerHTML = podium.map((car, i) => `
    <div class="podium-card" style="border-top-color:${posColors[i]}">
      <div class="podium-pos" style="color:${posColors[i]}">${posLabels[i]}</div>
      <div class="podium-driver" style="color:${car.color}">${car.driver}</div>
      <div class="podium-team">${car.team.toUpperCase()}</div>
    </div>`).join('');

  const userCar = lastSnap.cars.find(c => c.is_user);
  document.getElementById('finish-result').textContent =
    userCar ? `${RACE_DATA.meta.team} finished P${userCar.position}` : '';

  document.getElementById('finish-stats').innerHTML = `
    <div class="fs-item">
      <div class="fs-label">FINAL POS</div>
      <div class="fs-val">P${stats.final_position}</div>
    </div>
    <div class="fs-item">
      <div class="fs-label">POINTS</div>
      <div class="fs-val">${stats.points_scored}</div>
    </div>
    <div class="fs-item">
      <div class="fs-label">STRATEGY SCORE</div>
      <div class="fs-val">${stats.practicality}/100</div>
    </div>
    <div class="fs-item">
      <div class="fs-label">GAP TO WIN</div>
      <div class="fs-val">${stats.gap_to_winner > 0 ? '+' + stats.gap_to_winner.toFixed(1) + 's' : 'WINNER'}</div>
    </div>`;

  document.getElementById('finish-overlay').classList.add('visible');
}


// =============================================================================
// RESET
// =============================================================================

/** Full app reset — back to setup screen */
function resetApp() {
  clearInterval(playTimer);
  trackStop();   // Stop RAF loop and clear car state
  isPaused    = false;
  RACE_DATA   = null;
  playbackIdx = 0;

  loggedEvents.clear();
  Object.keys(prevPositions).forEach(k => delete prevPositions[k]);
  chartsReset();

  document.getElementById('finish-overlay').classList.remove('visible');
  document.getElementById('setup-screen').style.display = 'flex';
  document.getElementById('pause-btn').disabled         = true;
  document.getElementById('pause-btn').textContent      = '⏸ PAUSE';
  document.getElementById('tower-body').innerHTML       = '';
  document.getElementById('events-log').innerHTML       = '';
  document.getElementById('driver-cards').innerHTML     = '';
  document.getElementById('sc-banner').classList.add('hidden');

  // Clear canvases
  ['track-canvas', 'gap-chart', 'deg-chart', 'lap-chart'].forEach(id => {
    const c = document.getElementById(id);
    if (c) c.getContext('2d').clearRect(0, 0, c.width, c.height);
  });
}


// =============================================================================
// UTILITIES
// =============================================================================

/** Format a raw seconds value as M:SS.mmm */
function formatTime(s) {
  if (!s || isNaN(s)) return '--:--.---';
  const m   = Math.floor(s / 60);
  const sec = (s % 60).toFixed(3).padStart(6, '0');
  return `${m}:${sec}`;
}


// =============================================================================
// START
// =============================================================================

// Run bootstrap when page loads
window.addEventListener('DOMContentLoaded', bootstrap);
