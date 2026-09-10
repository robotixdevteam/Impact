# 📚 AI Impact Kit — Data Science Module: Lesson Content

> Two separate lesson units covering the **Prediction (Forecast)** mode and the **Live vs Predicted (Compare)** mode in the AI Impact Kit Data Science module.

---
---

# PART A: 🔮 Prediction Mode (Forecast)

## 1. What Is Prediction Mode?

**Prediction Mode** (internally called `forecast`) is a workflow where the system:
1. **Collects** live time-series data from an IoT sensor (real ESP32 hardware or simulated) for a user-defined duration.
2. **Trains** a machine learning / statistical model on the **entire** collected dataset.
3. **Forecasts** future values beyond the collection window — projecting what the sensor *will* read in the next 60 seconds.
4. **Visualizes** the historical data, the predicted trajectory, and a **95% Confidence Interval** band on a single interactive chart.

### Real-World Analogy
> Think of a weather station that records temperature every second for 5 minutes, then uses that pattern to predict the temperature for the *next* minute. Prediction Mode does exactly this — but for any sensor: gas, soil moisture, heart rate, vibration, etc.

### When to Use It
- Forecasting upcoming sensor values (e.g., will the temperature rise or drop?).
- Understanding trends — is soil moisture declining? Is gas concentration spiking?
- Comparing which ML model best fits a particular sensor's pattern.

---

## 2. How It Works — End-to-End Pipeline

```
┌──────────────────┐     ┌────────────────────────────┐     ┌──────────────────────────┐
│  IoT Sensor      │     │  Data Collector             │     │  Prediction Engine       │
│  (ESP32 / Sim)   │────▶│  (asyncio background task)  │────▶│  (ARIMA / SARIMA / LSTM) │
│                  │     │  Samples every 1 sec        │     │  Trains on ALL data      │
└──────────────────┘     └────────────────────────────┘     └───────────┬──────────────┘
                                                                        │
                                                                        ▼
                         ┌──────────────────────────────────────────────────────────────┐
                         │  Frontend Chart (Chart.js)                                   │
                         │  ┌──────────────────┐  ┌──────────────────────────────┐      │
                         │  │ Cyan Line = Live  │  │ Orange Line = Predicted     │      │
                         │  │ (Collected Data)  │  │ + Shaded 95% CI Band       │      │
                         │  └──────────────────┘  └──────────────────────────────┘      │
                         └──────────────────────────────────────────────────────────────┘
```

### Step-by-Step Flow

