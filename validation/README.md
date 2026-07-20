# Project Detection Validation

This folder holds **known-truth datasets** for calibrating and regression-testing the Project Detection Engine.

## Structure

Each dataset is a subfolder:

```
validation/
  <dataset-id>/
    programme.xer          # Primavera export (one or more .xer files)
    expected-results.json  # Ground truth — not used by the engine
```

## expected-results.json

```json
{
  "description": "Short label for reports",
  "primaryFile": "programme.xer",
  "minAccuracy": 1.0,
  "expected": {
    "projectName": "Exact project name",
    "projectType": "Healthcare",
    "client": "NHS Trust",
    "stage": "Construction",
    "complexity": "Very High"
  },
  "notes": "Optional notes for maintainers"
}
```

Only include keys you want validated. Omitted keys are skipped.

`minAccuracy` is the minimum overall accuracy (0–1) required for the dataset to pass. Synthetic fixtures use `1.0`; real programmes may use lower thresholds during calibration.

## Running validation

```bash
npm run validate:detection
```

This compares engine output to `expected-results.json` for every dataset that contains at least one `.xer` file.

## Adding a synthetic programme

1. Create `validation/<dataset-id>/` (see `synthetic-healthcare/` for a large example)
2. Add one or more `.xer` files (or run `node scripts/generate-synthetic-healthcare-xer.mjs`)
3. Set `primaryFile` in `expected-results.json` if you have multiple revisions
4. Fill in **known truths only** in `expected-results.json` — never tune the engine to match a single project
5. Run `npm run validate:detection` and review the report

Datasets without `.xer` files are listed but skipped (no failure).

## Reports

The CLI prints:

- Per-field detected vs expected status
- Evidence and confidence reasoning
- Engine accuracy metrics
- Overall pass/fail

Use these reports to improve keyword weights and scoring — not to hardcode project-specific answers.
