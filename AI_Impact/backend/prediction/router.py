"""
AI Impact Kit — Data Science / Prediction API Router
Manages prediction sessions: start collection → train model → return results.
Supports two modes:
  - "forecast": collect data, train, predict future (existing)
  - "compare": collect initial data, train, then compare live vs predicted in real-time
"""

import uuid
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from config import SENSOR_REGISTRY
from prediction.collector import DataCollector
from prediction.models import predict_arima, predict_sarima, predict_lstm, auto_predict

router = APIRouter(prefix="/api/predict", tags=["Data Science"])

# ─── Active sessions ─────────────────────────────────────────────
_sessions: dict[str, dict] = {}


class PredictRequest(BaseModel):
    sensor: str
    duration_min: float = 5.0
    interval_sec: float = 1.0
    model: str = "auto"  # auto | arima | sarima | lstm
    forecast_steps: int = 30
    mode: str = "forecast"  # "forecast" or "compare"
    params: dict | None = None  # Custom model hyperparameters
    compare_train_pct: float = 0.5  # Fraction of data used for training in compare mode


def _run_model(model_choice: str, values: list[float], steps: int, params: dict | None = None) -> dict:
    """Run the selected model with optional custom params."""
    if model_choice == "arima":
        return predict_arima(values, steps, params)
    elif model_choice == "sarima":
        return predict_sarima(values, steps, params)
    elif model_choice == "lstm":
        return predict_lstm(values, steps, params)
    else:
        return auto_predict(values, steps, params)


@router.post("/start")
async def start_prediction(req: PredictRequest):
    """Start a live data collection session for prediction."""
    if req.sensor not in SENSOR_REGISTRY:
        raise HTTPException(400, f"Unknown sensor: {req.sensor}. Valid: {list(SENSOR_REGISTRY.keys())}")

    session_id = str(uuid.uuid4())[:8]
    duration_sec = int(req.duration_min * 60)

    collector = DataCollector(
        sensor_name=req.sensor,
        duration_sec=duration_sec,
        interval_sec=req.interval_sec,
    )
    collector.start()

    # Calculate the training sample count for compare mode
    train_samples = int(collector.total_samples * req.compare_train_pct) if req.mode == "compare" else 0

    _sessions[session_id] = {
        "collector": collector,
        "model_choice": req.model,
        "forecast_steps": req.forecast_steps,
        "mode": req.mode,
        "params": req.params,
        "compare_train_pct": req.compare_train_pct,
        "train_samples": train_samples,
        "prediction": None,
        "compare_prediction": None,  # Prediction generated mid-collection for compare mode
        "compare_phase": "training" if req.mode == "compare" else None,
    }

    return {
        "session_id": session_id,
        "status": "collecting",
        "sensor": req.sensor,
        "mode": req.mode,
        "duration_sec": duration_sec,
        "total_samples": collector.total_samples,
        "train_samples": train_samples,
    }


