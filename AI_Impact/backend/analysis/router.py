"""
AI Impact Kit — Data Analysis API Router
Provides endpoints for fetching sensor data individually, in groups,
by UNSDG goal, and for timed collection sessions.
"""

import uuid
import asyncio
from datetime import datetime
from fastapi import APIRouter, Query, HTTPException
from pydantic import BaseModel
from sensors.client import fetch_sensor, fetch_multiple
from config import SENSOR_REGISTRY, UNSDG_GOALS

router = APIRouter(prefix="/api/analysis", tags=["Data Analysis"])

# ─── In-memory collection sessions ───────────────────────────────
_sessions: dict[str, dict] = {}


class CollectRequest(BaseModel):
    sensors: list[str]
    duration_sec: int = 60
    interval_sec: float = 1.0


# ─── Endpoints ────────────────────────────────────────────────────

@router.get("/registry")
async def get_sensor_registry():
    """Return the full sensor registry so the frontend knows what's available."""
    return {
        "sensors": {
            key: {"name": info["name"], "unit": info["unit"]}
            for key, info in SENSOR_REGISTRY.items()
        }
    }


@router.get("/sensor/{name}")
async def get_single_sensor(name: str):
    """Fetch the current value of a single sensor."""
    if name not in SENSOR_REGISTRY:
        raise HTTPException(404, f"Unknown sensor: {name}")
    return await fetch_sensor(name)


@router.get("/sensors")
async def get_multiple_sensors(names: str = Query(..., description="Comma-separated sensor keys")):
    """Fetch current values for multiple sensors at once."""
    sensor_list = [s.strip() for s in names.split(",") if s.strip()]
    invalid = [s for s in sensor_list if s not in SENSOR_REGISTRY]
    if invalid:
        raise HTTPException(400, f"Unknown sensors: {invalid}")
    results = await fetch_multiple(sensor_list)
    return {"sensors": results}


@router.get("/unsdg")
async def get_all_unsdg_goals():
    """Return the list of UNSDG goals with their sensor mappings."""
    return {"goals": UNSDG_GOALS}


@router.get("/unsdg/{goal_key}")
async def get_unsdg_goal_data(goal_key: str):
    """Fetch live sensor data for all sensors in a specific UNSDG goal."""
    goal = UNSDG_GOALS.get(goal_key)
    if not goal:
        raise HTTPException(404, f"Unknown UNSDG goal: {goal_key}. Valid: {list(UNSDG_GOALS.keys())}")
    results = await fetch_multiple(goal["sensors"])
    return {
        "goal": goal,
        "sensor_data": results,
    }


@router.post("/collect")
async def start_collection(req: CollectRequest):
    """
    Start a timed data collection session.
    Collects sensor readings at the given interval for the given duration.
    Returns a session_id to retrieve results.
    """
    # Validate sensors
    invalid = [s for s in req.sensors if s not in SENSOR_REGISTRY]
    if invalid:
        raise HTTPException(400, f"Unknown sensors: {invalid}")

    session_id = str(uuid.uuid4())[:8]
    _sessions[session_id] = {
        "sensors": req.sensors,
        "duration_sec": req.duration_sec,
        "interval_sec": req.interval_sec,
        "status": "collecting",
        "started_at": datetime.utcnow().isoformat(),
        "data": [],  # list of {timestamp, values: {sensor: value}}
        "progress": 0.0,
    }

    # Launch background collection
    asyncio.create_task(_collect_data(session_id, req))
    return {"session_id": session_id, "status": "collecting"}


@router.get("/collected/{session_id}")
async def get_collected_data(session_id: str):
    """Retrieve collected data for a session."""
    session = _sessions.get(session_id)
    if not session:
        raise HTTPException(404, f"Session not found: {session_id}")
    return session


async def _collect_data(session_id: str, req: CollectRequest):
    """Background task that samples sensors at intervals."""
    session = _sessions[session_id]
    total_samples = int(req.duration_sec / req.interval_sec)

    for i in range(total_samples):
        if session["status"] == "cancelled":
            break
        results = await fetch_multiple(req.sensors)
        values = {}
        for r in results:
            key = r.get("sensor", "unknown")
            values[key] = r.get("value")
        session["data"].append({
            "timestamp": datetime.utcnow().isoformat(),
            "values": values,
        })
        session["progress"] = round((i + 1) / total_samples * 100, 1)
        await asyncio.sleep(req.interval_sec)

    if session["status"] != "cancelled":
        session["status"] = "complete"
