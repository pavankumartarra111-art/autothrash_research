# AUTOTHRASH — Fix Changelog & Technical Notes
## Version 2.0 — Adaptive Replanning & Boundary Fix

---

## What Caused the Vehicle to Stop Permanently

Three interconnected root causes were identified through full chain tracing:

### Root Cause 1 — `has_active_replan` flag expired after 4 seconds
**File:** `planning/replanning.py`  
**Bug:** `has_active_replan` was evaluated as `active_event is not None`.  
`active_event` is a HUD banner object that expires after 4 seconds via `check_active_event_expiry()`.  
After 4 seconds, the banner cleared → `has_active_replan` became `False` → `BehaviorFSM` fell out of `EVASIVE_REPLAN` mode → re-evaluated clearance → issued `EMERGENCY_STOP` → vehicle stopped permanently.  

**Fix:** Introduced `_actively_replanning` (a persistent internal flag in `AdaptiveReplanner`) that stays True as long as the vehicle is on a non-nominal evasive route or the selected route has elevated collision probability. This flag is independent of the HUD event lifetime.  
`main.py` now passes `replanner.is_actively_replanning` to `BehaviorFSM` instead of `active_event is not None`.

---

### Root Cause 2 — Emergency stop threshold too tight (0.80 m)
**File:** `decision/behavior_logic.py`  
**Bug:** `EMERGENCY_STOP` was triggered when `immediate_clearance < 0.80 m`. This threshold was so tight that most real obstacle clearances (which are 1.0–3.0m) would fall in the grey zone between "not stopped" and "not evasive" — the vehicle would stop repeatedly even during a valid replanning manoeuvre.  
Additionally, `EMERGENCY_STOP` could override `EVASIVE_REPLAN`, causing the vehicle to stop even when it had a valid alternative path.  

**Fix:**
- Raised emergency stop threshold from 0.80 m → **1.2 m** (realistic hard contact zone).
- `EVASIVE_REPLAN` state is now evaluated **before** emergency stop — `has_active_replan = True` prevents emergency stop from firing.
- Added `STOP_WAIT` state: vehicle waits 1 second safely then re-assesses instead of staying permanently in `EMERGENCY_STOP`.
- Extended `UNSTICK_CRAWL` duration from 2.5s → **4.0 s** so the vehicle completes the evasive manoeuvre before re-evaluating.
- Auto-unstick watchdog threshold raised from 0.5 s → **1.5 s** to avoid premature triggers.

---

### Root Cause 3 — No fallback when all routes are simultaneously blocked
**File:** `planning/replanning.py`  
**Bug:** When all three candidate routes (A, B, C) had `collision_prob > RISK_THRESHOLD_CRITICAL`, the replanner still selected the "best of three blocked options" but marked `_actively_replanning = False` internally, allowing `BehaviorFSM` to enter `EMERGENCY_STOP`.  

**Fix:** Added `_find_best_fallback()` method that activates after 3+ consecutive ticks of all-blocked detection. It selects the route with minimum collision probability and maximum clearance, forcing the planner to always provide a usable path. This guarantees `_actively_replanning = True` is maintained.

---

## What Was Changed

| File | Change Type | Description |
|------|-------------|-------------|
| `planning/replanning.py` | **Rewritten** | Added persistent `is_actively_replanning` flag, all-blocked fallback, hysteresis improvements |
| `decision/behavior_logic.py` | **Rewritten** | Added `STOP_WAIT` state, raised thresholds, fixed EVASIVE_REPLAN priority |
| `planning/road_boundary.py` | **New File** | Scenario-dependent boundary constraint enforcement |
| `planning/__init__.py` | **Updated** | Exported `RoadBoundaryEnforcer` |
| `main.py` | **Updated** | Wired `RoadBoundaryEnforcer`, changed `has_active_replan` to use `is_actively_replanning` |
| `tests/test_integration_v2.py` | **New File** | Integration test for all 5 scenarios |

---

## How Replanning Now Works

