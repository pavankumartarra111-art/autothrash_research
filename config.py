"""
config.py - Simulation parameters, visual theme, and constants for AUTOTHRASH.
"""

from typing import Tuple

# Window & Frame Settings
WINDOW_TITLE = "AUTOTHRASH — Adaptive Autonomous Navigation for Unstructured Indian Roads (SIH 2026)"
DEFAULT_WIDTH = 1520
DEFAULT_HEIGHT = 920
FPS = 30
TIME_STEP = 1.0 / FPS

# Visual Styling - Preserved Night Theme (Dark / Twilight Cyber-Clean)
NIGHT_THEME = {
    "name": "night",
    "label": "🌙 NIGHT MODE",
    "bg_main": "#0d1117",
    "bg_panel": "#161b22",
    "bg_card": "#21262d",
    "bg_highlight": "#282e33",
    "border": "#30363d",
    "border_highlight": "#58a6ff",
    
    # Text
    "text_primary": "#f0f6fc",
    "text_secondary": "#8b949e",
    "text_muted": "#6e7681",
    "text_accent": "#58a6ff",
    
    # Status Colors
    "status_ok": "#3fb950",       # Green
    "status_warning": "#d29922",  # Amber
    "status_danger": "#f85149",   # Red
    "status_info": "#58a6ff",     # Cyan/Blue
    "status_replan": "#a371f7",   # Violet
    
    # 2.5D Road Scene Colors - Rich Atmospheric Twilight & Cyber-Clean Roadway
    "sky_top": "#080c16",
    "sky_mid": "#111827",
    "sky_horizon": "#1e293b",
    "sky_glow": "#24324a",
    "mountain_silhouette": "#131b28",
    "terrain_left": "#23190e",     # Warm ochre gravel shoulder
    "terrain_right": "#152014",    # Verdant scrub foliage
    "road_surface_far": "#15181f",
    "road_surface_near": "#1c222b",# Modern asphalt
    "road_edge": "#38291c",       # Weathered dirt transition
    "curb_red": "#b91c1c",
    "curb_white": "#f1f5f9",
    "curb_yellow": "#eab308",
    "road_centerline": "#facc15", # Crisp fluorescent highway yellow
    "cat_eye": "#38bdf8",         # Reflector studs
    "milestone_top": "#eab308",   # Classic Indian yellow milestone top
    "milestone_body": "#f8fafc",  # White concrete milestone body
    "headlight_cone": "#38bdf8",
    "streetlight_glow": "#fef08a",
    
    # Candidate Route Spline Colors
    "route_a": "#38bdf8",         # Cyan (Left corridor)
    "route_b": "#a78bfa",         # Purple (Nominal Center)
    "route_c": "#f59e0b",         # Amber (Right corridor)
    "route_selected": "#10b981",  # Vibrant Emerald
    "route_rejected": "#ef4444",  # Crimson Red
    
    # Risk map colors
    "bev_bg": "#0a0d12",
    "bev_grid": "#161d27",
    "bev_vehicle": "#38bdf8",
    "bev_lidar_cone": "#0d3326",
    "bev_radar_arc": "#172b4d",
    "bev_hazard": "#f85149",
}

# Visual Styling - Eye-Catching Vibrant Day Theme (Indian Daylight Highway)
DAY_THEME = {
    "name": "day",
    "label": "☀️ DAY MODE",
    "bg_main": "#e2e8f0",         # Polished slate-gray background
    "bg_panel": "#f8fafc",        # Clean off-white panel
    "bg_card": "#ffffff",         # Crisp pure white cards
    "bg_highlight": "#f1f5f9",
    "border": "#cbd5e1",          # Subtle border
    "border_highlight": "#2563eb",# Vivid tech cobalt blue
    
    # Text
    "text_primary": "#0f172a",    # High-contrast deep slate
    "text_secondary": "#334155",  # Mid slate
    "text_muted": "#64748b",      # Muted slate
    "text_accent": "#0284c7",     # Azure blue
    
    # Status Colors
    "status_ok": "#16a34a",       # Crisp leaf green
    "status_warning": "#d97706",  # Warm sunlit amber
    "status_danger": "#dc2626",   # Crimson alert
    "status_info": "#0284c7",     # Vivid cyan/blue
    "status_replan": "#7c3aed",   # Royal violet
    
    # 2.5D Road Scene Colors - Brilliant Sunlit Indian Highway Scene
    "sky_top": "#0284c7",         # Deep cerulean sky
    "sky_mid": "#38bdf8",         # Bright azure daylight
    "sky_horizon": "#7dd3fc",     # Warm atmospheric sky horizon
    "sky_glow": "#fef08a",        # Warm golden sunlight diffusion
    "mountain_silhouette": "#475569", # Sunlit mountain ridges with atmospheric haze
    "terrain_left": "#92400e",    # Sun-baked Indian terracotta / ochre roadside earth
    "terrain_right": "#166534",   # Rich verdant rural roadside shrubbery and trees
    "road_surface_far": "#334155",# Sunlit highway asphalt far
    "road_surface_near": "#1e293b",# Crisp textured asphalt near
    "road_edge": "#78350f",       # Sun-baked dry dirt shoulder transition
    "curb_red": "#dc2626",        # Vibrant crimson curb
    "curb_white": "#ffffff",      # Brilliant white curb
    "curb_yellow": "#facc15",
    "road_centerline": "#facc15", # Vivid Indian highway fluorescent yellow
    "cat_eye": "#0284c7",         # Reflective road stud
    "milestone_top": "#facc15",   # Classic Indian yellow milestone top
    "milestone_body": "#ffffff",  # White concrete milestone body
    "headlight_cone": "#60a5fa",
    "streetlight_glow": "#fef08a",
    
    # Candidate Route Spline Colors
    "route_a": "#0284c7",         # Electric cyan-blue
    "route_b": "#7c3aed",         # Vivid purple
    "route_c": "#ea580c",         # High-visibility orange
    "route_selected": "#16a34a",  # Vibrant emerald
    "route_rejected": "#dc2626",  # Bold hazard red
    
    # Risk map colors
    "bev_bg": "#0f172a",          # Deep slate radar backdrop for crisp contrast
    "bev_grid": "#1e293b",
    "bev_vehicle": "#38bdf8",
    "bev_lidar_cone": "#064e3b",
    "bev_radar_arc": "#1e3a8a",
    "bev_hazard": "#f43f5e",
}

