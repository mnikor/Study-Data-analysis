# Reference Validation Report

This report captures deterministic backend fixture runs for the newer clinical analysis families.

## Repeated Measures

- Status: `executable`
- Executed: `True`
- Analysis family: `mixed_model`
- Interpretation: Computed a repeated-measures GEE model to estimate within-subject change over time and treatment-by-time effects.
- Metrics:
  - `analysis_method`: `gee_exchangeable`
  - `subjects_used`: `4`
  - `observations_used`: `12`
  - `predictor_columns`: `11`
  - `outcome_type`: `continuous`
- Result rows: `11`
- Warnings:
  - Repeated-measures output currently uses an exchangeable GEE working correlation rather than a full random-effects mixed model.
  - When multiple repeated parameters exist, verify that the selected endpoint label matches the intended measurement series.
  - Repeated-measures models require long-format visit-level rows and consistent subject identifiers.
  - When multiple repeated parameters exist, the planner may need a specific endpoint label or parameter hint.

## Threshold Search

- Status: `executable`
- Executed: `True`
- Analysis family: `threshold_search`
- Interpretation: Computed exploratory threshold candidates to flag later treatment persistence risk from early-event and baseline predictors.
- Metrics:
  - `analysis_method`: `threshold_search`
  - `subjects_used`: `8`
  - `candidate_predictors`: `4`
  - `top_predictor`: `AGE`
  - `optimization_metric`: `balanced_accuracy`
- Result rows: `4`
- Warnings:
  - Threshold search is exploratory and should be validated on a holdout cohort or reference implementation before operational use.
  - Balanced accuracy ranking does not guarantee clinical utility or causal interpretation.
  - Threshold search is exploratory and should be validated against a holdout set or external reference implementation.
  - Later persistence endpoints require disposition or compliance timing to avoid label leakage.

## Competing Risks

- Status: `executable`
- Executed: `True`
- Analysis family: `competing_risks`
- Interpretation: Computed cumulative-incidence summaries for discontinuation while treating death as a competing event.
- Metrics:
  - `analysis_method`: `aalen_johansen_cumulative_incidence`
  - `groups`: `2`
  - `subjects_used`: `8`
  - `event_of_interest_subjects`: `3`
  - `competing_event_subjects`: `2`
- Result rows: `2`
- Warnings:
  - Fine-Gray regression is not implemented yet; this output is a group-level cumulative-incidence summary.
  - Competing-risk output currently provides nonparametric cumulative-incidence summaries rather than a full Fine-Gray regression.