| Step | What Happens | Code Location |
|:-----|:-------------|:--------------|
| **1. User Configures** | Selects sensor, duration (e.g. 3 min), model (Auto/ARIMA/SARIMA/LSTM), and optionally custom hyperparameters | [prediction.js — `startPrediction()`](file:///d:/AI_Impact/frontend/js/prediction.js#L141-L220) |
| **2. API Call** | Frontend sends `POST /api/predict/start` with `mode: "forecast"` | [router.py — `start_prediction()`](file:///d:/AI_Impact/backend/prediction/router.py#L45-L85) |
| **3. Background Collection** | A `DataCollector` asyncio task begins sampling the sensor every `interval_sec` (default 1s) | [collector.py — `_run()`](file:///d:/AI_Impact/backend/prediction/collector.py#L41-L65) |
| **4. Live Polling** | Frontend polls `GET /api/predict/status/{session_id}` every 2 seconds to update the live chart | [prediction.js — `pollPredictionStatus()`](file:///d:/AI_Impact/frontend/js/prediction.js#L222-L311) |
| **5. Collection Complete** | When all samples are gathered, status becomes `complete` | [collector.py — line 59](file:///d:/AI_Impact/backend/prediction/collector.py#L58-L59) |
| **6. Model Training** | Backend auto-triggers model training on the full collected values | [router.py — Forecast logic](file:///d:/AI_Impact/backend/prediction/router.py#L152-L171) |
| **7. Forecast Generation** | Model generates 60 predicted data points (60 seconds into the future) with upper/lower confidence intervals | [models.py](file:///d:/AI_Impact/backend/prediction/models.py) |
| **8. Chart Overlay** | Frontend fetches `GET /api/predict/result/{session_id}` and overlays the prediction on the chart | [prediction.js — `overlayPrediction()`](file:///d:/AI_Impact/frontend/js/prediction.js#L452-L537) |

---

## 3. Models Used in Prediction Mode

### 🔹 ARIMA (AutoRegressive Integrated Moving Average)

| Aspect | Detail |
|:-------|:-------|
| **What** | Classical statistical model for **non-seasonal** time series |
| **Best For** | Smooth, trending signals (temperature, soil moisture) |
| **Parameters** | `p` (AR order), `d` (differencing), `q` (MA order) |
| **Auto-Tuning** | Grid search over p∈[0,3], d∈[0,1], q∈[0,3] — picks the combination with lowest **AIC** (Akaike Information Criterion) |
| **Fallback** | If fitting fails, uses a 10-point moving average |
| **Library** | `statsmodels.tsa.arima.model.ARIMA` |

**Code**: [models.py — `predict_arima()`](file:///d:/AI_Impact/backend/prediction/models.py#L14-L85)

### 🔹 SARIMA (Seasonal ARIMA)

| Aspect | Detail |
|:-------|:-------|
| **What** | ARIMA extended with seasonal decomposition — captures repeating cycles |
| **Best For** | Cyclical data: daily temperature swings, hourly humidity patterns |
| **Parameters** | `(p,d,q)` × `(P,D,Q,s)` where `s` = seasonal period |
| **Auto-Detection** | Seasonal period auto-computed as `min(12, len(data)//10)` |
| **Fallback** | Falls back to ARIMA if SARIMA fitting fails |
| **Library** | `statsmodels.tsa.statespace.SARIMAX` |

**Code**: [models.py — `predict_sarima()`](file:///d:/AI_Impact/backend/prediction/models.py#L88-L144)

### 🔹 LSTM (Long Short-Term Memory Neural Network)

| Aspect | Detail |
|:-------|:-------|
| **What** | A deep learning Recurrent Neural Network (RNN) for complex, non-linear sequences |
| **Best For** | Noisy, complex signals: heart rate, vibration, gas fluctuations |
| **Architecture** | `LSTM(32 units)` → `Dense(16, ReLU)` → `Dense(1)` |
| **Preprocessing** | `MinMaxScaler` normalizes data to [0,1] range |
| **Parameters** | `epochs` (30), `units` (32), `look_back` (10), `learning_rate` (0.001), `batch_size` (16) |
| **Fallback** | Falls back to ARIMA if LSTM produces NaN/Inf or encounters errors |
| **Library** | `tensorflow.keras` (Sequential model) |

**Code**: [models.py — `predict_lstm()`](file:///d:/AI_Impact/backend/prediction/models.py#L147-L243)

### 🔹 AUTO Mode (Best Model Selection)

| Aspect | Detail |
|:-------|:-------|
| **What** | Runs all applicable models and picks the one with the lowest **MAE** |
| **Logic** | Always tries ARIMA. Tries SARIMA if ≥24 data points. Tries LSTM if ≥30 data points. |
| **Selection Metric** | Mean Absolute Error (MAE) on a 20% validation holdout |
| **Custom Params** | Not supported in AUTO — each model uses its own best auto-tuned settings |

**Code**: [models.py — `auto_predict()`](file:///d:/AI_Impact/backend/prediction/models.py#L246-L274)

---

## 4. Evaluation Metrics

| Metric | Formula | What It Tells You |
|:-------|:--------|:------------------|
| **MAE** (Mean Absolute Error) | `(1/n) × Σ|actual − predicted|` | Average size of prediction error (in sensor units). Lower = better. |
| **RMSE** (Root Mean Squared Error) | `√((1/n) × Σ(actual − predicted)²)` | Similar to MAE but penalizes large errors more heavily. Lower = better. |

Both are computed on a **80/20 train/test split** of the collected data.

---

## 5. Confidence Intervals

- **ARIMA/SARIMA**: Uses the `conf_int(alpha=0.05)` method from statsmodels — a proper statistical 95% CI.
- **LSTM**: Approximated as `prediction ± 1.96 × 0.3 × std(predictions)` — a simplified band since neural networks don't natively produce confidence intervals.

The **shaded band** on the chart between the upper and lower CI lines represents the range within which the true value is expected to fall 95% of the time.

---

## 6. Hands-On Teaching Steps — Prediction Mode

### Step 1: Open the Data Science Tab
Navigate to the **Data Science** section in the AI Impact Kit UI.

### Step 2: Configure the Session
- **Sensor**: Choose a sensor (e.g., Temperature, Soil Moisture, Heart Rate)
- **Duration**: Set collection time (e.g., 2 minutes)
- **Model**: Select `AUTO`, `ARIMA`, `SARIMA`, or `LSTM`
- **Mode**: Ensure **Forecast** is selected (left toggle card)

### Step 3: (Optional) Custom Hyperparameters
Click **Custom** toggle to manually set model parameters:
- ARIMA: `p=2, d=1, q=1`
- LSTM: `epochs=50, units=64, look_back=15`

### Step 4: Start & Observe
1. Click **Start Prediction**
2. Watch the **cyan live data line** grow in real-time as the sensor streams data
3. A progress bar and timer show collection status

### Step 5: Examine the Forecast
Once collection completes:
1. The **orange predicted line** appears extending 60 seconds beyond the data
2. A **shaded amber band** shows the 95% confidence interval
3. A **Model Info Card** displays the chosen model name, MAE, and RMSE

### Step 6: AI Explanation (GenAI Integration)
Click **"Ask AI About This Prediction"** to get a natural-language explanation of the results from GPT-4o — connecting the prediction output back to the UN SDG context.

---

## 7. Discussion Questions — Prediction Mode

1. Why does ARIMA fail on highly cyclical data but SARIMA succeeds?
2. What happens to LSTM accuracy if you increase `look_back` too much with limited data?
3. Why is the confidence interval wider for points further into the future?
4. How would you use temperature predictions to help SDG 2 (Zero Hunger) in agriculture?

---
---

# PART B: 📊 Live vs Predicted Mode (Compare)

## 1. What Is Compare Mode?

**Compare Mode** (internally called `compare`) is a **real-time model evaluation** workflow where:
1. The system collects live sensor data for a target duration.
2. It uses the **first portion** (e.g., 50%) as **training data** to build a model.
3. It then **predicts** what the sensor values will be for the **remaining** portion.
4. As real data continues streaming in, the chart shows the **live actual values** vs the **model's predictions** side by side — in real-time.

### Real-World Analogy
> Imagine training a weather model on the morning's data, then watching through the afternoon whether your model's predictions match what actually happens. That's Compare Mode — you see divergence and accuracy unfold live.

### When to Use It
- Evaluating how well a model captures the sensor's behavior.
- Teaching model validation and overfitting concepts.
- Visualizing prediction drift — how quickly models lose accuracy.
- Comparing models (run compare with ARIMA, then again with LSTM).

---

## 2. How It Works — End-to-End Pipeline

```
 TRAINING PHASE                              COMPARISON PHASE
┌──────────────────────────┐               ┌──────────────────────────────────────┐
│  Collect 50% of data     │               │  Continue collecting remaining 50%   │
│  (e.g., first 90 sec)    │               │  Real values stream in live          │
│          │                │               │          │                           │
│          ▼                │               │          ▼                           │
│  Train model on this     │               │  Chart shows BOTH lines:             │
│  portion (ARIMA/SARIMA/  │──────────────▶│    • Cyan = Actual live sensor       │
│  LSTM)                   │               │    • Orange (dashed) = Predicted     │
│          │                │               │                                      │
│          ▼                │               │  Student watches divergence/         │
│  Generate predictions    │               │  convergence in real-time            │
│  for remaining 50%       │               │                                      │
└──────────────────────────┘               └──────────────────────────────────────┘
```

### Step-by-Step Flow

| Step | What Happens | Code Location |
|:-----|:-------------|:--------------|
| **1. User Configures** | Selects sensor, duration, model, and **Compare** mode. Sets **Training Split** slider (default 50%) | [prediction.js — `setPredMode('compare')`](file:///d:/AI_Impact/frontend/js/prediction.js#L31-L44) |
| **2. API Call** | Frontend sends `POST /api/predict/start` with `mode: "compare"` and `compare_train_pct: 0.5` | [router.py — `start_prediction()`](file:///d:/AI_Impact/backend/prediction/router.py#L45-L85) |
| **3. Training Phase** | Collection begins. Phase badge shows **"Training Phase"**. Both lines track the live data. | [prediction.js — line 188-189](file:///d:/AI_Impact/frontend/js/prediction.js#L186-L192) |
| **4. Model Triggers** | Once `collected_count ≥ train_samples`, backend trains the model on just the training portion and generates predictions for the remaining samples | [router.py — Compare mode training](file:///d:/AI_Impact/backend/prediction/router.py#L102-L128) |
| **5. Comparing Phase** | Phase badge switches to **"Comparing Live vs Predicted"**. The predicted (orange dashed) line now diverges from the actual (cyan) line | [prediction.js — phase badge](file:///d:/AI_Impact/frontend/js/prediction.js#L239-L245) |
| **6. Real-Time Update** | Every 2s poll, frontend updates both lines: actual sensor values continue streaming, predicted values are aligned to the same time indices | [prediction.js — `updateCompareChartData()`](file:///d:/AI_Impact/frontend/js/prediction.js#L635-L699) |
| **7. Completion** | When all samples are collected, the final MAE/RMSE metrics are shown with the full comparison | [router.py — Compare completion](file:///d:/AI_Impact/backend/prediction/router.py#L174-L190) |

---

## 3. Key Concepts Taught in Compare Mode

### 🎯 Training / Test Split
The **Training Split slider** (default 50%) controls what fraction of data is used for training vs. evaluation. This teaches the fundamental ML concept of **train/test splits**:

| Split Setting | Training Data | Test/Comparison Data | Teaching Point |
|:-------------|:-------------|:---------------------|:---------------|
| **30%** | First 30% of samples | Last 70% of samples | Less training data → less accurate model, but more comparison time |
| **50%** (default) | First 50% of samples | Last 50% of samples | Balanced split — standard in ML |
| **70%** | First 70% of samples | Last 30% of samples | More training data → potentially more accurate, less comparison time |

**Code**: The `compare_train_pct` parameter flows from the frontend slider through to `train_samples = total_samples × compare_train_pct`.
See [router.py line 62](file:///d:/AI_Impact/backend/prediction/router.py#L62).

### 📈 Model Drift / Divergence
As time progresses in the comparison phase, the gap between the actual and predicted lines often **widens**. This visually demonstrates:
- **Short-term accuracy** vs **long-term drift**
- Why models need **retraining** on fresh data
- How noise and randomness compound over time

### 🔄 The Two Chart Lines
| Line | Color | Style | What It Shows |
|:-----|:------|:------|:-------------|
| **Live Data** | Cyan (`#22d3ee`) | Solid | Actual sensor values streaming in real-time |
| **Predicted** | Amber (`#f59e0b`) | Dashed | Model's prediction for each time step |

During the **Training Phase**, the predicted line mirrors the live data (using a naive lag-1 forecast as a placeholder). Once the model is trained, the predicted line switches to the model's actual forecasted values.

---

## 4. Compare Data Structure (Backend → Frontend)

When the model is trained mid-collection, the backend builds a `compare_data` object sent with each status poll:

```json
{
  "compare_data": {
    "train_data": [{"timestamp": "...", "value": 24.5}, ...],
    "live_values": [25.1, 25.3, 24.9, ...],
    "predicted_values": [25.0, 25.2, 25.4, ...],
    "all_predictions": [25.0, 25.2, 25.4, 25.6, ...],
    "model_name": "ARIMA(1,1,0)",
    "metrics": {"mae": 0.312, "rmse": 0.445}
  }
}
```

**Code**: [router.py — compare_data construction](file:///d:/AI_Impact/backend/prediction/router.py#L130-L148)

---

## 5. Models Used (Same as Prediction Mode)

Compare Mode uses the **exact same model implementations** — ARIMA, SARIMA, LSTM, and AUTO. The only difference is:

| Prediction Mode | Compare Mode |
|:----------------|:-------------|
| Trains on **100%** of collected data | Trains on only the **first N%** (training split) |
| Forecasts into the **future** (beyond the data) | Forecasts the **remaining** portion (which real data will verify) |
| Evaluation is on a synthetic 80/20 holdout | Evaluation is **live** — you watch accuracy unfold in real-time |

---

## 6. Hands-On Teaching Steps — Compare Mode

### Step 1: Open the Data Science Tab
Navigate to the **Data Science** section.

### Step 2: Configure the Session
- **Sensor**: Choose (e.g., Humidity)
- **Duration**: 3 minutes
- **Model**: Start with `ARIMA`
- **Mode**: Select **Compare (Live vs Predicted)** (right toggle card)

### Step 3: Set the Training Split
- Use the **Training Split slider** to set 50% (default).
- Explain: "The model will learn from the first 90 seconds, then predict the next 90 seconds."

### Step 4: Start & Observe Phase 1 — Training
1. Click **Start Prediction**
2. The phase badge shows **"Training Phase"** (pulsing dot)
3. Both cyan and amber lines track together (naive predictions during training)
4. Progress bar fills toward the 50% mark

### Step 5: Observe Phase 2 — Comparing
1. At the 50% mark, the badge switches to **"Comparing Live vs Predicted"**
2. The amber dashed line now shows the **model's independent predictions**
3. The cyan line continues showing **real sensor values**
4. Students watch: Do the lines stay close or diverge?

### Step 6: Examine Final Results
Once complete:
1. The **Model Info Card** shows MAE and RMSE — a direct measure of how close the prediction was to reality
2. Click **"Ask AI About This Prediction"** for a GenAI explanation

### Step 7: Repeat with Different Models
- Rerun with `LSTM` or `SARIMA` and compare which model's amber line stays closer to the cyan line
- Discuss: "Which model had lower MAE? Why might that be?"

---

## 7. Discussion Questions — Compare Mode

1. What happened when you changed the training split from 50% to 30%? Did the model get worse?
2. At what point in the comparison did the predicted line start drifting away from actual values? Why?
3. Which model (ARIMA vs LSTM) stayed closer to reality for your sensor? What makes that sensor's data suited for that model?
4. How could a farmer use Compare Mode to validate a soil moisture predictor before trusting it to automate irrigation?
5. In the context of SDG 3 (Good Health), how would you use Compare Mode to validate a heart rate prediction model before using it for patient monitoring?

---
---

# Summary Comparison Table

| Feature | 🔮 Prediction (Forecast) Mode | 📊 Live vs Predicted (Compare) Mode |
|:--------|:-------------------------------|:-------------------------------------|
| **Purpose** | Forecast future unknown values | Validate model accuracy in real-time |
| **Training Data** | 100% of collected data | First N% (configurable split) |
| **Prediction Target** | 60 seconds beyond the data | Remaining (100-N)% of the data |
| **Confidence Intervals** | ✅ Yes (95% CI band) | ❌ No (direct line comparison instead) |
| **Chart Output** | Actual + Forecast + CI band | Actual vs Predicted (two overlapping lines) |
| **Phase Badges** | None | "Training Phase" → "Comparing Live vs Predicted" |
| **Key Teaching Concept** | Forecasting, trend extrapolation | Model validation, train/test split, drift |
| **Backend Trigger** | Model runs after collection completes | Model runs mid-collection at the split point |
| **AI Explanation** | ✅ Available | ✅ Available |

---

## 📁 Full Code Reference

| Component | File | Purpose |
|:----------|:-----|:--------|
| API Entry Point | [main.py](file:///d:/AI_Impact/backend/main.py) | Mounts prediction router at `/api/predict` |
| Prediction API Router | [router.py](file:///d:/AI_Impact/backend/prediction/router.py) | Session management, polling, mode logic |
| ML Models | [models.py](file:///d:/AI_Impact/backend/prediction/models.py) | ARIMA, SARIMA, LSTM, AUTO implementations |
| Data Collector | [collector.py](file:///d:/AI_Impact/backend/prediction/collector.py) | Async background sensor sampling |
| Sensor Client | [client.py](file:///d:/AI_Impact/backend/sensors/client.py) | HTTP fetch from ESP32 or simulator fallback |
| Sensor Simulator | [simulator.py](file:///d:/AI_Impact/backend/sensors/simulator.py) | Realistic fake data generator for testing |
| Frontend Controller | [prediction.js](file:///d:/AI_Impact/frontend/js/prediction.js) | UI logic, chart rendering, polling, overlays |
| Configuration | [config.py](file:///d:/AI_Impact/backend/config.py) | Sensor registry, API keys, simulation toggle |

---

## 🧰 Libraries & Dependencies

| Library | Version Constraint | Used For |
|:--------|:-------------------|:---------|
| `fastapi` | Latest | REST API server with async support |
| `uvicorn` | Latest | ASGI server to run FastAPI |
| `statsmodels` | ≥0.14 | ARIMA & SARIMAX model fitting |
| `scikit-learn` | ≥1.3 | MinMaxScaler, MAE, RMSE metrics |
| `tensorflow` | ≥2.15 | Keras Sequential LSTM model |
| `numpy` | ≥1.24 | Array operations |
| `httpx` | ≥0.25 | Async HTTP client for sensor endpoints |
| `pydantic` | ≥2.0 | Request validation (FastAPI models) |
| `Chart.js` | CDN (v4) | Frontend interactive charting |
