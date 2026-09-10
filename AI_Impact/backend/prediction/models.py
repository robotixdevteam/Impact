"""
AI Impact Kit — Prediction Models
Implements ARIMA, SARIMA, and LSTM models for time-series forecasting.
Each function takes a list of float values and returns predictions with confidence intervals.
Supports optional custom hyperparameters via the `params` dict.
"""

import numpy as np
import warnings

warnings.filterwarnings("ignore")


def predict_arima(values: list[float], forecast_steps: int = 30, params: dict | None = None) -> dict:
    """
    Fit an ARIMA model and forecast.
    Custom params: {"p": int, "d": int, "q": int}
    If params provided, skips grid search and uses specified order directly.
    Returns: {model_name, predictions, lower_ci, upper_ci, metrics}
    """
    from statsmodels.tsa.arima.model import ARIMA
    from sklearn.metrics import mean_absolute_error, mean_squared_error

    y = np.array(values, dtype=float)
    params = params or {}

    # Use last 20% as validation for metrics
    split = max(int(len(y) * 0.8), 2)
    train, test = y[:split], y[split:]

    # Determine order: custom or grid search
    if "p" in params and "d" in params and "q" in params:
        best_order = (int(params["p"]), int(params["d"]), int(params["q"]))
    else:
        best_aic = float("inf")
        best_order = (1, 1, 0)

        # Simple grid search for best (p,d,q)
        for p in range(0, 4):
            for d in range(0, 2):
                for q in range(0, 4):
                    try:
                        model = ARIMA(train, order=(p, d, q))
                        fitted = model.fit()
                        if fitted.aic < best_aic:
                            best_aic = fitted.aic
                            best_order = (p, d, q)
                    except Exception:
                        continue

    # Refit on full data with best order
    try:
        model = ARIMA(y, order=best_order)
        fitted = model.fit()
        forecast_result = fitted.get_forecast(steps=forecast_steps)
        predictions = forecast_result.predicted_mean.tolist()
        ci = forecast_result.conf_int(alpha=0.05)
        lower = ci.iloc[:, 0].tolist()
        upper = ci.iloc[:, 1].tolist()
    except Exception:
        # Fallback: simple moving average
        ma = float(np.mean(y[-10:]))
        predictions = [ma] * forecast_steps
        lower = [ma * 0.9] * forecast_steps
        upper = [ma * 1.1] * forecast_steps
        best_order = (0, 0, 0)

    # Metrics on validation set
    try:
        val_model = ARIMA(train, order=best_order)
        val_fitted = val_model.fit()
        val_pred = val_fitted.forecast(steps=len(test))
        mae = float(mean_absolute_error(test, val_pred))
        rmse = float(np.sqrt(mean_squared_error(test, val_pred)))
    except Exception:
        mae = 0.0
        rmse = 0.0

    return {
        "model_name": f"ARIMA{best_order}",
        "predictions": [round(v, 2) for v in predictions],
        "lower_ci": [round(v, 2) for v in lower],
        "upper_ci": [round(v, 2) for v in upper],
        "metrics": {"mae": round(mae, 3), "rmse": round(rmse, 3)},
    }