THEMES = {
    "night": NIGHT_THEME,
    "day": DAY_THEME
}

CURRENT_THEME_NAME = "night"
THEME = dict(NIGHT_THEME)


def set_active_theme(theme_name: str) -> dict:
    """Switches the active theme dictionary in-place and returns it."""
    global CURRENT_THEME_NAME
    if theme_name in THEMES:
        CURRENT_THEME_NAME = theme_name
        THEME.clear()
        THEME.update(THEMES[theme_name])
    return THEME


def get_active_theme_name() -> str:
    """Returns the current theme identifier ('night' or 'day')."""
    return CURRENT_THEME_NAME


def toggle_theme() -> Tuple[str, dict]:
    """Toggles between 'night' and 'day' themes."""
    new_theme = "day" if CURRENT_THEME_NAME == "night" else "night"
    set_active_theme(new_theme)
    return new_theme, THEME


# Road & World Coordinates
WORLD_ROAD_WIDTH = 8.5            # Typical 2-lane Indian road width in meters
SHOULDER_WIDTH = 2.2             # Dirt shoulder in meters
SIM_HORIZON_DISTANCE = 90.0      # Forward visual distance in meters
WAYPOINT_SPACING = 3.5           # Meters between trajectory waypoints

# Vehicle Physical Parameters
VEHICLE_LENGTH = 4.2             # Autonomous sedan / SUV length in meters
VEHICLE_WIDTH = 1.8              # Width in meters
VEHICLE_MAX_SPEED = 45.0         # Max design speed in km/h for mixed roads
VEHICLE_DEFAULT_SPEED = 32.0     # Nominal cruising speed in km/h
VEHICLE_MAX_ACCEL = 2.4          # m/s^2
VEHICLE_MAX_BRAKE = 4.5          # m/s^2
MAX_STEERING_ANGLE = 35.0        # Degrees

# Sensor Pipeline Parameters
SENSOR_RATES = {
    "camera": 30,  # Hz
    "lidar": 10,   # Hz
    "radar": 20,   # Hz
    "imu": 100,    # Hz
}

SENSOR_CONFIDENCE_BASELINE = {
    "camera": 0.92,
    "lidar": 0.95,
    "radar": 0.89,
    "imu": 0.98,
}

# Risk Thresholds
RISK_THRESHOLD_SAFE = 0.25
RISK_THRESHOLD_WARN = 0.55
RISK_THRESHOLD_CRITICAL = 0.75

# Corridor Bounds (lateral offsets in meters relative to road center)
CORRIDOR_LEFT_OFFSET = -2.2
CORRIDOR_CENTER_OFFSET = 0.0
CORRIDOR_RIGHT_OFFSET = 2.2


def get_road_center(y: float) -> float:
    """Calculates continuous, natural road curvature center offset (in meters) at distance y.
    Features realistic gentle bends, S-curves, and turns suitable for autonomous steering."""
    if y < 12.0:
        return 0.0
    import math
    blend = min(1.0, (y - 12.0) / 10.0)
    # Multi-frequency organic road bend curve
    curve = 2.4 * math.sin((y - 12.0) * 0.040) + 1.1 * math.sin((y - 12.0) * 0.018)
    return round(blend * curve, 3)


def get_road_heading_deg(y: float) -> float:
    """Calculates road tangent heading angle in degrees at distance y."""
    import math
    dy = 0.5
    c1 = get_road_center(y - dy)
    c2 = get_road_center(y + dy)
    return round(math.degrees(math.atan2(c2 - c1, 2.0 * dy)), 2)

