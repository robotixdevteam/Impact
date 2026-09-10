"""
AI Impact Kit — Sensor Simulator
Generates realistic synthetic sensor data for development and testing
without the physical ESP32 hardware.
"""

import random
import math
import time

# Base values and ranges for each sensor
_PROFILES: dict[str, dict] = {
    "gas":        {"base": 30,   "drift": 8,   "noise": 3,    "unit": "%",    "name": "Gas"},
    "soil":       {"base": 55,   "drift": 10,  "noise": 2,    "unit": "%",    "name": "Soil Moisture"},
    "humidity":   {"base": 62,   "drift": 8,   "noise": 1.5,  "unit": "%",    "name": "Humidity"},
    "temperature":{"base": 28,   "drift": 4,   "noise": 0.5,  "unit": "°C",   "name": "Temperature"},
    "liquidtemp": {"base": 25,   "drift": 3,   "noise": 0.3,  "unit": "°C",   "name": "Liquid Temperature"},
    "raindrop":   {"base": 15,   "drift": 20,  "noise": 5,    "unit": "%",    "name": "Raindrop"},
    "ldr":        {"base": 350,  "drift": 100, "noise": 20,   "unit": "lx",   "name": "Light (LDR)"},
    "sound":      {"base": 45,   "drift": 15,  "noise": 8,    "unit": "%",    "name": "Sound Level"},
    "heartrate":  {"base": 72,   "drift": 10,  "noise": 3,    "unit": "BPM",  "name": "Heart Rate"},
    "spo2":       {"base": 97,   "drift": 1.5, "noise": 0.5,  "unit": "%",    "name": "Oxygen Level (SpO₂)"},
    "bodytemp":   {"base": 98.2, "drift": 0.8, "noise": 0.2,  "unit": "°F",   "name": "Body Temperature"},
    "vibration":  {"base": 5,    "drift": 6,   "noise": 3,    "unit": "%",    "name": "Vibration"},
    "motion":     {"base": 0,    "drift": 30,  "noise": 10,   "unit": "",     "name": "Motion"},
    "flame":      {"base": 0,    "drift": 20,  "noise": 5,    "unit": "",     "name": "Flame Proximity"},
    "distance":   {"base": 50,   "drift": 30,  "noise": 5,    "unit": "cm",   "name": "Distance"},
    "speed":      {"base": 0,    "drift": 5,   "noise": 1,    "unit": "km/h", "name": "Speed (Photogate)"},
}

# Slow-moving sinusoidal offset to simulate environmental drift
_START = time.time()


def _generate_value(key: str) -> float:
    """Generate a realistic value for the given sensor key."""
    p = _PROFILES.get(key)
    if not p:
        return 0.0

    elapsed = time.time() - _START
    # Slow sinusoidal drift (period ~120 s) to simulate gradual change
    drift = p["drift"] * math.sin(elapsed / 120 * 2 * math.pi + hash(key) % 10)
    # Random Gaussian noise
    noise = random.gauss(0, p["noise"])
    value = p["base"] + drift + noise
    # Clamp to reasonable ranges
    value = max(0, round(value, 2))
    return value


def simulate_sensor(name: str) -> dict:
    """Return a simulated sensor reading matching the ESP32 JSON format."""
    p = _PROFILES.get(name)
    if not p:
        return {"sensor": name, "value": 0, "unit": "", "error": f"Unknown sensor: {name}"}
    return {
        "sensor": p["name"],
        "value": _generate_value(name),
        "unit": p["unit"],
    }


def simulate_all_sensors() -> dict:
    """Return a dict mimicking the ESP32 /api/sensors bulk endpoint."""
    return {
        "light":          _generate_value("ldr"),
        "gas":            _generate_value("gas"),
        "raindrop":       _generate_value("raindrop"),
        "humidity":       _generate_value("humidity"),
        "temperature":    _generate_value("temperature"),
        "liquidTemp":     _generate_value("liquidtemp"),
        "vibration":      _generate_value("vibration"),
        "distance":       _generate_value("distance"),
        "sound":          _generate_value("sound"),
        "motion":         _generate_value("motion"),
        "soilMoisture":   _generate_value("soil"),
        "flameProximity": _generate_value("flame"),
        "speed":          _generate_value("speed"),
        "heartRate":      _generate_value("heartrate"),
        "spO2":           _generate_value("spo2"),
        "bodyTempF":      _generate_value("bodytemp"),
        "batteryVoltage": round(3.7 + random.gauss(0, 0.05), 2),
    }
