"""
=============================================================================
PITWALL — F1 Strategy Evaluator & Race Visualiser
=============================================================================
Flask backend. Exposes REST API endpoints that the frontend calls to:
  1. Fetch available races, teams, and current standings
  2. Run the full Monte Carlo race simulation in Python/NumPy
  3. Return lap-by-lap race data as JSON for the browser to animate

Endpoints:
  GET  /api/races          → list of all 2025 races
  GET  /api/teams          → list of teams + drivers
  GET  /api/standings      → 2025 championship standings
  POST /api/simulate       → run simulation, return full lap data + stats
  GET  /                   → serves the main HTML app

Run:
  pip install flask flask-cors numpy
  python app.py
=============================================================================
"""

from flask import Flask, jsonify, request, render_template, send_from_directory
from flask_cors import CORS
import numpy as np
import json
import math
import random
import os

app = Flask(__name__)
CORS(app)  # Allow cross-origin requests during local development


# =============================================================================
# SECTION 1: STATIC DATA
# 2025 F1 season data — circuits, teams, drivers, standings
# =============================================================================

# All 2025 circuits with simulation parameters
RACES = [
    {"id": 0,  "name": "Australian GP",    "circuit": "Albert Park",       "laps": 58, "sc_prob": 0.45, "deg": 0.65, "overtake": 0.35},
    {"id": 1,  "name": "Chinese GP",       "circuit": "Shanghai",          "laps": 56, "sc_prob": 0.35, "deg": 0.70, "overtake": 0.50},
    {"id": 2,  "name": "Japanese GP",      "circuit": "Suzuka",            "laps": 53, "sc_prob": 0.30, "deg": 0.55, "overtake": 0.30},
    {"id": 3,  "name": "Bahrain GP",       "circuit": "Bahrain Int'l",     "laps": 57, "sc_prob": 0.30, "deg": 0.85, "overtake": 0.65},
    {"id": 4,  "name": "Saudi Arabian GP", "circuit": "Jeddah Corniche",   "laps": 50, "sc_prob": 0.55, "deg": 0.60, "overtake": 0.40},
    {"id": 5,  "name": "Spanish GP",       "circuit": "Barcelona",         "laps": 66, "sc_prob": 0.25, "deg": 0.80, "overtake": 0.45},
    {"id": 6,  "name": "Monaco GP",        "circuit": "Monte Carlo",       "laps": 78, "sc_prob": 0.45, "deg": 0.30, "overtake": 0.10},
    {"id": 7,  "name": "Canadian GP",      "circuit": "Gilles Villeneuve", "laps": 70, "sc_prob": 0.55, "deg": 0.65, "overtake": 0.60},
    {"id": 8,  "name": "British GP",       "circuit": "Silverstone",       "laps": 52, "sc_prob": 0.40, "deg": 0.75, "overtake": 0.55},
    {"id": 9,  "name": "Italian GP",       "circuit": "Monza",             "laps": 53, "sc_prob": 0.35, "deg": 0.50, "overtake": 0.65},
    {"id": 10, "name": "Singapore GP",     "circuit": "Marina Bay",        "laps": 62, "sc_prob": 0.55, "deg": 0.60, "overtake": 0.20},
    {"id": 11, "name": "Abu Dhabi GP",     "circuit": "Yas Marina",        "laps": 58, "sc_prob": 0.30, "deg": 0.65, "overtake": 0.45},
]

