# Synthetic healthcare validation dataset

Fully synthetic Primavera-style `.xer` fixtures for project-detection regression. No real site, client, or project identifiers.

## Files

- `SYN1-Emergency Care Wing - Northvale - Civils Programme - Baseline.xer` — primary baseline (generic `proj_short_name`, filename title composition, large programme)
- `SYN1 Northvale June 2026 Programme - Copy.xer` — live-programme regression (`Copy` suffix stripping, NHS Trust client path)
- `expected-results.json` — ground truth for `npm run validate:detection`

Ground truth is defined in `expected-results.json`. The detection engine does **not** read this file — only the validation CLI does.