@router.get("/status/{session_id}")
async def get_prediction_status(session_id: str):
    """Check collection progress and get partial data for live chart."""
    session = _sessions.get(session_id)
    if not session:
        raise HTTPException(404, f"Session not found: {session_id}")

    collector: DataCollector = session["collector"]
    mode = session["mode"]

    response = collector.to_dict()
    response["mode"] = mode

    # ─── Compare Mode Logic ──────────────────────────────────────
    if mode == "compare":
        train_samples = session["train_samples"]
        collected_count = len(collector.data)
        response["train_samples"] = train_samples
        response["compare_phase"] = session["compare_phase"]

        # Once we have enough training data, train the model and predict the rest
        if collected_count >= train_samples and session["compare_prediction"] is None:
            train_values = collector.get_values()[:train_samples]
            remaining_steps = collector.total_samples - train_samples

            if len(train_values) >= 5 and remaining_steps > 0:
                try:
                    pred = _run_model(
                        session["model_choice"],
                        train_values,
                        remaining_steps,
                        session["params"],
                    )
                    session["compare_prediction"] = pred
                    session["compare_phase"] = "comparing"
                except Exception as e:
                    session["compare_prediction"] = {"error": str(e)}
                    session["compare_phase"] = "error"
            else:
                session["compare_prediction"] = {"error": "Not enough training data"}
                session["compare_phase"] = "error"

        # Build compare_data for frontend
        if session["compare_prediction"] and "error" not in session["compare_prediction"]:
            pred = session["compare_prediction"]
            # Live data after training phase
            live_data = collector.data[train_samples:]
            live_values = [d["value"] for d in live_data]

            # Predicted values (aligned to same indices)
            predicted_values = pred["predictions"][:len(live_values)] if live_values else []

            response["compare_data"] = {
                "train_data": collector.data[:train_samples],
                "live_values": live_values,
                "predicted_values": predicted_values,
                "all_predictions": pred["predictions"],
                "model_name": pred["model_name"],
                "metrics": pred["metrics"],
            }

        response["compare_phase"] = session["compare_phase"]

    # ─── Forecast Mode Logic (existing) ──────────────────────────
    if mode == "forecast":
        # If collection is complete and prediction hasn't been generated yet, run it
        if collector.status == "complete" and session["prediction"] is None:
            values = collector.get_values()
            if len(values) >= 5:
                try:
                    pred = _run_model(
                        session["model_choice"],
                        values,
                        session["forecast_steps"],
                        session["params"],
                    )
                    session["prediction"] = pred
                except Exception as e:
                    session["prediction"] = {"error": str(e)}
            else:
                session["prediction"] = {"error": "Not enough data points for prediction"}

        if session["prediction"]:
            response["prediction"] = session["prediction"]

    # ─── Handle completion for compare mode ──────────────────────
    if mode == "compare" and collector.status == "complete":
        if session["compare_prediction"] and "error" not in session["compare_prediction"]:
            pred = session["compare_prediction"]
            live_data = collector.data[train_samples:]
            live_values = [d["value"] for d in live_data]
            predicted_values = pred["predictions"][:len(live_values)]

            response["compare_data"] = {
                "train_data": collector.data[:session["train_samples"]],
                "live_values": live_values,
                "predicted_values": predicted_values,
                "all_predictions": pred["predictions"],
                "model_name": pred["model_name"],
                "metrics": pred["metrics"],
            }

    return response


@router.get("/result/{session_id}")
async def get_prediction_result(session_id: str):
    """Get the final collected data + prediction result."""
    session = _sessions.get(session_id)
    if not session:
        raise HTTPException(404, f"Session not found: {session_id}")

    collector: DataCollector = session["collector"]
    mode = session["mode"]

    if collector.status != "complete":
        return {
            "status": collector.status,
            "progress": collector.progress,
            "message": "Collection still in progress. Poll /status for live updates.",
        }

    # ─── Compare Mode Result ─────────────────────────────────────
    if mode == "compare":
        pred = session["compare_prediction"]
        train_samples = session["train_samples"]
        live_data = collector.data[train_samples:]
        live_values = [d["value"] for d in live_data]

        result = {
            "status": "complete",
            "mode": "compare",
            "sensor": collector.sensor_name,
            "train_data": collector.data[:train_samples],
            "live_data": live_data,
        }

        if pred and "error" not in pred:
            predicted_values = pred["predictions"][:len(live_values)]
            result["prediction"] = pred
            result["compare_data"] = {
                "live_values": live_values,
                "predicted_values": predicted_values,
                "all_predictions": pred["predictions"],
            }
        else:
            result["prediction"] = pred or {"error": "No prediction generated"}

        return result

    # ─── Forecast Mode Result (existing) ─────────────────────────
    # Generate prediction if not done yet
    if session["prediction"] is None:
        values = collector.get_values()
        if len(values) >= 5:
            try:
                print(f"[DEBUG] Running model {session['model_choice']} with forecast_steps={session['forecast_steps']}")
                pred = _run_model(
                    session["model_choice"],
                    values,
                    session["forecast_steps"],
                    session["params"],
                )
                print(f"[DEBUG] Model returned predictions of length {len(pred.get('predictions', []))}")
                session["prediction"] = pred
            except Exception as e:
                print(f"[DEBUG] Model error: {e}")
                session["prediction"] = {"error": str(e)}
        else:
            session["prediction"] = {"error": "Not enough data points"}

    return {
        "status": "complete",
        "mode": "forecast",
        "sensor": collector.sensor_name,
        "collected_data": collector.data,
        "prediction": session["prediction"],
    }


@router.delete("/cancel/{session_id}")
async def cancel_prediction(session_id: str):
    """Cancel an active collection session."""
    session = _sessions.get(session_id)
    if not session:
        raise HTTPException(404, f"Session not found: {session_id}")

    collector: DataCollector = session["collector"]
    collector.cancel()
    return {"status": "cancelled", "session_id": session_id}
