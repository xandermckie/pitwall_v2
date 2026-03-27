# PITWALL — F1 Strategy Evaluator & Race Visualiser

A full-stack F1 race strategy tool. Python/Flask backend runs the simulation engine, the browser animates the race live.

## Architecture

```
pitwall/
├── app.py              ← Flask server + Python simulation engine
├── requirements.txt    ← Python dependencies
├── templates/
│   └── index.html      ← Main HTML app shell
└── static/
    ├── css/
    │   └── style.css   ← White & navy design system
    └── js/
        ├── app.js      ← Main controller, API calls, playback
        ├── track.js    ← Canvas track drawing
        └── charts.js   ← Live mini charts
```

## Setup

**1. Install Python dependencies:**
```bash
pip install flask flask-cors numpy
```

**2. Start the server:**
```bash
cd pitwall
python app.py
```

**3. Open your browser:**
```
http://localhost:5000
```

## How it works

1. Browser loads the page and calls `/api/races`, `/api/teams`, `/api/tyre_model` to populate the form
2. User configures their strategy (team, grid position, stints, weather)
3. On launch, browser POSTs to `/api/simulate` — Python runs the full Monte Carlo simulation
4. Flask returns the complete lap-by-lap race data as JSON (all 20 cars, every lap)
5. Browser animates the race in real time using Canvas 2D

## API Endpoints

| Method | Route          | Description                        |
|--------|----------------|------------------------------------|
| GET    | `/`            | Serves the frontend HTML           |
| GET    | `/api/races`   | List of 2025 races                 |
| GET    | `/api/teams`   | Teams, drivers, colours            |
| GET    | `/api/standings` | 2025 championship standings      |
| GET    | `/api/tyre_model` | Tyre compound characteristics   |
| POST   | `/api/simulate` | Run race simulation → lap data   |

## Simulation Engine

The Python engine (`app.py`) models:
- Tyre degradation across 3 phases: peak window → linear → cliff
- Safety car deployment with configurable probability
- Rain events and wrong-compound penalties
- Pit stop timing with ±jitter for rivals
- Team pace differentials from 2025 season data
- Monte Carlo randomness on pace, pit stops, and strategy variation
