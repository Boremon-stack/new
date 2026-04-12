from __future__ import annotations

from pathlib import Path

import joblib
import pandas as pd
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import mean_absolute_error, r2_score
from sklearn.model_selection import train_test_split

ROOT = Path(__file__).resolve().parent
DATA_PATH = ROOT / "data" / "sample_financial_profiles.csv"
MODEL_DIR = ROOT / "models"
MODEL_PATH = MODEL_DIR / "financial_health_model.joblib"
METRICS_PATH = MODEL_DIR / "metrics.txt"

FEATURES = [
    "income_score",
    "expense_discipline",
    "debt_pressure",
    "emergency_cover",
    "investment_habit",
    "automation_readiness",
]
TARGET = "financial_health_score"


def main() -> None:
    df = pd.read_csv(DATA_PATH)

    x = df[FEATURES]
    y = df[TARGET]

    x_train, x_test, y_train, y_test = train_test_split(
        x,
        y,
        test_size=0.25,
        random_state=42,
    )

    model = RandomForestRegressor(
        n_estimators=240,
        max_depth=8,
        random_state=42,
    )
    model.fit(x_train, y_train)

    predictions = model.predict(x_test)
    mae = mean_absolute_error(y_test, predictions)
    r2 = r2_score(y_test, predictions)

    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    joblib.dump({"model": model, "features": FEATURES}, MODEL_PATH)

    report = (
        "Financial Health Model Metrics\n"
        f"Rows: {len(df)}\n"
        f"MAE: {mae:.3f}\n"
        f"R2: {r2:.3f}\n"
    )
    METRICS_PATH.write_text(report, encoding="utf-8")

    print("Model training complete.")
    print(report)


if __name__ == "__main__":
    main()
