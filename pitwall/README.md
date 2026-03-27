![Python](https://img.shields.io/badge/Python-3.12+-blue)
![Flask](https://img.shields.io/badge/Flask-3.0-red)
![NumPy](https://img.shields.io/badge/NumPy-enabled-green)
![License](https://img.shields.io/badge/License-MIT-gray)

# PITWALL — F1 Strategy Evaluator & Live Race Visualiser

A full-stack F1 race strategy tool. Define your team's tyre strategy, 
grid position, and weather conditions — then watch the predicted race 
unfold lap by lap in the browser.

Python/Flask runs the simulation engine. The browser animates it.

## Features
- **Monte Carlo simulation** — tyre degradation, safety car probability, rival strategy variation
- **Live race visualiser** — animated car positions on circuit-accurate track maps
- **Strategy builder** — define compounds, stint lengths, pit windows
- **Timing tower** — all 20 cars live with gaps, compounds, and position changes
- **Events log** — pit stops, overtakes, safety car, rain, fastest laps

## Quick start
```bash
pip install flask flask-cors numpy
cd pitwall
py app.py
# Open http://localhost:5000
```

## API
| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/races` | 2025 race calendar |
| GET | `/api/teams` | Teams, drivers, pace data |
| GET | `/api/standings` | Championship standings |
| POST | `/api/simulate` | Run simulation → lap-by-lap JSON |

## Stack
Python · Flask · NumPy · Canvas 2D · requestAnimationFrame · Vanilla JS

---
*Unofficial project — not affiliated with Formula 1 or FIA.*
*F1, FORMULA ONE and related marks are trade marks of Formula One Licensing B.V.*
