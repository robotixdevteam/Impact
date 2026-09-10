"""
AI Impact Kit — GenAI Chat API Router
Includes text chat, Speech-to-Text (STT) via Whisper, and Text-to-Speech (TTS) endpoints.
"""

import tempfile
import os
import json
from fastapi import APIRouter, HTTPException, File, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from genai.agent import chat, get_history, clear_history, get_client, contains_inappropriate_content
from config import SENSOR_REGISTRY

router = APIRouter(prefix="/api/chat", tags=["GenAI"])


class ChatRequest(BaseModel):
    message: str
    session_id: str = "default"


class TTSRequest(BaseModel):
    text: str
    voice: str = "alloy"  # alloy, echo, fable, onyx, nova, shimmer


@router.post("")
async def send_chat_message(req: ChatRequest):
    """Send a message to the AI assistant and get a response."""
    if not req.message.strip():
        raise HTTPException(400, "Message cannot be empty")

    result = await chat(req.session_id, req.message)
    return result


@router.post("/stt")
async def speech_to_text(file: UploadFile = File(...)):
    """Transcribe user voice input using OpenAI Whisper."""
    client = get_client()

    # Save incoming audio stream to a temporary file
    suffix = os.path.splitext(file.filename)[1] or ".webm"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = tmp.name

    try:
        with open(tmp_path, "rb") as audio_file:
            transcription = await client.audio.transcriptions.create(
                model="whisper-1",
                file=audio_file,
            )
        return {"text": transcription.text}
    except Exception as e:
        raise HTTPException(500, f"STT failed: {str(e)}")
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)


@router.post("/tts")
async def text_to_speech(req: TTSRequest):
    """Synthesize assistant response text to speech using OpenAI TTS."""
    client = get_client()

    if not req.text.strip():
        raise HTTPException(400, "Text cannot be empty")

    try:
        # Generate speech response
        response = await client.audio.speech.create(
            model="tts-1",
            voice=req.voice,
            input=req.text,
        )

        # Generator to stream raw bytes back
        async def audio_generator():
            # response.iter_bytes() is synchronous or asynchronous depending on implementation.
            # In openai >= 1.0.0, response.iter_bytes() is synchronous on Httpx response,
            # but we can loop over it safely or read it.
            for chunk in response.iter_bytes(chunk_size=4096):
                yield chunk

        return StreamingResponse(audio_generator(), media_type="audio/mpeg")
    except Exception as e:
        raise HTTPException(500, f"TTS failed: {str(e)}")


@router.get("/history/{session_id}")
async def get_chat_history(session_id: str):
    """Get the conversation history for a session."""
    history = get_history(session_id)
    # Filter to only user/assistant messages (not system)
    filtered = [
        msg for msg in history
        if msg["role"] in ("user", "assistant")
    ]
    return {"session_id": session_id, "messages": filtered}


@router.delete("/history/{session_id}")
async def delete_chat_history(session_id: str):
    """Clear the conversation history for a session."""
    clear_history(session_id)
    return {"status": "cleared", "session_id": session_id}


# ─── GenAI Insight Endpoints ─────────────────────────────────────

class SensorReading(BaseModel):
    name: str
    value: float
    unit: str = ""
    min_value: float | None = None
    max_value: float | None = None
    avg_value: float | None = None
    trend: str | None = None


class AnalyzeChartRequest(BaseModel):
    sensors: list[SensorReading]
    chart_type: str = "bar"
    goal_name: str | None = None


class TextToChartRequest(BaseModel):
    prompt: str


class ModelAdviceRequest(BaseModel):
    sensor: str


class ExplainPredictionRequest(BaseModel):
    model_name: str
    sensor: str
    mode: str = "forecast"
    mae: float = 0.0
    rmse: float = 0.0
    predictions_count: int = 0


class RecommendChartRequest(BaseModel):
    sensors: list[str]
    count: int = 0


