"""
AI Impact Kit — Central Configuration
Loads environment variables and defines the sensor registry.
"""

import os
from pathlib import Path
from dotenv import load_dotenv

# Load .env from project root (one level up from backend/)
_env_path = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(_env_path)

# ─── Core settings ───────────────────────────────────────────────
SENSOR_IP: str = os.getenv("SENSOR_IP", "192.168.4.1")
SIMULATION_MODE: bool = os.getenv("SIMULATION_MODE", "true").lower() == "true"
OPENAI_API_KEY: str = os.getenv("OPENAI_API_KEY", "")
OPENAI_MODEL: str = os.getenv("OPENAI_MODEL", "gpt-4o")

# ─── Sensor Registry ─────────────────────────────────────────────
# Maps a friendly sensor key → (endpoint path, display name, unit)
SENSOR_REGISTRY: dict[str, dict] = {
    "gas":        {"endpoint": "/gas",        "name": "Gas",                "unit": "%"},
    "soil":       {"endpoint": "/soil",       "name": "Soil Moisture",      "unit": "%"},
    "humidity":   {"endpoint": "/humidity",   "name": "Humidity",           "unit": "%"},
    "temperature":{"endpoint": "/temperature","name": "Temperature",        "unit": "°C"},
    "liquidtemp": {"endpoint": "/liquidtemp", "name": "Liquid Temperature", "unit": "°C"},
    "raindrop":   {"endpoint": "/raindrop",   "name": "Raindrop",           "unit": "%"},
    "ldr":        {"endpoint": "/ldr",        "name": "Light (LDR)",        "unit": "lx"},
    "sound":      {"endpoint": "/sound",      "name": "Sound Level",        "unit": "%"},
    "heartrate":  {"endpoint": "/heartrate",  "name": "Heart Rate",         "unit": "BPM"},
    "spo2":       {"endpoint": "/spo2",       "name": "Oxygen Level (SpO₂)","unit": "%"},
    "bodytemp":   {"endpoint": "/bodytemp",   "name": "Body Temperature",   "unit": "°F"},
    "vibration":  {"endpoint": "/vibration",  "name": "Vibration",          "unit": "%"},
    "motion":     {"endpoint": "/motion",     "name": "Motion",             "unit": ""},
    "flame":      {"endpoint": "/flame",      "name": "Flame Proximity",    "unit": ""},
    "distance":   {"endpoint": "/distance",   "name": "Distance",           "unit": "cm"},
    "speed":      {"endpoint": "/speed",      "name": "Speed (Photogate)",  "unit": "km/h"},
}

# ─── UNSDG Goal Mapping ──────────────────────────────────────────
UNSDG_GOALS: dict[str, dict] = {
    "zero_hunger": {
        "name": "Zero Hunger",
        "sdg_number": 2,
        "icon": "🌾",
        "color": "#f59e0b",
        "sensors": ["gas", "humidity", "soil", "liquidtemp", "raindrop"],
        "description": "Monitor agricultural conditions — gas levels, moisture, soil health, liquid temperature, and rainfall.",
    },
    "good_health": {
        "name": "Good Health & Well-being",
        "sdg_number": 3,
        "icon": "❤️",
        "color": "#ef4444",
        "sensors": ["heartrate", "spo2", "bodytemp", "sound", "gas", "ldr"],
        "description": "Track health vitals and environmental health factors — heart rate, SpO₂, body temp, sound, gas, and light.",
    },
    "climate_action": {
        "name": "Climate Action",
        "sdg_number": 13,
        "icon": "🌍",
        "color": "#22c55e",
        "sensors": ["raindrop", "humidity", "liquidtemp", "ldr", "gas"],
        "description": "Monitor climate-related indicators — rainfall, humidity, temperature, light, and gas levels.",
    },
    "sustainable_cities": {
        "name": "Sustainable Cities & Communities",
        "sdg_number": 11,
        "icon": "🏙️",
        "color": "#6366f1",
        "sensors": ["vibration", "flame", "motion", "gas"],
        "description": "Urban safety and infrastructure monitoring — vibration, flame detection, motion, and gas.",
    },
}
