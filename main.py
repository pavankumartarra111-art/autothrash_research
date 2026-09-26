"""
main.py - Main application entry point for AUTOTHRASH.
Adaptive Autonomous Navigation for Unstructured Indian Roads (SIH 2026).
A 100% local, desktop-runnable engineering simulation prototype.
"""
import sys
import os
import time
import tkinter as tk
from tkinter import ttk, messagebox

# Ensure autothrash root is in sys.path
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
if SCRIPT_DIR not in sys.path:
    sys.path.insert(0, SCRIPT_DIR)

from config import (
    WINDOW_TITLE, DEFAULT_WIDTH, DEFAULT_HEIGHT, FPS, TIME_STEP, THEME,
    set_active_theme, toggle_theme, get_active_theme_name, THEMES
)
from perception.sensors import SensorSuite
from perception.sensor_fusion import SensorFusionEngine
from perception.object_detection import PerceptionPipeline
from prediction.motion_prediction import MotionPredictor
from planning.traversability import TraversabilityEstimator
from planning.candidate_routes import CandidateRouteGenerator
from planning.risk_estimation import RiskEvaluator
from planning.replanning import AdaptiveReplanner, ReplanEvent
from planning.road_boundary import RoadBoundaryEnforcer
from decision.behavior_logic import BehaviorFSM
from decision.feasibility import NearbyTrafficFeasibility
from control.vehicle_motion import VehicleController
from scenarios.scenario_manager import ScenarioManager

from visualization.main_scene import MainScene25D
from visualization.risk_map import LocalRiskMapBEV
from visualization.perception_panel import PerceptionPanel
from visualization.planning_panel import PlanningPanel
from visualization.telemetry_panel import TelemetryPanel
from visualization.metrics_panel import MetricsPanel