# Team pace data — race_pace is a multiplier on the 90s base lap time
# Lower = faster. deg_resistance = how well tyres hold up (0-1)
TEAMS = {
    "McLaren":      {"race_pace": 0.996, "qual_gap": 0.000, "deg_resistance": 0.88, "color": "#FF8000", "drivers": ["PIASTRI", "NORRIS"]},
    "Ferrari":      {"race_pace": 0.994, "qual_gap": 0.001, "deg_resistance": 0.82, "color": "#E8002D", "drivers": ["LECLERC", "HAMILTON"]},
    "Mercedes":     {"race_pace": 0.998, "qual_gap": 0.003, "deg_resistance": 0.85, "color": "#27F4D2", "drivers": ["RUSSELL", "ANTONELLI"]},
    "Red Bull":     {"race_pace": 1.003, "qual_gap": 0.005, "deg_resistance": 0.80, "color": "#3671C6", "drivers": ["VERSTAPPEN", "TSUNODA"]},
    "Aston Martin": {"race_pace": 1.008, "qual_gap": 0.010, "deg_resistance": 0.78, "color": "#229971", "drivers": ["ALONSO", "STROLL"]},
    "Williams":     {"race_pace": 1.010, "qual_gap": 0.012, "deg_resistance": 0.76, "color": "#64C4FF", "drivers": ["SAINZ", "ALBON"]},
    "Alpine":       {"race_pace": 1.015, "qual_gap": 0.015, "deg_resistance": 0.74, "color": "#FF87BC", "drivers": ["GASLY", "DOOHAN"]},
    "Racing Bulls": {"race_pace": 1.018, "qual_gap": 0.017, "deg_resistance": 0.75, "color": "#6692FF", "drivers": ["HADJAR", "LAWSON"]},
    "Haas":         {"race_pace": 1.020, "qual_gap": 0.018, "deg_resistance": 0.72, "color": "#B6BABD", "drivers": ["BEARMAN", "OCON"]},
    "Kick Sauber":  {"race_pace": 1.022, "qual_gap": 0.022, "deg_resistance": 0.70, "color": "#52E252", "drivers": ["HULKENBERG", "BORTOLETO"]},
}

# Tyre compound characteristics
# peak: laps at peak window | cliff: lap where deg accelerates
# deg_rate: seconds per lap lost beyond peak | base_delta: vs medium on fresh tyre
TYRE_MODEL = {
    "SOFT":   {"peak": 8,  "cliff": 18, "deg_rate": 0.045, "base_delta": -0.40, "color": "#E8002D", "label": "S"},
    "MEDIUM": {"peak": 15, "cliff": 32, "deg_rate": 0.028, "base_delta":  0.00, "color": "#FFD700", "label": "M"},
    "HARD":   {"peak": 25, "cliff": 50, "deg_rate": 0.018, "base_delta":  0.25, "color": "#E0E0E0", "label": "H"},
    "INTER":  {"peak": 15, "cliff": 30, "deg_rate": 0.035, "base_delta":  0.00, "color": "#39B54A", "label": "I"},
    "WET":    {"peak": 20, "cliff": 40, "deg_rate": 0.025, "base_delta":  0.30, "color": "#0067FF", "label": "W"},
}

# 2025 championship standings after Round 8
STANDINGS = [
    {"pos": 1,  "driver": "Oscar Piastri",    "team": "McLaren",      "points": 161},
    {"pos": 2,  "driver": "Lando Norris",      "team": "McLaren",      "points": 148},
    {"pos": 3,  "driver": "Charles Leclerc",   "team": "Ferrari",      "points": 112},
    {"pos": 4,  "driver": "Lewis Hamilton",    "team": "Ferrari",      "points": 108},
    {"pos": 5,  "driver": "George Russell",    "team": "Mercedes",     "points": 93},
    {"pos": 6,  "driver": "Max Verstappen",    "team": "Red Bull",     "points": 89},
    {"pos": 7,  "driver": "Kimi Antonelli",    "team": "Mercedes",     "points": 72},
    {"pos": 8,  "driver": "Carlos Sainz",      "team": "Williams",     "points": 61},
    {"pos": 9,  "driver": "Fernando Alonso",   "team": "Aston Martin", "points": 44},
    {"pos": 10, "driver": "Lance Stroll",      "team": "Aston Martin", "points": 28},
    {"pos": 11, "driver": "Nico Hulkenberg",   "team": "Kick Sauber",  "points": 26},
    {"pos": 12, "driver": "Isack Hadjar",      "team": "Racing Bulls", "points": 20},
    {"pos": 13, "driver": "Alex Albon",        "team": "Williams",     "points": 18},
    {"pos": 14, "driver": "Pierre Gasly",      "team": "Alpine",       "points": 12},
    {"pos": 15, "driver": "Yuki Tsunoda",      "team": "Red Bull",     "points": 11},
    {"pos": 16, "driver": "Jack Doohan",       "team": "Alpine",       "points": 8},
    {"pos": 17, "driver": "Oliver Bearman",    "team": "Haas",         "points": 6},
    {"pos": 18, "driver": "Esteban Ocon",      "team": "Haas",         "points": 5},
    {"pos": 19, "driver": "Liam Lawson",       "team": "Racing Bulls", "points": 3},
    {"pos": 20, "driver": "Gabriel Bortoleto", "team": "Kick Sauber",  "points": 1},
]