def predict_sarima(values: list[float], forecast_steps: int = 30, params: dict | None = None) -> dict:
    """
    Fit a SARIMA model with seasonal period auto-detected or custom.
    Custom params: {"p": int, "d": int, "q": int, "P": int, "D": int, "Q": int, "seasonal_period": int}
    """
    from statsmodels.tsa.statespace.sarimax import SARIMAX
    from sklearn.metrics import mean_absolute_error, mean_squared_error

    y = np.array(values, dtype=float)
    params = params or {}

    # Determine orders: custom or defaults
    if "p" in params and "d" in params and "q" in params:
        order = (int(params["p"]), int(params["d"]), int(params["q"]))
    else:
        order = (1, 1, 1)

    seasonal_period = int(params.get("seasonal_period", min(12, max(2, len(y) // 10))))
    P = int(params.get("P", 1))
    D = int(params.get("D", 0))
    Q = int(params.get("Q", 1))
    seasonal_order = (P, D, Q, seasonal_period)

    try:
        model = SARIMAX(y, order=order, seasonal_order=seasonal_order,
                        enforce_stationarity=False, enforce_invertibility=False)
        fitted = model.fit(disp=False, maxiter=100)
        forecast_result = fitted.get_forecast(steps=forecast_steps)
        predictions = forecast_result.predicted_mean.tolist()
        ci = forecast_result.conf_int(alpha=0.05)
        lower = ci.iloc[:, 0].tolist()
        upper = ci.iloc[:, 1].tolist()
    except Exception:
        # Fallback to ARIMA
        return predict_arima(values, forecast_steps, params)

    # Metrics
    split = max(int(len(y) * 0.8), 2)
    train, test = y[:split], y[split:]
    try:
        val_model = SARIMAX(train, order=order, seasonal_order=seasonal_order,
                            enforce_stationarity=False, enforce_invertibility=False)
        val_fitted = val_model.fit(disp=False, maxiter=100)
        val_pred = val_fitted.forecast(steps=len(test))
        mae = float(mean_absolute_error(test, val_pred))
        rmse = float(np.sqrt(mean_squared_error(test, val_pred)))
    except Exception:
        mae = 0.0
        rmse = 0.0

    return {
        "model_name": f"SARIMA{order}x{seasonal_order}",
        "predictions": [round(v, 2) for v in predictions],
        "lower_ci": [round(v, 2) for v in lower],
        "upper_ci": [round(v, 2) for v in upper],
        "metrics": {"mae": round(mae, 3), "rmse": round(rmse, 3)},
    }


def predict_lstm(values: list[float], forecast_steps: int = 30, params: dict | None = None) -> dict:
    """
    Build and train a small LSTM model on-the-fly for short-term prediction.
    Custom params: {"epochs": int, "units": int, "look_back": int, "learning_rate": float, "batch_size": int}
    """
    from sklearn.preprocessing import MinMaxScaler
    from sklearn.metrics import mean_absolute_error, mean_squared_error

    y = np.array(values, dtype=float).reshape(-1, 1)
    params = params or {}

    # Normalize
    scaler = MinMaxScaler(feature_range=(0, 1))
    scaled = scaler.fit_transform(y)

    # Custom or default hyperparameters
    look_back = int(params.get("look_back", min(10, len(scaled) // 3)))
    epochs = int(params.get("epochs", 30))
    units = int(params.get("units", 32))
    learning_rate = float(params.get("learning_rate", 0.001))
    batch_size = int(params.get("batch_size", min(16, len(scaled))))

    if look_back < 2:
        # Not enough data for LSTM, fall back to ARIMA
        return predict_arima(values, forecast_steps, params)

    X, Y = [], []
    for i in range(look_back, len(scaled)):
        X.append(scaled[i - look_back:i, 0])
        Y.append(scaled[i, 0])
    X = np.array(X).reshape(-1, look_back, 1)
    Y = np.array(Y)

    # Build a tiny LSTM model
    try:
        import os
        import math
        os.environ["TF_CPP_MIN_LOG_LEVEL"] = "3"
        from tensorflow.keras.models import Sequential
        from tensorflow.keras.layers import LSTM, Dense
        from tensorflow.keras.optimizers import Adam

        model = Sequential([
            LSTM(units, input_shape=(look_back, 1), return_sequences=False),
            Dense(max(units // 2, 4), activation="relu"),
            Dense(1),
        ])
        model.compile(optimizer=Adam(learning_rate=learning_rate), loss="mse")
        model.fit(X, Y, epochs=epochs, batch_size=batch_size, verbose=0)

        # Predict forward
        last_seq = scaled[-look_back:].reshape(1, look_back, 1)
        predictions_scaled = []
        current = last_seq.copy()
        for _ in range(forecast_steps):
            pred = model.predict(current, verbose=0)[0, 0]
            predictions_scaled.append(pred)
            current = np.roll(current, -1, axis=1)
            current[0, -1, 0] = pred

        predictions = scaler.inverse_transform(
            np.array(predictions_scaled).reshape(-1, 1)
        ).flatten().tolist()
        
        # Prevent "dot" chart issue: If predictions exploded to NaN, fallback to ARIMA
        if any(math.isnan(p) or math.isinf(p) for p in predictions):
            raise ValueError("LSTM predicted NaN/Inf")

        # Simple confidence interval (±10% of prediction range)
        pred_std = float(np.std(predictions)) if len(predictions) > 1 else 1.0
        lower = [round(p - 1.96 * pred_std * 0.3, 2) for p in predictions]
        upper = [round(p + 1.96 * pred_std * 0.3, 2) for p in predictions]

    except Exception:
        return predict_arima(values, forecast_steps, params)

    # Metrics on last portion
    split = max(int(len(Y) * 0.8), 1)
    try:
        train_pred = model.predict(X[:split], verbose=0).flatten()
        test_pred = model.predict(X[split:], verbose=0).flatten()
        test_actual = Y[split:]
        test_pred_inv = scaler.inverse_transform(test_pred.reshape(-1, 1)).flatten()
        test_actual_inv = scaler.inverse_transform(test_actual.reshape(-1, 1)).flatten()
        mae = float(mean_absolute_error(test_actual_inv, test_pred_inv))
        rmse = float(np.sqrt(mean_squared_error(test_actual_inv, test_pred_inv)))
    except Exception:
        mae = 0.0
        rmse = 0.0

    return {
        "model_name": f"LSTM({units}→{max(units//2,4)}→1)",
        "predictions": [round(v, 2) for v in predictions],
        "lower_ci": lower,
        "upper_ci": upper,
        "metrics": {"mae": round(mae, 3), "rmse": round(rmse, 3)},
    }


def auto_predict(values: list[float], forecast_steps: int = 30, params: dict | None = None) -> dict:
    """
    Try ARIMA and SARIMA, pick the one with lower MAE.
    If data is long enough, also try LSTM.
    Note: auto mode ignores custom params — it auto-tunes each model.
    """
    results = []

    # Always try ARIMA
    arima_result = predict_arima(values, forecast_steps)
    results.append(arima_result)

    # Try SARIMA if enough data
    if len(values) >= 24:
        sarima_result = predict_sarima(values, forecast_steps)
        results.append(sarima_result)

    # Try LSTM if enough data
    if len(values) >= 30:
        try:
            lstm_result = predict_lstm(values, forecast_steps)
            results.append(lstm_result)
        except Exception:
            pass

    # Pick best by MAE (lower is better)
    best = min(results, key=lambda r: r["metrics"]["mae"] if r["metrics"]["mae"] > 0 else float("inf"))
    return best
