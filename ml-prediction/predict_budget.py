from __future__ import annotations

import argparse
from pathlib import Path

import joblib
import pandas as pd

ROOT = Path(__file__).resolve().parent
MODEL_PATH = ROOT / "models" / "financial_health_model.joblib"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Predict financial health score and budget allocation.")
    parser.add_argument("--income-score", type=int, required=True, choices=range(1, 6))
    parser.add_argument("--discipline", type=int, required=True, choices=range(1, 6))
    parser.add_argument("--debt-pressure", type=int, required=True, choices=range(1, 6))
    parser.add_argument("--emergency-cover", type=int, required=True, choices=range(1, 6))
    parser.add_argument("--investment-habit", type=int, required=True, choices=range(1, 6))
    parser.add_argument("--automation-readiness", type=int, required=True, choices=range(1, 6))
    parser.add_argument("--monthly-income", type=int, default=100000)
    return parser.parse_args()


def recommended_allocation(score: float) -> dict[str, int]:
    if score < 45:
        return {
            "Essentials": 50,
            "Debt": 24,
            "Savings": 14,
            "Investments": 4,
            "Lifestyle": 8,
        }
    if score < 70:
        return {
            "Essentials": 47,
            "Debt": 16,
            "Savings": 20,
            "Investments": 9,
            "Lifestyle": 8,
        }
    return {
        "Essentials": 44,
        "Debt": 10,
        "Savings": 21,
        "Investments": 17,
        "Lifestyle": 8,
    }


def main() -> None:
    if not MODEL_PATH.exists():
        raise FileNotFoundError(
            "Model file missing. Run train_model.py first to create models/financial_health_model.joblib"
        )

    args = parse_args()

    bundle = joblib.load(MODEL_PATH)
    model = bundle["model"]
    features = bundle["features"]

    sample = pd.DataFrame(
        [
            {
                "income_score": args.income_score,
                "expense_discipline": args.discipline,
                "debt_pressure": args.debt_pressure,
                "emergency_cover": args.emergency_cover,
                "investment_habit": args.investment_habit,
                "automation_readiness": args.automation_readiness,
            }
        ]
    )

    prediction = float(model.predict(sample[features])[0])
    score = max(1.0, min(99.0, prediction))
    allocation = recommended_allocation(score)

    print(f"Predicted financial health score: {score:.2f}/100")
    print("Suggested budget split:")

    for name, percent in allocation.items():
        amount = round((percent / 100) * args.monthly_income)
        print(f"- {name}: {percent}% (INR {amount:,})")


if __name__ == "__main__":
    main()
