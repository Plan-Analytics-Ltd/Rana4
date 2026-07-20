# Detection Engine Calibration Notes (Phase 7E.1)

## Validation findings (pre-calibration)

| Field | Issue | Root cause |
|-------|-------|------------|
| Project name | `Programme_V2.xml-3` detected | Generic `proj_short_name` ranked above meaningful titles |
| Project type | Industrial false positive | Standalone `\bplant\b` matched mechanical MEP activities |
| Client | Unknown | No explicit NHS/client strings in civils package XER |
| Stage | Planning | Baseline schedule (100% TK_NotStart) ignored construction content |
| Complexity | High vs Very High | Activity count alone underweighted logic density and WBS structure |

## Engine changes (general-purpose)

1. **Vocabulary module** (`projectDetection.vocabulary.ts`) — phrase-first sector and client dictionaries
2. **Industrial** — removed standalone `plant`; requires phrases or `plant + industrial context` combo
3. **Healthcare** — added phrases: plant room, emergency care, care building, medical gas, etc.
4. **Sector conflict balancing** — Healthcare vs Industrial (and other pairs) apply score penalties
5. **Project name hierarchy** — reject generic programme IDs; compose title from export filename; root WBS fallback
6. **Stage baseline logic** — when 90%+ not started, infer lifecycle stage from WBS/activity content signals
7. **Complexity bonuses** — reward logic density, WBS breadth/depth, and workstreams for programmes 100+ activities
8. **Confidence** — high confidence requires multi-source agreement and wider score margins

## Post-calibration (synthetic healthcare baseline)

| Field | Result |
|-------|--------|
| Project name | ✓ Northvale Emergency Care Wing (from filename composition) |
| Project type | ✓ Healthcare |
| Client | ⚠ Partial — no explicit client in baseline civils XER (correct behaviour) |
| Stage | ✓ Detailed Design |
| Complexity | ✓ High (59/100 at ~550 activities) |

Client remains unknown unless NHS/client text appears in the programme — by design.
