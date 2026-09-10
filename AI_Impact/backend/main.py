"""
AI Impact Kit — FastAPI Application Entry Point
Mounts all routers and serves the frontend as static files.
"""

import sys
from pathlib import Path

# Ensure the backend directory is on sys.path so imports work from any cwd
_backend_dir = str(Path(__file__).resolve().parent)
if _backend_dir not in sys.path:
    sys.path.insert(0, _backend_dir)

# pyrefly: ignore [missing-import]
from fastapi import FastAPI
# pyrefly: ignore [missing-import]
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pathlib import Path
import config

from analysis.router import router as analysis_router
from prediction.router import router as prediction_router
from genai.router import router as genai_router

# ─── App creation ─────────────────────────────────────────────────
app = FastAPI(
    title="AI Impact Kit",
    description="Data Analysis, Data Science & GenAI platform for IoT sensor data",
    version="1.0.0",
)
 
# ─── CORS (allow frontend on any origin during dev) ──────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Mount API routers ───────────────────────────────────────────
app.include_router(analysis_router)
app.include_router(prediction_router)
app.include_router(genai_router)

# ─── Settings endpoints ──────────────────────────────────────────
@app.get("/api/health")
async def health_check():
    return {
        "status": "ok",
        "sensor_ip": config.SENSOR_IP,
        "simulation_mode": config.SIMULATION_MODE,
    }


@app.get("/api/settings")
async def get_settings():
    return {
        "sensor_ip": config.SENSOR_IP,
        "simulation_mode": config.SIMULATION_MODE,
        "openai_model": config.OPENAI_MODEL,
        "openai_key_set": bool(config.OPENAI_API_KEY and config.OPENAI_API_KEY != "your-openai-api-key-here"),
    }


@app.put("/api/settings")
async def update_settings(sensor_ip: str | None = None, simulation_mode: bool | None = None):
    if sensor_ip is not None:
        config.SENSOR_IP = sensor_ip
    if simulation_mode is not None:
        config.SIMULATION_MODE = simulation_mode
    return await get_settings()


# ─── Serve frontend static files ─────────────────────────────────
frontend_dir = Path(__file__).resolve().parent.parent / "frontend"
app.mount("/css", StaticFiles(directory=str(frontend_dir / "css")), name="css")
app.mount("/js", StaticFiles(directory=str(frontend_dir / "js")), name="js")


@app.get("/")
async def serve_index():
    return FileResponse(str(frontend_dir / "index.html"))


# ─── Run with: uvicorn main:app --reload --port 8000 ─────────────
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