@router.post("/analyze")
async def analyze_chart_data(req: AnalyzeChartRequest):
    """Use GenAI to summarize and explain sensor chart data in plain language."""
    refusal = "I'm sorry, but I can't assist with that request. I can only help you with topics related to sensors, science, environmental monitoring, health, and the UN Sustainable Development Goals."

    # ─── Safety Guardrails Check ──────────────────────────────────────
    if req.goal_name and contains_inappropriate_content(req.goal_name):
        return {"insight": refusal}
    if req.chart_type and contains_inappropriate_content(req.chart_type):
        return {"insight": refusal}
    for s in req.sensors:
        if contains_inappropriate_content(s.name) or contains_inappropriate_content(s.unit):
            return {"insight": refusal}

    client = get_client()
    from config import OPENAI_MODEL

    sensor_lines = []
    for s in req.sensors:
        line = f"  - {s.name}: Current={s.value} {s.unit}"
        if s.min_value is not None:
            line += f", Min={s.min_value}, Max={s.max_value}, Avg={round(s.avg_value, 2)}, Trend={s.trend}"
        sensor_lines.append(line)
    sensor_lines_str = "\n".join(sensor_lines)

    goal_context = f"\nThese sensors are grouped under the UNSDG goal: \"{req.goal_name}\"." if req.goal_name else ""

    prompt = f"""You are the AI Impact Kit data analyst assistant. The user has generated a {req.chart_type} chart with the following sensor telemetry from an ESP32 IoT device:

{sensor_lines_str}
{goal_context}

Provide a concise, highly insightful analysis (3-5 sentences) that:
1. Highlights the most notable readings, min/max values, or trends.
2. Identifies any cross-sensor correlations (e.g., if one sensor rises as another falls, or if trends match).
3. Suggests a scientific root-cause explanation for the observed telemetry over time.
4. Relates the telemetry to the UNSDG goal if provided.
5. Provides one clear, actionable scientific recommendation.

Keep it friendly, informative, avoid deep technical jargon, and speak directly to students/children.

SAFETY RULE: This assistant is strictly for children and students. If any sensor name, chart type, or UNSDG goal name contains inappropriate, sexual, adult, violent, or illegal content, you MUST refuse to answer and respond EXACTLY with: "{refusal}" """

    try:
        response = await client.chat.completions.create(
            model=OPENAI_MODEL,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=400,
        )
        insight = response.choices[0].message.content or ""
        return {"insight": insight}
    except Exception as e:
        raise HTTPException(500, f"AI analysis failed: {str(e)}")


@router.post("/explain-prediction")
async def explain_prediction(req: ExplainPredictionRequest):
    """Use GenAI to explain prediction model results in plain language."""
    refusal = "I'm sorry, but I can't assist with that request. I can only help you with topics related to sensors, science, environmental monitoring, health, and the UN Sustainable Development Goals."

    # ─── Safety Guardrails Check ──────────────────────────────────────
    if contains_inappropriate_content(req.sensor) or contains_inappropriate_content(req.model_name) or contains_inappropriate_content(req.mode):
        return {"insight": refusal}

    client = get_client()
    from config import OPENAI_MODEL

    mode_desc = "forecasting future values" if req.mode == "forecast" else "comparing predicted vs actual live values"

    prompt = f"""You are the AI Impact Kit data science assistant. The user ran a prediction on the "{req.sensor}" sensor using the {req.model_name} model in {req.mode} mode ({mode_desc}).

Results:
  - Model: {req.model_name}
  - MAE (Mean Absolute Error): {req.mae}
  - RMSE (Root Mean Squared Error): {req.rmse}
  - Prediction points generated: {req.predictions_count}

Provide a concise explanation (3-5 sentences) that:
1. Explains what the model name means in simple terms (e.g., what ARIMA, SARIMA, or LSTM does)
2. Interprets the MAE and RMSE — are they good or bad? What do they mean for accuracy?
3. Explains whether this model is a good fit for this type of sensor data
4. Suggests whether the user should try a different model or adjust settings

Keep it friendly, non-technical, and actionable.

SAFETY RULE: This assistant is strictly for children and students. If any sensor name, model name, or mode contains inappropriate, sexual, adult, violent, or illegal content, you MUST refuse to answer and respond EXACTLY with: "{refusal}" """

    try:
        response = await client.chat.completions.create(
            model=OPENAI_MODEL,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=400,
        )
        insight = response.choices[0].message.content or ""
        return {"insight": insight}
    except Exception as e:
        raise HTTPException(500, f"AI prediction explanation failed: {str(e)}")


@router.post("/recommend-chart")
async def recommend_chart_type(req: RecommendChartRequest):
    """Use GenAI to recommend the best chart type for the selected sensors."""
    refusal = "I'm sorry, but I can't assist with that request. I can only help you with topics related to sensors, science, environmental monitoring, health, and the UN Sustainable Development Goals."

    # ─── Safety Guardrails Check ──────────────────────────────────────
    for sensor in req.sensors:
        if contains_inappropriate_content(sensor):
            return {"recommendation": refusal}

    client = get_client()
    from config import OPENAI_MODEL

    sensor_list = ", ".join(req.sensors) if req.sensors else "no sensors selected"

    prompt = f"""You are the AI Impact Kit data visualization assistant. The user has selected {req.count} sensor(s): {sensor_list}.

Available chart types: Bar Chart, Pie Chart, Doughnut Chart, Line Chart, Radar Chart, Polar Area Chart.

Recommend the single best chart type for these sensors and explain why in 2-3 sentences. Consider:
- Number of sensors selected
- Whether they share the same unit or have different units
- What kind of comparison or pattern would be most useful

Respond in this exact format:
RECOMMENDED: [chart type name]
[Your 2-3 sentence explanation]

SAFETY RULE: This assistant is strictly for children and students. If any sensor name contains inappropriate, sexual, adult, violent, or illegal content, you MUST refuse to recommend and respond EXACTLY with:
RECOMMENDED: None
{refusal}"""

    try:
        response = await client.chat.completions.create(
            model=OPENAI_MODEL,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=200,
        )
        recommendation = response.choices[0].message.content or ""
        return {"recommendation": recommendation}
    except Exception as e:
        raise HTTPException(500, f"AI chart recommendation failed: {str(e)}")