# Points awarded per finishing position
POINTS_TABLE = {1:25, 2:18, 3:15, 4:12, 5:10, 6:8, 7:6, 8:4, 9:2, 10:1}


# =============================================================================
# SECTION 2: SIMULATION ENGINE (Python / NumPy)
# =============================================================================

def calculate_tyre_delta(compound: str, lap_on_tyre: int, track_deg: float) -> float:
    """
    Returns the lap time delta (seconds) for a tyre at a given age.
    Models three phases: warmup peak → linear degradation → cliff accelerated deg.

    Args:
        compound:     Tyre compound string e.g. "MEDIUM"
        lap_on_tyre:  Number of laps completed on this set
        track_deg:    Circuit degradation factor (0-1, higher = more deg)

    Returns:
        Delta in seconds vs a reference perfect lap
    """
    m = TYRE_MODEL.get(compound, TYRE_MODEL["MEDIUM"])

    if lap_on_tyre <= m["peak"]:
        # Warmup phase — gradually reaches peak performance
        warmup = min(1.0, lap_on_tyre / max(1, m["peak"] * 0.4))
        delta  = m["base_delta"] * warmup

    elif lap_on_tyre <= m["cliff"]:
        # Linear degradation beyond peak
        past_peak = lap_on_tyre - m["peak"]
        delta = m["base_delta"] + past_peak * m["deg_rate"] * track_deg

    else:
        # Past the cliff — degradation accelerates by 2.5x
        linear_deg = (m["cliff"] - m["peak"]) * m["deg_rate"] * track_deg
        cliff_deg  = (lap_on_tyre - m["cliff"]) * m["deg_rate"] * track_deg * 2.5
        delta = m["base_delta"] + linear_deg + cliff_deg

    return round(float(delta), 4)


