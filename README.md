# AUTOTHRASH: Adaptive Autonomous Navigation for Unstructured Indian Roads
### Smart India Hackathon (SIH 2026) Engineering Simulation Prototype

A **100% Local, Desktop-Runnable Autonomous Driving Simulation Prototype** built specifically to address chaotic, mixed, and non-lane-based Indian road conditions.

---

## 1. Quick Start

Run the simulation from the command line:
```bash
python autothrash/main.py
```
Or double-click:
```
autothrash/run_autothrash.bat
```

To run the headless verification test suite:
```bash
python autothrash/tests/test_simulation_loop.py
```

### Keyboard Shortcuts
- `[SPACE]` : Play / Pause toggle
- `[R]` : Reset simulation scenario
- `[U]` : Trigger manual unstick & crawl bypass
- `[←] / [↓] / [→]` : Manually nudge vehicle corridors (Route A / B / C)
- `[1] - [5]` : Instantly switch between scenarios 1 through 5

---

## 2. Core Closed Loop Demonstrated

The prototype implements the full autonomous driving closed loop:
```
ENVIRONMENT
    ↓
MULTI-SENSOR PERCEPTION (Camera, LiDAR, Radar, IMU)
    ↓
OBJECT DETECTION (With Class P_det and Risk quantification)
    ↓
PROBABILITY / UNCERTAINTY (Scene Confidence)
    ↓
SHORT-TERM MOTION PREDICTION (1s, 2s, 3s with uncertainty ellipses)
    ↓
TRAVERSABILITY + DYNAMIC RISK (Corridors: Left, Center, Right)
    ↓
MULTIPLE CANDIDATE ROUTES (Route A, Route B, Route C)
    ↓
ADAPTIVE PATH SELECTION (Best cost: safety + clearance + smoothness)
    ↓
VEHICLE MOTION (Kinematic pure pursuit tracking & speed regulation)
    ↓
NEW OBSERVATION (Hazard injection / Traffic motion)
    ↓
REAL-TIME REPLANNING (Latency measured in milliseconds)
```

---

## 3. The 5 Required SIH Scenarios

Use the **SCENARIO** dropdown selector on the top navigation bar:

1. **Scenario 1 — Village Road**:
   - Narrow unpaved road, broken shoulders, weak/missing lane markings.
   - Stray cattle / cows, pedestrians, oncoming motorcycles, potholes.
   - Demonstrates traversable corridor identification without lane lines.

2. **Scenario 2 — Urban Intersection**:
   - Chaotic Indian crossing without signals.
   - Multi-directional informal merging, auto-rickshaws cutting across, pedestrian crossing.
   - Demonstrates candidate path generation and dynamic gap evaluation.

3. **Scenario 3 — Crowded Market Road**:
   - Dense roadside pedestrian crowds, vegetable pushcarts, parked two-wheelers.
   - Demonstrates why static planning fails and how the system navigates high uncertainty.

4. **Scenario 4 — Mixed-Traffic Highway**:
   - Large speed differential: fast commercial trucks and buses alongside slow bicycles.
   - Irregular overtaking and dynamic clearance buffer maintenance.

5. **Scenario 5 — Sudden Obstacle / Pedestrian Cut-In (Flagship Replan Demonstration)**:
   - Vehicle initially moves along Route B.
   - Dynamic pedestrian steps suddenly into the projected path corridor.
   - System detects hazard, invalidates Route B (`REJECTED`), selects safer Route C (`SELECTED`), slows down, steers smoothly, and flashes the prominent **PATH REPLAN TRIGGERED** notification banner.

---

## 4. Key Engineering Capabilities

- **Indian Mixed-Traffic Entities**: Custom geometry and behaviors for Auto-Rickshaws (yellow/green canopy), Cows, Pedestrians, Motorcycles, Trucks (Ashok Leyland / Tata styled), Buses, Pushcarts, Bicycles, and Road Debris.
- **Probabilistic Perception**: Class-specific detection probability $P_{\text{det}}$, motion confidence $C_{\text{motion}}$, and risk level (LOW, MEDIUM, HIGH, CRITICAL).
- **Multi-Sensor Fusion & Occlusion**: Fused confidence across Camera (0.91), LiDAR (0.94), Radar (0.88), and IMU (0.98).
- **Adaptive Elevated View Concept**: When camera occlusion is detected behind heavy vehicles, the system requests an elevated camera viewpoint, recovering visual confidence from 0.40 to 0.88+.
- **Nearby Traffic Feasibility**: Extracts contextual evidence from nearby auto-rickshaws navigating tight corridors when conventional lanes are missing.
- **Engineering Integrity**: Explicitly distinguishes between `[MEASURED]` calculations (replan latency ms, minimum clearance m, smoothness index) and `[SIMULATED]` dataset mappings.
- **Extensible Architecture**: Structured for direct modular evolution into MATLAB / Simulink Automated Driving Toolbox, RoadRunner, and Indian Driving Dataset (IDD) workflows.
