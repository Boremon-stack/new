# ML Prediction Workspace

This folder is a standalone in-progress ML area.
It is intentionally not wired to the website UI yet.

## What is included

- `data/sample_financial_profiles.csv`: sample training data
- `train_model.py`: trains and saves a regression model
- `predict_budget.py`: runs local predictions and budget recommendations
- `templates/inactivity_email_template.txt`: editable email template draft
- `models/.gitkeep`: placeholder for generated model files

## Quick start

```bash
python -m pip install -r requirements.txt
python train_model.py
python predict_budget.py --income-score 4 --discipline 3 --debt-pressure 2 --emergency-cover 4 --investment-habit 3 --automation-readiness 5
```

## Notes

- This package uses a lightweight regression approach for experimentation.
- Keep generated model artifacts inside `models/`.