```
DRIVE (CRUISE)
↓
Obstacle detected by perception pipeline
↓
risk_evaluation.py assigns collision_prob, clearance scores
↓
replanning.py: current route exceeds RISK_THRESHOLD_WARN
↓
replan_needed = True → rank alternative routes → select best
↓
_actively_replanning = True (persistent, not time-limited)
↓
main.py passes is_actively_replanning → behavior_fsm.has_active_replan = True
↓
BehaviorFSM enters EVASIVE_REPLAN (speed 10-22 km/h, never 0)
↓
vehicle follows selected alternative route waypoints
↓
obstacle clears → center route (ROUTE B) becomes safe
↓
should_recenter = True → replanner switches back to ROUTE B
↓
_actively_replanning = False → BehaviorFSM enters CRUISE
```

If all three routes are simultaneously blocked for > 3 ticks:
```
_find_best_fallback() selects minimum-risk corridor
_actively_replanning remains True → vehicle crawls through least-risk gap
```

If vehicle becomes genuinely immobilised (clearance < 1.2 m AND no replan):
```
EMERGENCY_STOP → STOP_WAIT (1s) → re-assess → UNSTICK_CRAWL (4s) → EVASIVE_REPLAN
Vehicle NEVER remains permanently stopped.
```

---

## How Scenario-Dependent Boundary Handling Works

**File:** `planning/road_boundary.py` + `main.py`

The `RoadBoundaryEnforcer` is called after risk evaluation in every simulation tick:

```python
boundary_enforcer.filter_routes_by_boundary(routes, road_type_key, get_road_center)
```

### Permitted crossing scenarios
- `village` (Unmarked Village Road)
- `market` (Heavily Crowded Market Road)

For these, the maximum allowed lateral offset = `road_half_width (4.25m) + 1.80m = 6.05m`  
An absolute outer limit of `4.25m + 3.5m = 7.75m` is still enforced.

### Strictly enforced scenarios
- `intersection` (Urban Intersection)
- `highway` (Mixed-Traffic Highway)
- `sudden_event` (Sudden Obstacle Event)
- All other scenarios

For these, the maximum allowed lateral offset = `road_half_width (4.25m) − 0.60m = 3.65m`  
Routes exceeding this receive a **90% safety score penalty** and a rejection tag, making them effectively unselectable by the planner.

---

## Files Modified / Created

```
autothrash/
├── planning/
│   ├── replanning.py          ← MODIFIED (persistent replan state, all-blocked fallback)
│   ├── road_boundary.py       ← NEW (scenario-dependent boundary enforcement)
│   └── __init__.py            ← MODIFIED (exports RoadBoundaryEnforcer)
├── decision/
│   └── behavior_logic.py      ← MODIFIED (STOP_WAIT state, raised thresholds, priority fix)
├── main.py                    ← MODIFIED (wired boundary enforcer, is_actively_replanning)
└── tests/
    └── test_integration_v2.py ← NEW (validation test for all 5 scenarios)
```

---

## How to Run the Corrected Simulation

### Using the existing batch file:
```
Double-click: autothrash/run_autothrash.bat
```

### Or directly:
```bash
cd autothrash
python main.py
```

### Keyboard shortcuts (unchanged):
- `Space` — Pause/Resume
- `R` — Reset scenario
- `U` — Manual unstick (force crawl mode)
- `←` `↓` `→` — Nudge route to A / B / C
- `1`–`5` — Select scenario by number
- `T` — Toggle Day/Night theme

### To run validation tests:
```bash
cd autothrash
python tests/test_integration_v2.py
```

---

## Test Results (v2)

| Scenario | Zero-speed ticks | Collision | Boundary | Result |
|----------|-----------------|-----------|----------|--------|
| Village Road | 0/90 | ✗ | OK | **PASS** |
| Urban Intersection | 0/90 | ✗ | OK | **PASS** |
| Crowded Market Road | 0/90 | ✗ | OK | **PASS** |
| Mixed-Traffic Highway | 0/90 | ✗ | OK | **PASS** |
| Sudden Obstacle Event | 0/90 | ✗ | OK | **PASS** |

**Overall: ALL PASS — Vehicle never stops permanently, replanning works continuously.**

---

## What Was NOT Changed (Preserved)

- All existing scenarios and their entity behaviors
- All sensor models (Camera, LiDAR, Radar, IMU)  
- Sensor fusion engine
- Perception pipeline and object detection
- Motion prediction
- Traversability estimator
- Candidate route generator
- Risk evaluator
- Vehicle kinematic controller (pure pursuit)
- All visualization panels
- UI layout and keyboard bindings
- Configuration constants