class AutoThrashApp:
    """Master Application Coordinator for the AUTOTHRASH Simulation."""

    def __init__(self, root: tk.Tk):
        self.root = root
        self.root.title(WINDOW_TITLE)
        self.root.geometry(f"{DEFAULT_WIDTH}x{DEFAULT_HEIGHT}")
        self.root.configure(bg=THEME["bg_main"])
        self.root.minsize(1280, 800)

        # Simulation State
        self.is_running = True
        self.sim_time = 0.0
        self.dt = TIME_STEP

        # Initialize Subsystems
        self.sensor_suite = SensorSuite()
        self.fusion_engine = SensorFusionEngine(self.sensor_suite)
        self.perception_pipeline = PerceptionPipeline()
        self.motion_predictor = MotionPredictor()
        self.traversability_estimator = TraversabilityEstimator()
        self.route_generator = CandidateRouteGenerator()
        self.risk_evaluator = RiskEvaluator()
        self.replanner = AdaptiveReplanner()
        self.boundary_enforcer = RoadBoundaryEnforcer()  # FIX: scenario-dependent boundary constraint
        self.behavior_fsm = BehaviorFSM()
        self.feasibility_engine = NearbyTrafficFeasibility()
        self.controller = VehicleController()
        self.scenario_manager = ScenarioManager()

        # Build UI Hierarchy
        self._build_top_toolbar()
        self._build_main_layout()

        # Keyboard Bindings for Instant Control
        self.root.bind("<space>", lambda e: self._toggle_pause())
        self.root.bind("<Key-r>", lambda e: self._reset_simulation())
        self.root.bind("<Key-R>", lambda e: self._reset_simulation())
        self.root.bind("<Key-t>", lambda e: self._toggle_theme())
        self.root.bind("<Key-T>", lambda e: self._toggle_theme())
        self.root.bind("<Key-u>", lambda e: self._manual_unstick())
        self.root.bind("<Key-U>", lambda e: self._manual_unstick())
        self.root.bind("<Left>", lambda e: self._nudge_route("ROUTE A"))
        self.root.bind("<Down>", lambda e: self._nudge_route("ROUTE B"))
        self.root.bind("<Right>", lambda e: self._nudge_route("ROUTE C"))
        for i in range(1, 6):
            self.root.bind(f"<Key-{i}>", lambda e, idx=i: self._select_scenario_by_index(idx))

        # Start Simulation Loop
        self.root.after(30, self._simulation_tick)

    def _build_top_toolbar(self):
        """Top navigation bar containing title, scenario selector, theme toggle, and simulation controls."""
        self.top_bar = tk.Frame(self.root, bg=THEME["bg_panel"], height=50, highlightthickness=1, highlightbackground=THEME["border"], padx=12, pady=6)
        self.top_bar.pack(side="top", fill="x")

        # 1. Project Logo / Title
        self.title_box = tk.Frame(self.top_bar, bg=THEME["bg_panel"])
        self.title_box.pack(side="left")
        
        self.title_lbl = tk.Label(self.title_box, text="AUTOTHRASH", bg=THEME["bg_panel"], fg=THEME["text_accent"], font=("Segoe UI", 12, "bold"))
        self.title_lbl.pack(side="left")
        self.subtitle_lbl = tk.Label(self.title_box, text=" | ADAPTIVE NAVIGATION (SIH 2026)", bg=THEME["bg_panel"], fg=THEME["text_secondary"], font=("Segoe UI", 9, "bold"))
        self.subtitle_lbl.pack(side="left")

        # Status Pill
        self.sim_status_pill = tk.Label(self.top_bar, text="SIM RUNNING", bg="#064e3b", fg="#6ee7b7", font=("Segoe UI", 8, "bold"), padx=8, pady=2)
        self.sim_status_pill.pack(side="left", padx=12)

        # 2. Scenario Dropdown Selector
        self.scen_box = tk.Frame(self.top_bar, bg=THEME["bg_panel"])
        self.scen_box.pack(side="left", padx=8)

        self.scen_lbl = tk.Label(self.scen_box, text="SCENARIO:", bg=THEME["bg_panel"], fg=THEME["text_muted"], font=("Segoe UI", 8, "bold"))
        self.scen_lbl.pack(side="left", padx=(0, 6))

        self.scenario_var = tk.StringVar(value="Village Road")
        scenarios = [
            "Village Road",
            "Urban Intersection",
            "Crowded Market Road",
            "Mixed-Traffic Highway",
            "Sudden Obstacle Event"
        ]
        self.scenario_dropdown = ttk.Combobox(
            self.scen_box,
            textvariable=self.scenario_var,
            values=scenarios,
            state="readonly",
            width=20,
            font=("Segoe UI", 8)
        )
        self.scenario_dropdown.pack(side="left")
        self.scenario_dropdown.bind("<<ComboboxSelected>>", self._on_scenario_changed)

        # 3. Dynamic Day / Night Theme Switcher (Prominent & Eye-Catching)
        is_day = (get_active_theme_name() == "day")
        self.btn_theme = tk.Button(
            self.top_bar,
            text="☀️ DAY THEME" if not is_day else "🌙 NIGHT THEME",
            bg="#f59e0b" if not is_day else "#1e293b",
            fg="#0f172a" if not is_day else "#f0f6fc",
            activebackground="#fbbf24" if not is_day else "#334155",
            activeforeground="#000000" if not is_day else "#ffffff",
            font=("Segoe UI", 8, "bold"),
            relief="flat",
            padx=10,
            pady=2,
            command=self._toggle_theme
        )
        self.btn_theme.pack(side="left", padx=10)

        # 4. Simulation Playback Controls
        self.ctrl_box = tk.Frame(self.top_bar, bg=THEME["bg_panel"])
        self.ctrl_box.pack(side="left", padx=8)

        btn_bg = "#f1f5f9" if is_day else "#1e293b"
        self.btn_play_pause = tk.Button(
            self.ctrl_box, text="⏸ PAUSE", bg=btn_bg, fg=THEME["text_primary"],
            activebackground="#334155", font=("Segoe UI", 8, "bold"), relief="flat", padx=8, pady=2,
            command=self._toggle_pause
        )
        self.btn_play_pause.pack(side="left", padx=2)

        self.btn_step = tk.Button(
            self.ctrl_box, text="⏭ STEP", bg=btn_bg, fg=THEME["text_primary"],
            activebackground="#334155", font=("Segoe UI", 8), relief="flat", padx=6, pady=2,
            command=self._step_once
        )
        self.btn_step.pack(side="left", padx=2)

        self.btn_reset = tk.Button(
            self.ctrl_box, text="↺ RESET", bg=btn_bg, fg=THEME["text_primary"],
            activebackground="#334155", font=("Segoe UI", 8), relief="flat", padx=6, pady=2,
            command=self._reset_simulation
        )
        self.btn_reset.pack(side="left", padx=2)

        self.btn_unstick = tk.Button(
            self.ctrl_box, text="⚡ UNSTICK", bg="#0369a1", fg="#e0f2fe",
            activebackground="#0284c7", font=("Segoe UI", 8, "bold"), relief="flat", padx=8, pady=2,
            command=self._manual_unstick
        )
        self.btn_unstick.pack(side="left", padx=4)

        # 5. Interactive Hazard Injectors
        self.haz_box = tk.Frame(self.top_bar, bg=THEME["bg_panel"])
        self.haz_box.pack(side="right")

        self.haz_lbl = tk.Label(self.haz_box, text="EVENT INJECTION:", bg=THEME["bg_panel"], fg=THEME["text_muted"], font=("Segoe UI", 7, "bold"))
        self.haz_lbl.pack(side="left", padx=(0, 6))

        btn_ped_hazard = tk.Button(
            self.haz_box, text="⚡ SUDDEN PEDESTRIAN", bg="#7f1d1d", fg="#fca5a5",
            activebackground="#991b1b", font=("Segoe UI", 8, "bold"), relief="flat", padx=6, pady=2,
            command=self._trigger_pedestrian_event
        )
        btn_ped_hazard.pack(side="left", padx=2)

        btn_obs_hazard = tk.Button(
            self.haz_box, text="⚠️ OBSTACLE CUT-IN", bg="#78350f", fg="#fef08a",
            activebackground="#92400e", font=("Segoe UI", 8, "bold"), relief="flat", padx=6, pady=2,
            command=self._trigger_obstacle_event
        )
        btn_obs_hazard.pack(side="left", padx=2)

        self.btn_occlusion = tk.Button(
            self.haz_box, text="👁 OCCLUSION", bg=btn_bg, fg="#0284c7" if is_day else "#93c5fd",
            activebackground="#334155", font=("Segoe UI", 8), relief="flat", padx=6, pady=2,
            command=self._toggle_occlusion_event
        )
        self.btn_occlusion.pack(side="left", padx=2)

    def _build_main_layout(self):
        """Constructs Left (Perception), Center (3D Scene), Right (Planning), and Bottom panels."""
        self.main_container = tk.Frame(self.root, bg=THEME["bg_main"])
        self.main_container.pack(fill="both", expand=True)

        # Horizontal Center Band: [Left Panel] [Large 2.5D Scene] [Right Panel]
        self.center_band = tk.Frame(self.main_container, bg=THEME["bg_main"])
        self.center_band.pack(side="top", fill="both", expand=True)

        # LEFT PANEL: Multi-Sensor Perception & Probabilities
        self.perception_panel = PerceptionPanel(self.center_band, on_elevate_callback=self._on_elevate_toggled)
        self.perception_panel.frame.pack(side="left", fill="y", padx=(6, 3), pady=4)

        # CENTER HERO: 2.5D Driving Simulation Scene
        self.scene_viewport = MainScene25D(self.center_band)
        self.scene_viewport.canvas.pack(side="left", fill="both", expand=True, padx=3, pady=4)

        # RIGHT PANEL: Adaptive Path Planning & Feasibility Decision
        self.planning_panel = PlanningPanel(self.center_band)
        self.planning_panel.frame.pack(side="right", fill="y", padx=(3, 6), pady=4)

        # BOTTOM HORIZONTAL BAND: [Risk Map BEV] [Vehicle Telemetry] [Performance Metrics]
        self.bottom_band = tk.Frame(self.main_container, bg=THEME["bg_main"], height=170)
        self.bottom_band.pack(side="bottom", fill="x", padx=6, pady=(0, 6))

        # Sub-panel 1: Local Top-Down Risk Map (35% width)
        self.risk_map = LocalRiskMapBEV(self.bottom_band)
        self.risk_map.frame.pack(side="left", fill="both", expand=True, padx=(0, 3))

        # Sub-panel 2: Vehicle Kinematics & Control (35% width)
        self.telemetry_panel = TelemetryPanel(self.bottom_band)
        self.telemetry_panel.frame.pack(side="left", fill="both", expand=True, padx=3)

        # Sub-panel 3: Engineering Performance Metrics (30% width)
        self.metrics_panel = MetricsPanel(self.bottom_band)
        self.metrics_panel.frame.pack(side="right", fill="both", expand=True, padx=(3, 0))

    def _toggle_theme(self):
        """Switches dynamically between Day Mode and Night Mode across all UI components and 2.5D view."""
        new_theme_name, theme = toggle_theme()
        is_day = (new_theme_name == "day")

        # Update root window & master layout frames
        self.root.configure(bg=theme["bg_main"])
        self.main_container.configure(bg=theme["bg_main"])
        self.center_band.configure(bg=theme["bg_main"])
        self.bottom_band.configure(bg=theme["bg_main"])

        # Update Top Toolbar Containers & Labels
        tb_bg = theme["bg_panel"]
        self.top_bar.configure(bg=tb_bg, highlightbackground=theme["border"])
        self.title_box.configure(bg=tb_bg)
        self.title_lbl.configure(bg=tb_bg, fg=theme["text_accent"])
        self.subtitle_lbl.configure(bg=tb_bg, fg=theme["text_secondary"])

        self.scen_box.configure(bg=tb_bg)
        self.scen_lbl.configure(bg=tb_bg, fg=theme["text_muted"])

        self.ctrl_box.configure(bg=tb_bg)
        btn_bg = "#f1f5f9" if is_day else "#1e293b"
        btn_fg = theme["text_primary"]
        self.btn_play_pause.configure(bg=btn_bg, fg=btn_fg)
        self.btn_step.configure(bg=btn_bg, fg=btn_fg)
        self.btn_reset.configure(bg=btn_bg, fg=btn_fg)

        self.haz_box.configure(bg=tb_bg)
        self.haz_lbl.configure(bg=tb_bg, fg=theme["text_muted"])
        self.btn_occlusion.configure(bg=btn_bg, fg="#0284c7" if is_day else "#93c5fd")

        # Update Theme Switcher Button itself
        if is_day:
            self.btn_theme.configure(
                text="🌙 NIGHT THEME",
                bg="#1e293b",
                fg="#f0f6fc",
                activebackground="#334155",
                activeforeground="#ffffff"
            )
        else:
            self.btn_theme.configure(
                text="☀️ DAY THEME",
                bg="#f59e0b",
                fg="#0f172a",
                activebackground="#fbbf24",
                activeforeground="#000000"
            )

        # Notify All Subsystems and Panels to update their styles
        self.perception_panel.set_theme(theme)
        self.scene_viewport.set_theme(theme)
        self.planning_panel.set_theme(theme)
        self.risk_map.set_theme(theme)
        self.telemetry_panel.set_theme(theme)
        self.metrics_panel.set_theme(theme)

        # Re-render immediately so the screen refreshes seamlessly
        self._render_all()

    def _on_scenario_changed(self, event=None):
        name = self.scenario_var.get()
        self.scenario_manager.load_scenario(name)
        self.controller.reset(initial_x=0.0, initial_y=0.0, initial_speed=28.0)
        self.replanner.selected_route_name = "ROUTE B"
        self.replanner.active_event = None

    def _toggle_pause(self):
        self.is_running = not self.is_running
        if self.is_running:
            self.btn_play_pause.config(text="⏸ PAUSE")
            self.sim_status_pill.config(text="SIM RUNNING", bg="#064e3b", fg="#6ee7b7")
        else:
            self.btn_play_pause.config(text="▶ RESUME")
            self.sim_status_pill.config(text="SIM PAUSED", bg="#78350f", fg="#fef08a")
        # Instant visual feedback on screen
        self._render_all()

    def _step_once(self):
        if not self.is_running:
            self._update_physics_and_planning()
            self._render_all()

    def _select_scenario_by_index(self, idx: int):
        scenarios = [
            "Village Road",
            "Urban Intersection",
            "Crowded Market Road",
            "Mixed-Traffic Highway",
            "Sudden Obstacle Event"
        ]
        if 1 <= idx <= len(scenarios):
            name = scenarios[idx - 1]
            self.scenario_var.set(name)
            self._on_scenario_changed()

    def _nudge_route(self, route_name: str):
        if hasattr(self, "latest_routes") and route_name in self.latest_routes:
            self.replanner.selected_route_name = route_name
            self.replanner.active_event = ReplanEvent(
                timestamp=time.time(),
                reason=f"Operator Steering Nudge: Selected {route_name}",
                previous_path="AUTO",
                new_path=route_name,
                measured_latency_ms=10.0,
                trigger_risk=0.20
            )

    def _reset_simulation(self):
        self.scenario_manager.reset_scenario()
        self.controller.reset(initial_x=0.0, initial_y=0.0, initial_speed=28.0)
        self.replanner.selected_route_name = "ROUTE B"
        self.replanner.active_event = None
        self.replanner.total_replans_count = 0
        self.sensor_suite.toggle_elevated_camera(False)
        self.perception_panel.is_elevated = False
        btn_bg = "#f1f5f9" if get_active_theme_name() == "day" else "#1e293b"
        self.perception_panel.btn_elevate.config(text="ELEVATE CAMERA VIEW", bg=btn_bg, fg=THEME["text_accent"])

    def _trigger_pedestrian_event(self):
        self.scenario_manager.trigger_sudden_pedestrian(self.controller.state.y)

    def _trigger_obstacle_event(self):
        self.scenario_manager.trigger_unexpected_obstacle(self.controller.state.y)

    def _toggle_occlusion_event(self):
        cur_occl = self.scenario_manager.occlusion_factor > 0.1
        new_occl = not cur_occl
        self.scenario_manager.trigger_camera_occlusion(new_occl)
        if new_occl:
            self.btn_occlusion.config(text="👁 OCCLUDED", bg="#7f1d1d", fg="#fca5a5")
        else:
            btn_bg = "#f1f5f9" if get_active_theme_name() == "day" else "#1e293b"
            self.btn_occlusion.config(text="👁 OCCLUSION", bg=btn_bg, fg="#0284c7" if get_active_theme_name() == "day" else "#93c5fd")

    def _on_elevate_toggled(self, is_elevated: bool):
        self.sensor_suite.toggle_elevated_camera(is_elevated)

    def _manual_unstick(self):
        self.behavior_fsm.trigger_manual_unstick()
        if hasattr(self, "latest_routes") and self.latest_routes:
            best = self.replanner.select_best_route(self.latest_routes)
            self.replanner.active_event = ReplanEvent(
                timestamp=time.time(),
                reason="Manual Override: Dynamic crawl bypass engaged",
                previous_path=self.replanner.selected_route_name,
                new_path=best.name,
                measured_latency_ms=12.0,
                trigger_risk=0.45
            )
            # FIX: Set persistent replan flag immediately so BehaviorFSM
            # uses EVASIVE_REPLAN speed even before the next full tick.
            self.replanner._actively_replanning = True
        if not self.is_running:
            self._toggle_pause()


    def _simulation_tick(self):
        """The Master Closed Loop: PERCEIVE → PREDICT → PLAN → MOVE → REASSESS → REPLAN."""
        try:
            if self.is_running:
                self._update_physics_and_planning()
            self._render_all()
        except Exception as e:
            print(f"[AUTOTHRASH RUNTIME GUARD] Exception during tick: {e}")
        finally:
            # Schedule next tick for smooth 30 FPS - GUARANTEED never to die!
            self.root.after(int(1000 / FPS), self._simulation_tick)

    def _update_physics_and_planning(self):
        t_cycle_start = time.perf_counter()
        dt = self.dt
        self.sim_time += dt

        av_state = self.controller.state

        # 1. Update Scenario Entities
        self.scenario_manager.update(dt, av_state)

        # 2. Multi-Sensor Simulation & Degradation Update
        self.sensor_suite.update(dt, self.scenario_manager.occlusion_factor)

        # 3. Sensor Fusion Pipeline
        fusion_data = self.fusion_engine.process(self.scenario_manager.occlusion_factor)

        # 4. Probabilistic Perception (Detection, P_det, C_motion, Risk)
        detected_objects = self.perception_pipeline.process_entities(
            self.scenario_manager.entities,
            av_state,
            self.sensor_suite
        )

        # 5. Short-Term Trajectory Prediction
        predictions = self.motion_predictor.predict(detected_objects)

        # 6. Road Corridor Traversability Estimation
        road_type_key = {
            "Village Road": "village",
            "Urban Intersection": "intersection",
            "Crowded Market Road": "market",
            "Mixed-Traffic Highway": "highway",
            "Sudden Obstacle Event": "sudden_event"
        }.get(self.scenario_manager.active_scenario_name, "village")
        
        corridors = self.traversability_estimator.estimate(detected_objects, road_type_key)

        # 7. Candidate Trajectories Generation (Route A, B, C)
        routes = self.route_generator.generate_routes(av_state.x, av_state.y)

        # 8. Dynamic Risk & Clearance Evaluation Along Trajectories
        self.risk_evaluator.evaluate_routes(routes, detected_objects, predictions, corridors, av_state)

        # 8b. FIX: Road Boundary Constraint Enforcement (scenario-dependent)
        # Village Road and Crowded Market Road allow controlled boundary crossing.
        # All other scenarios enforce strict road boundary containment.
        from config import get_road_center as _road_center_fn
        self.boundary_enforcer.filter_routes_by_boundary(
            routes, road_type_key, road_center_fn=_road_center_fn
        )

        # 9. Adaptive Replanning Engine (Selects Route, Triggers Events, Measures Latency)
        selected_route = self.replanner.select_best_route(routes)
        self.replanner.check_active_event_expiry()

        # 10. Nearby Traffic Feasibility Evidence
        feasibility_evidence = self.feasibility_engine.evaluate(detected_objects)

        # 11. Tactical Behavior FSM (Speed & Acceleration modulation)
        highest_risk = max((o.detection_prob * (0.9 if o.risk_level in ("HIGH", "CRITICAL") else 0.3) for o in detected_objects), default=0.1)
        min_clr = selected_route.min_clearance_m
        imm_clr = getattr(selected_route, "immediate_clearance_m", min_clr)
        # FIX: Use replanner.is_actively_replanning (persistent flag) instead of
        # active_event is not None (which expired after 4s and caused permanent stop).
        target_speed = self.behavior_fsm.update(
            highest_risk=highest_risk,
            min_clearance=min_clr,
            has_active_replan=self.replanner.is_actively_replanning,
            immediate_clearance=imm_clr,
            dt=dt,
            current_speed_kmh=av_state.speed_kmh
        )

        # 12. Kinematic Vehicle Controller Integration (Pure Pursuit tracking selected path)
        self.controller.update(dt, target_speed, selected_route.waypoints)

        # Save latest cycle computation time
        self.last_cycle_time_ms = (time.perf_counter() - t_cycle_start) * 1000.0

        # Store references for rendering
        self.latest_fusion_data = fusion_data
        self.latest_detected_objects = detected_objects
        self.latest_corridors = corridors
        self.latest_routes = routes
        self.latest_feasibility = feasibility_evidence

    def _render_all(self):
        av_state = self.controller.state

        # Update 2.5D Driving Scene (Center)
        self.scene_viewport.render(
            av_state=av_state,
            entities=self.scenario_manager.entities,
            routes=getattr(self, "latest_routes", {}),
            selected_route_name=self.replanner.selected_route_name,
            replan_event=self.replanner.active_event,
            sensor_suite=self.sensor_suite,
            traversability_corridors=getattr(self, "latest_corridors", {}),
            is_paused=(not self.is_running)
        )

        # Update Top-Down Risk Map (BEV)
        self.risk_map.render(
            av_state=av_state,
            entities=self.scenario_manager.entities,
            routes=self.latest_routes,
            selected_route_name=self.replanner.selected_route_name,
            sensor_suite=self.sensor_suite
        )

        # Update Perception Panel (Left)
        self.perception_panel.update(
            fusion_data=self.latest_fusion_data,
            detected_objects=self.latest_detected_objects
        )

        # Update Planning Panel (Right)
        self.planning_panel.update(
            corridors=self.latest_corridors,
            routes=self.latest_routes,
            selected_route_name=self.replanner.selected_route_name,
            feasibility=self.latest_feasibility
        )

        # Update Vehicle Telemetry (Bottom Center)
        self.telemetry_panel.update(
            av_state=av_state,
            driving_state_name=self.behavior_fsm.state.value
        )

        # Update Performance Metrics (Bottom Right)
        completion_pct = min(100, int((av_state.distance_traveled_m / self.scenario_manager.target_distance_m) * 100))
        min_clearance = self.latest_routes[self.replanner.selected_route_name].min_clearance_m if self.replanner.selected_route_name in self.latest_routes else 2.5

        self.metrics_panel.update(
            completion_pct=completion_pct,
            collision_detected=self.scenario_manager.collision_detected,
            replans_count=self.replanner.total_replans_count,
            replan_latency_ms=self.replanner.avg_replanning_latency,
            min_clearance_m=min_clearance,
            path_smoothness=self.controller.path_smoothness,
            cycle_time_ms=getattr(self, "last_cycle_time_ms", 12.0),
            scenario_name=self.scenario_manager.active_scenario_name
        )


def main():
    root = tk.Tk()
    app = AutoThrashApp(root)
    root.mainloop()


if __name__ == "__main__":
    main()