def generate_rival_stints(race: dict, stop_count: int) -> list:
    """
    Generates a realistic random strategy for a rival team car.
    Rivals vary their stops slightly from the user's strategy to
    model the real-world mix of 1-stop and 2-stop strategies.

    Args:
        race:       Race dictionary with circuit params
        stop_count: Number of planned stops

    Returns:
        List of {compound, laps} dicts
    """
    laps = race["laps"]
    # High-deg tracks favour harder compounds for rivals
    if race["deg"] > 0.75:
        compound_pool = ["MEDIUM", "HARD", "MEDIUM"]
    else:
        compound_pool = ["SOFT", "MEDIUM", "HARD"]

    stints    = []
    remaining = laps

    for i in range(stop_count + 1):
        is_last    = (i == stop_count)
        jitter     = random.randint(-6, 6)
        stint_laps = remaining if is_last else max(8, laps // (stop_count + 1) + jitter)
        compound   = compound_pool[i % len(compound_pool)]
        stints.append({"compound": compound, "laps": min(stint_laps, remaining)})
        remaining -= stint_laps
        if remaining <= 0:
            break

    return stints


def build_pit_lap_set(stints: list, jitter: int = 0) -> set:
    """
    Calculates the exact laps where pit stops will occur.
    Rivals get a random jitter of ±4 laps to model real-world
    variation in pit window timing.

    Args:
        stints: List of {compound, laps} dicts
        jitter: Lap number offset applied to rival stops

    Returns:
        Set of lap numbers where a pit stop occurs
    """
    pit_laps = set()
    cumulative = 0
    for stint in stints[:-1]:
        cumulative += stint["laps"]
        pit_lap = max(3, cumulative + jitter)
        pit_laps.add(pit_lap)
    return pit_laps


def run_simulation(config: dict) -> dict:
    """
    Main simulation function. Pre-computes the entire race lap-by-lap
    for all 20 cars and returns the full dataset as a JSON-serialisable dict.

    This is the Python engine that replaces the browser-side JS simulation.
    NumPy is used for fast random number generation and array operations.

    Args:
        config: {
            race_id, team, grid_position, stints,
            weather, safety_car_expected
        }

    Returns:
        Full race data including per-lap snapshots, stats, and metadata
    """

    # --- Unpack config ---
    race      = RACES[config["race_id"]]
    team      = config["team"]
    grid      = int(config["grid_position"])
    stints    = config["stints"]       # [{compound, laps}, ...]
    weather   = config["weather"]      # "DRY" | "MIXED" | "WET"
    sc_exp    = config["safety_car_expected"]
    laps      = race["laps"]

    # --- Validate stints ---
    total_stint_laps = sum(s["laps"] for s in stints)
    if abs(total_stint_laps - laps) > 3:
        return {"error": f"Stint laps total {total_stint_laps} but race has {laps} laps"}

    # --- Safety car setup ---
    sc_prob    = race["sc_prob"] + (0.15 if sc_exp else 0)
    has_sc     = random.random() < sc_prob
    sc_lap     = int(random.uniform(laps * 0.2, laps * 0.75)) if has_sc else None
    sc_dur     = int(random.uniform(3, 7)) if has_sc else 0

    # --- Weather / rain ---
    rain_lap = None
    if weather == "WET":
        rain_lap = 1
    elif weather == "MIXED" and random.random() < 0.5:
        rain_lap = int(random.uniform(laps * 0.3, laps * 0.7))

    # ── Build the 20-car grid ──────────────────────────────────────────────

    all_cars = []
    car_id   = 0

    team_data = TEAMS[team]

    # User's two drivers — placed at configured grid position
    for d_idx in range(2):
        driver_stints = stints if d_idx == 0 else generate_rival_stints(race, len(stints) - 1)
        all_cars.append({
            "id":       car_id,
            "driver":   team_data["drivers"][d_idx],
            "team":     team,
            "color":    team_data["color"],
            "pace":     team_data["race_pace"] + d_idx * 0.002,
            "is_user":  True,
            "grid_pos": grid if d_idx == 0 else min(20, grid + random.randint(1, 4)),
            "stints":   driver_stints,
        })
        car_id += 1

    # All rival team drivers
    for t_name, t_data in TEAMS.items():
        if t_name == team:
            continue
        for d_idx in range(2):
            rival_stops  = random.choice([1, 1, 2]) if race["deg"] > 0.7 else random.choice([1, 2])
            rival_stints = generate_rival_stints(race, rival_stops)
            all_cars.append({
                "id":       car_id,
                "driver":   t_data["drivers"][d_idx],
                "team":     t_name,
                "color":    t_data["color"],
                "pace":     t_data["race_pace"] + d_idx * 0.002 + float(np.random.normal(0, 0.003)),
                "is_user":  False,
                "grid_pos": car_id,
                "stints":   rival_stints,
            })
            car_id += 1

    # Sort and reassign grid positions cleanly
    all_cars.sort(key=lambda c: c["grid_pos"])
    for i, car in enumerate(all_cars):
        car["grid_pos"] = i + 1

    # ── Pre-compute per-lap state for all cars ──────────────────────────────

    # Cumulative race times — starts with a formation lap gap per grid slot
    cum_times   = {c["id"]: c["grid_pos"] * 0.15 for c in all_cars}

    # Tyre tracking per car
    stint_idx   = {c["id"]: 0 for c in all_cars}
    stint_lap   = {c["id"]: 0 for c in all_cars}  # laps on current set

    # Build pit stop schedules (with jitter for rivals)
    pit_schedules = {}
    for car in all_cars:
        jitter = 0 if car["is_user"] else random.randint(-3, 3)
        pit_schedules[car["id"]] = build_pit_lap_set(car["stints"], jitter)

    # Fastest lap tracking
    fastest_lap = {"time": 999.9, "driver": "", "lap": 0}

    lap_snapshots = []  # Full per-lap race state

    # ── Main lap-by-lap loop ────────────────────────────────────────────────
    for lap in range(1, laps + 1):

        in_sc     = has_sc and sc_lap and sc_lap <= lap <= sc_lap + sc_dur
        is_rain   = rain_lap is not None and lap >= rain_lap

        lap_cars  = []

        for car in all_cars:

            # Advance tyre age
            stint_lap[car["id"]] += 1
            cur_stint_idx = min(stint_idx[car["id"]], len(car["stints"]) - 1)
            cur_stint     = car["stints"][cur_stint_idx]
            compound      = cur_stint["compound"]
            age           = stint_lap[car["id"]]

            # Tyre delta from Python engine
            tyre_delta = calculate_tyre_delta(compound, age, race["deg"])

            # Rain penalty for wrong compound
            rain_penalty = 0.0
            if is_rain and compound not in ("INTER", "WET"):
                rain_penalty = float(np.random.uniform(2.0, 5.5))

            # Base lap time — scaled by team pace
            base_lap = 90.0 * car["pace"]

            if in_sc:
                # SC: everyone drives slowly, gaps compress
                lap_time = base_lap * 1.28 + float(np.random.normal(0, 0.3))
            else:
                lap_time = base_lap + tyre_delta + rain_penalty + float(np.random.normal(0, 0.08))

            cum_times[car["id"]] += lap_time

            # Check for pit stop this lap
            pitting = False
            if lap in pit_schedules[car["id"]]:
                pit_loss = 20.5 + float(np.random.uniform(0, 1.8))
                # SC free stop bonus
                if in_sc:
                    pit_loss = 7.0 + float(np.random.uniform(0, 2.0))
                cum_times[car["id"]] += pit_loss

                # Advance to next stint
                stint_idx[car["id"]] = min(stint_idx[car["id"]] + 1, len(car["stints"]) - 1)
                stint_lap[car["id"]] = 0
                pitting = True

            # Update fastest lap tracker
            if lap_time < fastest_lap["time"] and lap > 5 and not in_sc:
                fastest_lap = {"time": round(lap_time, 3), "driver": car["driver"], "lap": lap}

            # Get current compound after potential pit
            post_stint_idx = min(stint_idx[car["id"]], len(car["stints"]) - 1)
            post_compound  = car["stints"][post_stint_idx]["compound"]

            lap_cars.append({
                "id":         car["id"],
                "driver":     car["driver"],
                "team":       car["team"],
                "color":      car["color"],
                "is_user":    car["is_user"],
                "cum_time":   round(cum_times[car["id"]], 3),
                "lap_time":   round(lap_time, 3),
                "compound":   post_compound,
                "tyre_age":   stint_lap[car["id"]],
                "tyre_delta": round(tyre_delta, 4),
                "pitting":    pitting,
                "rain_pen":   round(rain_penalty, 3),
            })

        # Sort by cumulative time to determine positions
        lap_cars.sort(key=lambda c: c["cum_time"])
        leader_time = lap_cars[0]["cum_time"]

        for i, car in enumerate(lap_cars):
            car["position"] = i + 1
            car["gap"]      = round(car["cum_time"] - leader_time, 3)

        lap_snapshots.append({
            "lap":          lap,
            "in_sc":        bool(in_sc),
            "is_raining":   bool(is_rain),
            "sc_lap":       sc_lap,
            "fastest_lap":  dict(fastest_lap),
            "cars":         lap_cars,
        })

    # ── Post-race statistics ────────────────────────────────────────────────
    final_snap  = lap_snapshots[-1]
    user_cars   = [c for c in final_snap["cars"] if c["is_user"]]
    user_driver = user_cars[0] if user_cars else None

    final_positions = [c["position"] for c in final_snap["cars"] if c["is_user"]]
    avg_pos         = float(np.mean(final_positions)) if final_positions else 20
    points_scored   = sum(POINTS_TABLE.get(p, 0) for p in final_positions)

    # Calculate practicality score
    practicality = _score_strategy(stints, race, avg_pos, grid)

    return {
        "meta": {
            "race":          race,
            "team":          team,
            "team_color":    team_data["color"],
            "stints":        stints,
            "grid":          grid,
            "weather":       weather,
            "has_sc":        has_sc,
            "sc_lap":        sc_lap,
            "sc_dur":        sc_dur,
            "rain_lap":      rain_lap,
            "total_laps":    laps,
        },
        "stats": {
            "final_position":  user_driver["position"] if user_driver else 20,
            "points_scored":   points_scored,
            "avg_position":    round(avg_pos, 1),
            "gap_to_winner":   user_driver["gap"] if user_driver else 0,
            "fastest_lap":     fastest_lap,
            "practicality":    round(practicality, 1),
        },
        "laps": lap_snapshots,   # Full lap-by-lap data for the visualiser
    }


def _score_strategy(stints: list, race: dict, avg_pos: float, grid: int) -> float:
    """
    Scores the strategy practicality 0-100 based on:
    - Tyre cliff overrun (long stints past degradation cliff)
    - Compound suitability for track degradation level
    - Stop count appropriateness for circuit characteristics
    - Grid vs target realism

    Returns float 0-100 (100 = optimal strategy for these conditions)
    """
    score = 100.0

    for stint in stints:
        m    = TYRE_MODEL.get(stint["compound"], TYRE_MODEL["MEDIUM"])
        laps = stint["laps"]

        # Penalise overrunning the cliff by 1.5pts per lap
        if laps > m["cliff"]:
            score -= (laps - m["cliff"]) * 1.5

        # Soft on high-deg track in long stints is risky
        if stint["compound"] == "SOFT" and laps > 20 and race["deg"] > 0.75:
            score -= 18

    # Stop count vs circuit deg — too few stops on high-deg track
    stop_count = len(stints) - 1
    if race["deg"] > 0.80 and stop_count < 2:
        score -= 22
    if race["deg"] < 0.40 and stop_count > 1:
        score -= 14  # Monaco — extra stops rarely help

    # Grid position realism
    positions_to_gain = max(0, grid - avg_pos)
    overtake_difficulty = 1 - race["overtake"]
    score -= positions_to_gain * overtake_difficulty * 1.5

    return max(0.0, min(100.0, score))


# =============================================================================
# SECTION 3: API ROUTES
# =============================================================================

@app.route("/")
def index():
    """Serve the main frontend HTML page."""
    return render_template("index.html")


@app.route("/api/races")
def api_races():
    """Return list of all 2025 races for the frontend dropdowns."""
    return jsonify(RACES)


@app.route("/api/teams")
def api_teams():
    """Return team metadata — names, drivers, colours."""
    result = []
    for name, data in TEAMS.items():
        result.append({
            "name":    name,
            "color":   data["color"],
            "drivers": data["drivers"],
            "pace":    data["race_pace"],
        })
    return jsonify(result)


@app.route("/api/standings")
def api_standings():
    """Return 2025 driver championship standings."""
    return jsonify(STANDINGS)


@app.route("/api/tyre_model")
def api_tyre_model():
    """Return tyre compound data so the frontend can display colours/labels."""
    return jsonify(TYRE_MODEL)


@app.route("/api/simulate", methods=["POST"])
def api_simulate():
    """
    Main simulation endpoint. Receives strategy config from the frontend,
    runs the Python simulation engine, and returns the full race data.

    Request body (JSON):
        {
            "race_id":               int,
            "team":                  str,
            "grid_position":         int,
            "stints":                [{compound: str, laps: int}, ...],
            "weather":               "DRY" | "MIXED" | "WET",
            "safety_car_expected":   bool
        }

    Response (JSON):
        {
            "meta":  { race info, strategy config },
            "stats": { final position, points, practicality score, ... },
            "laps":  [ { lap, cars: [...], in_sc, fastest_lap }, ... ]
        }
    """
    try:
        config = request.get_json()

        # Basic input validation
        if not config:
            return jsonify({"error": "No config provided"}), 400
        if config.get("race_id") is None:
            return jsonify({"error": "Missing race_id"}), 400
        if not config.get("team") in TEAMS:
            return jsonify({"error": f"Unknown team: {config.get('team')}"}), 400
        if not config.get("stints"):
            return jsonify({"error": "No stints provided"}), 400

        # Validate each stint
        for s in config["stints"]:
            if s.get("compound") not in TYRE_MODEL:
                return jsonify({"error": f"Unknown compound: {s.get('compound')}"}), 400

        # Run the simulation
        result = run_simulation(config)

        if "error" in result:
            return jsonify(result), 400

        return jsonify(result)

    except Exception as e:
        return jsonify({"error": str(e)}), 500


# =============================================================================
# SECTION 4: ENTRY POINT
# =============================================================================

if __name__ == "__main__":
    print("\n" + "=" * 55)
    print("  PITWALL · F1 Strategy Evaluator")
    print("  Starting Flask server...")
    print("  Open: http://localhost:5000")
    print("=" * 55 + "\n")

    # debug=True for local dev — auto-reloads on file changes
    app.run(debug=True, port=5000, host="0.0.0.0")