@router.post("/text-to-chart")
async def text_to_chart(req: TextToChartRequest):
    """Use GenAI to translate a natural language query into chart configuration parameters."""
    refusal = "I'm sorry, but I can't assist with that request. I can only help you with topics related to sensors, science, environmental monitoring, health, and the UN Sustainable Development Goals."

    # Safety check
    if contains_inappropriate_content(req.prompt):
        return {"error": refusal}

    client = get_client()
    from config import OPENAI_MODEL

    system_instruction = f"""You are the AI Impact Kit Assistant. The user wants to generate a chart.
Parse their request and return a JSON object with:
- "sensors": list of matching sensor keys. Choose from: {list(SENSOR_REGISTRY.keys())}
- "chart_type": one of ["bar", "pie", "doughnut", "line", "radar", "polarArea"] (Default to "line" if time-series or duration is requested, otherwise "bar")
- "duration_sec": number of seconds for data collection. Default to 0 (snapshot) if no duration is implied. If a duration is implied, choose one of: 0 (snapshot), 30, 60 (1 min), 120 (2 min), 300 (5 min).

Respond ONLY with valid JSON. Do not include markdown code block formatting. If the request is inappropriate, offensive, or off-topic, set "error" key to the refusal message.

Example response:
{{"sensors": ["humidity", "soil"], "chart_type": "line", "duration_sec": 60}}"""

    try:
        response = await client.chat.completions.create(
            model=OPENAI_MODEL,
            messages=[
                {"role": "system", "content": system_instruction},
                {"role": "user", "content": req.prompt}
            ],
            max_tokens=150,
            temperature=0.1,
        )
        content = (response.choices[0].message.content or "").strip()
        
        # Strip code blocks if LLM still outputs them
        if content.startswith("```"):
            lines = content.splitlines()
            if lines[0].startswith("```"):
                lines = lines[1:]
            if lines and lines[-1].startswith("```"):
                lines = lines[:-1]
            content = "\n".join(lines).strip()
            
        data = json.loads(content)
        if "error" in data:
            return {"error": data["error"]}
        return data
    except Exception as e:
        raise HTTPException(500, f"Text-to-chart failed: {str(e)}")


@router.post("/model-advice")
async def model_advice(req: ModelAdviceRequest):
    """Use GenAI to advise which model (ARIMA, SARIMA, LSTM) is best suited for a sensor and why."""
    refusal = "I'm sorry, but I can't assist with that request. I can only help you with topics related to sensors, science, environmental monitoring, health, and the UN Sustainable Development Goals."

    # Safety check
    if contains_inappropriate_content(req.sensor):
        return {"advice": refusal}

    sensor_info = SENSOR_REGISTRY.get(req.sensor)
    if not sensor_info:
        raise HTTPException(400, f"Unknown sensor: {req.sensor}")

    client = get_client()
    from config import OPENAI_MODEL

    prompt = f"""You are the AI Impact Kit Data Science Advisor. A student is preparing to run a machine learning prediction model on the "{sensor_info['name']}" sensor (measured in {sensor_info['unit']}).

Explain to the student in friendly, simple, child-appropriate language (3-4 sentences):
1. Which prediction model out of ARIMA (for simple trend tracking), SARIMA (for repeating seasonal cycles), or LSTM (for complex, non-linear sequences) is the absolute best fit for this specific sensor type, and why.
2. Suggest what parameters they should consider (e.g. training duration or lag factors) to get the most accurate results.

SAFETY RULE: Keep it safe and educational. Do not reference inappropriate, adult, or violent themes. If the request violates safety rules, respond exactly with: "{refusal}" """

    try:
        response = await client.chat.completions.create(
            model=OPENAI_MODEL,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=300,
        )
        advice = response.choices[0].message.content or ""
        return {"advice": advice}
    except Exception as e:
        raise HTTPException(500, f"Model advice failed: {str(e)}")
