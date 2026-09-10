"""
AI Impact Kit — Sensor HTTP Client
Fetches real-time data from the ESP32 hardware via HTTP GET requests.
Falls back to the simulator when SIMULATION_MODE is enabled.
"""

import asyncio
import httpx
import config
from sensors.simulator import simulate_sensor, simulate_all_sensors


async def fetch_sensor(name: str) -> dict:
    """
    Fetch a single sensor value.
    Returns: {"sensor": "...", "value": ..., "unit": "..."}
    """
    if config.SIMULATION_MODE:
        return simulate_sensor(name)

    info = config.SENSOR_REGISTRY.get(name)
    if not info:
        return {"sensor": name, "value": None, "unit": "", "error": f"Unknown sensor: {name}"}

    url = f"http://{config.SENSOR_IP}{info['endpoint']}"
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            return resp.json()
    except httpx.TimeoutException:
        return {"sensor": info["name"], "value": None, "unit": info["unit"], "error": "Sensor timeout"}
    except Exception as exc:
        return {"sensor": info["name"], "value": None, "unit": info["unit"], "error": str(exc)}


async def fetch_all_sensors() -> dict:
    """
    Fetch the bulk /api/sensors endpoint (all sensors at once).
    Returns the raw JSON dict from the ESP32.
    """
    if config.SIMULATION_MODE:
        return simulate_all_sensors()

    url = f"http://{config.SENSOR_IP}/api/sensors"
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            return resp.json()
    except Exception as exc:
        return {"error": str(exc)}


async def fetch_multiple(sensor_names: list[str]) -> list[dict]:
    """
    Fetch multiple sensors in parallel.
    Returns a list of sensor result dicts.
    """
    tasks = [fetch_sensor(name) for name in sensor_names]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    out = []
    for i, result in enumerate(results):
        if isinstance(result, Exception):
            info = SENSOR_REGISTRY.get(sensor_names[i], {})
            out.append({
                "sensor": info.get("name", sensor_names[i]),
                "value": None,
                "unit": info.get("unit", ""),
                "error": str(result),
            })
        else:
            out.append(result)
    return out
