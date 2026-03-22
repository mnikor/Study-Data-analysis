from __future__ import annotations

from math import exp, sqrt
import re

import pandas as pd
from lifelines import CoxPHFitter, KaplanMeierFitter
try:  # pragma: no cover - depends on installed lifelines version
    from lifelines import AalenJohansenFitter
except ImportError:  # pragma: no cover
    AalenJohansenFitter = None  # type: ignore[assignment]
from lifelines.statistics import multivariate_logrank_test
from scipy.stats import chi2_contingency
from sklearn.ensemble import RandomForestClassifier
from sklearn.inspection import partial_dependence
from sklearn.metrics import balanced_accuracy_score, f1_score
import statsmodels.api as sm

from ..models.analysis import AnalysisMetric, AnalysisRunResponse, AnalysisSpec, AnalysisTable


def _cohort_filter_summary(metadata: dict[str, str | int | list[str] | None]) -> tuple[list[str], str | None]:
    labels = metadata.get("cohort_filter_labels")
    if isinstance(labels, list):
        cleaned = [str(label).strip() for label in labels if str(label).strip()]
    else:
        cleaned = []
    if not cleaned:
        return [], None
    return cleaned, ", ".join(cleaned)


def run_incidence_analysis(
    workspace_id: str,
    workspace: pd.DataFrame,
    metadata: dict[str, str | int | list[str] | None],
    analysis_family: str,
) -> AnalysisRunResponse:
    treatment_col = str(metadata.get("treatment_column") or "")
    outcome_col = str(metadata.get("outcome_column") or "")
    if not treatment_col or not outcome_col:
        raise ValueError("Workspace metadata is missing treatment or outcome columns.")

    if treatment_col not in workspace.columns or outcome_col not in workspace.columns:
        raise ValueError("Workspace does not contain required treatment or outcome columns.")

    frame = workspace[[treatment_col, outcome_col]].copy()
    frame = frame[frame[treatment_col].astype(str).str.strip() != ""]
    frame[outcome_col] = pd.to_numeric(frame[outcome_col], errors="coerce").fillna(0).astype(int)

    grouped = (
        frame.groupby(treatment_col, dropna=False)[outcome_col]
        .agg(["count", "sum"])
        .reset_index()
        .rename(columns={"count": "n", "sum": "event_n"})
    )
    grouped["incidence_pct"] = (grouped["event_n"] / grouped["n"] * 100).round(2)

    if grouped.shape[0] < 2:
        raise ValueError("Incidence analysis requires at least two treatment groups.")

    contingency = pd.crosstab(frame[treatment_col], frame[outcome_col])
    chi2, p_value, _, _ = chi2_contingency(contingency)
    cohort_labels, cohort_summary = _cohort_filter_summary(metadata)

    metrics = [
        AnalysisMetric(name="analysis_method", value="incidence_by_treatment"),
        AnalysisMetric(name="groups", value=int(grouped.shape[0])),
        AnalysisMetric(name="total_subjects", value=int(grouped["n"].sum())),
        AnalysisMetric(name="event_subjects", value=int(grouped["event_n"].sum())),
        AnalysisMetric(name="chi_square", value=round(float(chi2), 4)),
        AnalysisMetric(name="p_value", value=round(float(p_value), 6)),
    ]
    if cohort_summary:
        metrics.append(AnalysisMetric(name="cohort_filters_applied", value=cohort_summary))
    if metadata.get("cohort_subject_count") is not None:
        metrics.append(AnalysisMetric(name="cohort_subjects", value=int(metadata["cohort_subject_count"])))

    warnings: list[str] = []
    interpretation = (
        f"Computed subject-level incidence by treatment within the filtered cohort ({cohort_summary}) from the row-level FastAPI workspace."
        if cohort_summary
        else "Computed subject-level incidence by treatment from the row-level FastAPI workspace."
    )

    if grouped.shape[0] == 2:
        ordered = grouped.sort_values(by=treatment_col).reset_index(drop=True)
        reference = ordered.iloc[0]
        comparison = ordered.iloc[1]
        ref_rate = float(reference["event_n"]) / float(reference["n"])
        cmp_rate = float(comparison["event_n"]) / float(comparison["n"])
        risk_difference = cmp_rate - ref_rate
        standard_error = sqrt(
            (cmp_rate * (1 - cmp_rate) / float(comparison["n"]))
            + (ref_rate * (1 - ref_rate) / float(reference["n"]))
        )
        ci_lower = risk_difference - 1.96 * standard_error
        ci_upper = risk_difference + 1.96 * standard_error

        metrics.extend(
            [
                AnalysisMetric(name="reference_group", value=str(reference[treatment_col])),
                AnalysisMetric(name="comparison_group", value=str(comparison[treatment_col])),
                AnalysisMetric(name="risk_difference", value=round(risk_difference, 6)),
                AnalysisMetric(name="ci_lower_95", value=round(ci_lower, 6)),
                AnalysisMetric(name="ci_upper_95", value=round(ci_upper, 6)),
            ]
        )
        interpretation = (
            f"Computed subject-level incidence by treatment and a two-group risk difference "
            f"({comparison[treatment_col]} minus {reference[treatment_col]})"
            f"{f' within the filtered cohort ({cohort_summary})' if cohort_summary else ''}."
        )
        warnings.append("Risk difference confidence interval currently uses a normal approximation.")
    else:
        warnings.append("Risk difference is only returned when exactly two treatment groups are present.")

    table = AnalysisTable(
        title="Incidence by treatment group",
        columns=[treatment_col, "n", "event_n", "incidence_pct"],
        rows=grouped.to_dict(orient="records"),
    )

    return AnalysisRunResponse(
        status="executable",
        executed=True,
        analysis_family=analysis_family,  # type: ignore[arg-type]
        workspace_id=workspace_id,
        interpretation=interpretation,
        metrics=metrics,
        table=table,
        warnings=warnings,
        explanation="Deterministic incidence analysis executed on the FastAPI workspace.",
    )


def run_logistic_regression(
    workspace_id: str,
    workspace: pd.DataFrame,
    metadata: dict[str, str | int | list[str] | None],
    spec: AnalysisSpec | None,
) -> AnalysisRunResponse:
    treatment_col = str(metadata.get("treatment_column") or "")
    outcome_col = str(metadata.get("outcome_column") or "")
    subject_id_col = str(metadata.get("subject_id_column") or "")

    if not outcome_col or outcome_col not in workspace.columns:
        raise ValueError("Workspace does not contain the derived binary outcome column required for logistic regression.")

    candidate_covariates = _select_logistic_covariates(workspace, metadata, spec)
    if treatment_col and treatment_col in workspace.columns and treatment_col not in candidate_covariates:
        candidate_covariates.insert(0, treatment_col)

    candidate_covariates = [column for column in candidate_covariates if column in workspace.columns and column != outcome_col]
    if not candidate_covariates:
        raise ValueError("No usable baseline covariates were detected for logistic regression.")

    model_frame = workspace[[outcome_col, *candidate_covariates]].copy()
    model_frame[outcome_col] = pd.to_numeric(model_frame[outcome_col], errors="coerce")
    model_frame = model_frame[model_frame[outcome_col].isin([0, 1])].copy()

    prepared_predictors: dict[str, pd.Series] = {}
    warnings: list[str] = []
    for column in candidate_covariates:
        series = workspace.loc[model_frame.index, column]
        prepared = _prepare_predictor_series(series)
        if prepared is None:
            warnings.append(f"Skipped predictor {column} because it was empty or constant in the analysis subset.")
            continue
        prepared_predictors[column] = prepared

    if not prepared_predictors:
        raise ValueError("All candidate predictors were constant or missing after preprocessing.")

    predictor_frame = pd.DataFrame(prepared_predictors, index=model_frame.index)
    combined = pd.concat([model_frame[[outcome_col]], predictor_frame], axis=1).dropna()
    if combined.empty:
        raise ValueError("Logistic regression has no complete-case rows after applying outcome and predictor requirements.")

    outcome = combined[outcome_col].astype(int)
    if outcome.nunique() < 2:
        raise ValueError("Logistic regression requires both outcome classes to be present in the analysis subset.")

    predictor_columns = [column for column in combined.columns if column != outcome_col]
    design = pd.get_dummies(combined[predictor_columns], drop_first=True, dtype=float)
    design, interaction_warnings = _apply_interaction_terms(design, spec, metadata)
    design = design.loc[:, design.nunique(dropna=False) > 1]
    design, stabilization_warnings = _stabilize_design_matrix(
        design,
        sample_size=int(combined.shape[0]),
        treatment_col=treatment_col,
        event_count=int(outcome.sum()),
    )
    if design.empty:
        raise ValueError("Predictor encoding produced no informative columns for logistic regression.")

    design = sm.add_constant(design, has_constant="add")

    try:
        fitted = sm.Logit(outcome, design).fit(disp=False, maxiter=100)
    except Exception as error:  # pragma: no cover - statsmodels failure paths vary by data shape
        raise ValueError(f"Logistic regression failed to converge on the current workspace: {error}") from error

    conf_int = fitted.conf_int()
    coefficient_rows: list[dict[str, str | float | int]] = []
    for parameter in fitted.params.index:
        if parameter == "const":
            continue
        coefficient = float(fitted.params[parameter])
        ci_lower = float(conf_int.loc[parameter, 0])
        ci_upper = float(conf_int.loc[parameter, 1])
        coefficient_rows.append(
            {
                "predictor": parameter,
                "coefficient": round(coefficient, 6),
                "odds_ratio": round(float(exp(coefficient)), 6),
                "ci_lower_95": round(float(exp(ci_lower)), 6),
                "ci_upper_95": round(float(exp(ci_upper)), 6),
                "p_value": round(float(fitted.pvalues[parameter]), 6),
            }
        )

    metrics = [
        AnalysisMetric(name="analysis_method", value="logistic_regression"),
        AnalysisMetric(name="subjects_used", value=int(combined.shape[0])),
        AnalysisMetric(name="event_subjects", value=int(outcome.sum())),
        AnalysisMetric(name="non_event_subjects", value=int((1 - outcome).sum())),
        AnalysisMetric(name="predictor_columns", value=int(len(coefficient_rows))),
        AnalysisMetric(name="pseudo_r_squared", value=round(float(fitted.prsquared), 6)),
    ]
    if subject_id_col:
        metrics.append(AnalysisMetric(name="subject_identifier", value=subject_id_col))
    if treatment_col:
        metrics.append(AnalysisMetric(name="treatment_variable", value=treatment_col))
    if spec and spec.interaction_terms:
        metrics.append(AnalysisMetric(name="interaction_terms_requested", value=len(spec.interaction_terms)))

    warnings.append("Logistic regression currently uses complete-case rows after baseline predictor preprocessing.")
    if spec is None or not spec.covariates:
        warnings.append("Predictors were auto-selected from treatment, demographic, and baseline lab columns.")
    warnings.extend(interaction_warnings)
    warnings.extend(stabilization_warnings)

    table = AnalysisTable(
        title="Logistic regression coefficients",
        columns=["predictor", "coefficient", "odds_ratio", "ci_lower_95", "ci_upper_95", "p_value"],
        rows=coefficient_rows,
    )

    return AnalysisRunResponse(
        status="executable",
        executed=True,
        analysis_family="logistic_regression",
        workspace_id=workspace_id,
        interpretation=(
            "Computed a subject-level logistic regression for the derived adverse-event endpoint using baseline covariates."
        ),
        metrics=metrics,
        table=table,
        warnings=warnings,
        explanation="Deterministic logistic regression executed on the FastAPI workspace.",
    )


def _select_logistic_covariates(
    workspace: pd.DataFrame,
    metadata: dict[str, str | int | list[str] | None],
    spec: AnalysisSpec | None,
) -> list[str]:
    if spec and spec.covariates:
        return [column for column in spec.covariates if column in workspace.columns]

    treatment_col = str(metadata.get("treatment_column") or "")
    subject_id_col = str(metadata.get("subject_id_column") or "")
    outcome_col = str(metadata.get("outcome_column") or "")
    survival_time_col = str(metadata.get("survival_time_column") or "")
    survival_event_col = str(metadata.get("survival_event_column") or "")

    selected: list[str] = []
    if treatment_col and treatment_col in workspace.columns:
        selected.append(treatment_col)

    priority_tokens = (
        "age",
        "sex",
        "race",
        "ethnic",
        "bmi",
        "weight",
        "bsa",
        "psa",
        "ecog",
        "line",
        "prior",
    )

    for column in workspace.columns:
        normalized = _normalize_column_name(column)
        if column in {subject_id_col, outcome_col, treatment_col, survival_time_col, survival_event_col}:
            continue
        if normalized == "weight" and "EX_WEIGHT_KG" in workspace.columns:
            continue
        if column.startswith("LAB_"):
            selected.append(column)
            continue
        if column.startswith("EX_"):
            selected.append(column)
            continue
        if column.startswith("AE_") and not any(
            token in column
            for token in (
                "OUTCOME_FLAG",
                "TIME_TO_EVENT",
                "EVENT_INDICATOR",
                "TIME_TO_RESOLUTION",
                "RESOLUTION_EVENT",
            )
        ):
            selected.append(column)
            continue
        if any(token in normalized for token in priority_tokens):
            selected.append(column)

    deduped: list[str] = []
    for column in selected:
        if column not in deduped:
            deduped.append(column)
    return deduped[:16]


def _prepare_predictor_series(series: pd.Series) -> pd.Series | None:
    numeric = pd.to_numeric(series, errors="coerce")
    non_missing_numeric = numeric.dropna()
    if not non_missing_numeric.empty and non_missing_numeric.nunique() > 1:
        return numeric.astype(float)

    categorical = series.astype(str).str.strip().replace("", pd.NA)
    if categorical.dropna().nunique() <= 1:
        return None
    return categorical


def _normalize_column_name(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", value.lower())


def _apply_interaction_terms(
    design: pd.DataFrame,
    spec: AnalysisSpec | None,
    metadata: dict[str, str | int | list[str] | None],
) -> tuple[pd.DataFrame, list[str]]:
    if spec is None or not spec.interaction_terms:
        return design, []

    augmented = design.copy()
    warnings: list[str] = []
    treatment_col = str(metadata.get("treatment_column") or "")
    total_added = 0

    for term in spec.interaction_terms:
        parts = re.split(r"[:*]", term)
        if len(parts) != 2:
            warnings.append(f"Skipped interaction term {term} because it does not use a supported left*right format.")
            continue

        left_token, right_token = parts[0].strip(), parts[1].strip()
        left_columns = _resolve_interaction_columns(list(augmented.columns), left_token, treatment_col)
        right_columns = _resolve_interaction_columns(list(augmented.columns), right_token, treatment_col)

        if not left_columns or not right_columns:
            warnings.append(f"Skipped interaction term {term} because matching encoded predictors were not found.")
            continue

        per_term_added = 0
        for left in left_columns:
            for right in right_columns:
                if left == right:
                    continue
                if left.startswith("INT__") or right.startswith("INT__"):
                    continue
                column_name = f"INT__{left}__X__{right}"
                reverse_name = f"INT__{right}__X__{left}"
                if column_name in augmented.columns or reverse_name in augmented.columns:
                    continue
                augmented[column_name] = augmented[left] * augmented[right]
                per_term_added += 1
                total_added += 1
                if per_term_added >= 12:
                    break
            if per_term_added >= 12:
                break

        warnings.append(f"Added {per_term_added} encoded interaction column(s) for requested term {term}.")

    if total_added == 0:
        return design, warnings

    augmented = augmented.loc[:, augmented.nunique(dropna=False) > 1]
    return augmented, warnings


def _resolve_interaction_columns(columns: list[str], token: str, treatment_col: str) -> list[str]:
    normalized_token = _normalize_column_name(token)
    normalized_treatment = _normalize_column_name(treatment_col)

    if normalized_token in {"treatment", "arm", "trt"}:
        matches = [
            column
            for column in columns
            if normalized_treatment and normalized_treatment in _normalize_column_name(column)
            or any(alias in _normalize_column_name(column) for alias in ("treatment", "arm", "trt"))
        ]
        return matches[:6]

    if normalized_token == "dose":
        matches = [
            column
            for column in columns
            if any(alias in _normalize_column_name(column) for alias in ("dose", "weighttier", "weightkg", "weight"))
        ]
        return matches[:6]

    if normalized_token == "all":
        return [column for column in columns if not column.startswith("INT__")][:8]

    return [column for column in columns if normalized_token and normalized_token in _normalize_column_name(column)][:6]


def _stabilize_design_matrix(
    design: pd.DataFrame,
    sample_size: int,
    treatment_col: str,
    event_count: int | None = None,
) -> tuple[pd.DataFrame, list[str]]:
    if design.empty:
        return design, []

    event_limited = event_count * 2 if event_count is not None and event_count > 0 else design.shape[1]
    max_columns = max(3, min(12, max(3, sample_size // 2), max(3, event_limited)))
    if design.shape[1] <= max_columns:
        return design, []

    normalized_treatment = _normalize_column_name(treatment_col)

    def rank(column: str) -> tuple[int, int]:
        normalized = _normalize_column_name(column)
        if normalized_treatment and normalized_treatment in normalized:
            return (0, 0)
        if column.startswith("INT__"):
            return (2, 0)
        if any(token in normalized for token in ("dose", "weight", "lab", "age", "sex", "race", "ethnic", "ae")):
            return (1, 0)
        return (3, 0)

    kept_columns = sorted(design.columns, key=rank)[:max_columns]
    reduced = design[kept_columns].copy()
    return reduced, [
        f"Reduced encoded predictor matrix from {design.shape[1]} to {reduced.shape[1]} columns to improve model stability for the available sample size."
    ]


def run_kaplan_meier_analysis(
    workspace_id: str,
    workspace: pd.DataFrame,
    metadata: dict[str, str | int | list[str] | None],
    analysis_family: str,
) -> AnalysisRunResponse:
    treatment_col, time_col, event_col = _get_survival_columns(workspace, metadata)
    frame = workspace[[treatment_col, time_col, event_col]].copy()
    frame = frame[frame[treatment_col].astype(str).str.strip() != ""]
    frame[time_col] = pd.to_numeric(frame[time_col], errors="coerce")
    frame[event_col] = pd.to_numeric(frame[event_col], errors="coerce")
    frame = frame.dropna(subset=[time_col, event_col])
    frame[event_col] = frame[event_col].astype(int)

    if frame.empty:
        raise ValueError("Kaplan-Meier analysis has no usable time/event rows after preprocessing.")

    kmf = KaplanMeierFitter()
    rows: list[dict[str, str | float | int]] = []
    for group, group_frame in frame.groupby(treatment_col, dropna=False):
        kmf.fit(group_frame[time_col], event_observed=group_frame[event_col], label=str(group))
        median_value = kmf.median_survival_time_
        rows.append(
            {
                treatment_col: str(group),
                "n": int(group_frame.shape[0]),
                "event_n": int(group_frame[event_col].sum()),
                "median_survival": round(float(median_value), 6) if pd.notna(median_value) else "not reached",
            }
        )

    if len(rows) < 2:
        raise ValueError("Kaplan-Meier analysis requires at least two treatment groups.")

    logrank = multivariate_logrank_test(frame[time_col], frame[treatment_col], frame[event_col])
    metrics = [
        AnalysisMetric(name="analysis_method", value="kaplan_meier_logrank"),
        AnalysisMetric(name="groups", value=int(len(rows))),
        AnalysisMetric(name="subjects_used", value=int(frame.shape[0])),
        AnalysisMetric(name="event_subjects", value=int(frame[event_col].sum())),
        AnalysisMetric(name="log_rank_statistic", value=round(float(logrank.test_statistic), 6)),
        AnalysisMetric(name="log_rank_p_value", value=round(float(logrank.p_value), 6)),
    ]

    return AnalysisRunResponse(
        status="executable",
        executed=True,
        analysis_family=analysis_family,  # type: ignore[arg-type]
        workspace_id=workspace_id,
        interpretation="Computed Kaplan-Meier group summaries with a log-rank comparison from the FastAPI survival workspace.",
        metrics=metrics,
        table=AnalysisTable(
            title="Kaplan-Meier summary by treatment group",
            columns=[treatment_col, "n", "event_n", "median_survival"],
            rows=rows,
        ),
        warnings=["Kaplan-Meier output currently returns group summaries rather than a full survival-curve table."],
        explanation="Deterministic Kaplan-Meier analysis executed on the FastAPI workspace.",
    )


def run_cox_analysis(
    workspace_id: str,
    workspace: pd.DataFrame,
    metadata: dict[str, str | int | list[str] | None],
    spec: AnalysisSpec | None,
) -> AnalysisRunResponse:
    treatment_col, time_col, event_col = _get_survival_columns(workspace, metadata)
    subject_id_col = str(metadata.get("subject_id_column") or "")
    candidate_covariates = _select_logistic_covariates(workspace, metadata, spec)
    if treatment_col not in candidate_covariates and treatment_col in workspace.columns:
        candidate_covariates.insert(0, treatment_col)
    candidate_covariates = [column for column in candidate_covariates if column in workspace.columns and column not in {time_col, event_col}]
    if not candidate_covariates:
        raise ValueError("No usable baseline covariates were detected for Cox regression.")

    model_frame = workspace[[time_col, event_col, *candidate_covariates]].copy()
    model_frame[time_col] = pd.to_numeric(model_frame[time_col], errors="coerce")
    model_frame[event_col] = pd.to_numeric(model_frame[event_col], errors="coerce")

    prepared_predictors: dict[str, pd.Series] = {}
    warnings: list[str] = []
    for column in candidate_covariates:
        prepared = _prepare_predictor_series(model_frame[column])
        if prepared is None:
            warnings.append(f"Skipped predictor {column} because it was empty or constant in the analysis subset.")
            continue
        prepared_predictors[column] = prepared

    if not prepared_predictors:
        raise ValueError("All candidate Cox predictors were constant or missing after preprocessing.")

    predictor_frame = pd.DataFrame(prepared_predictors, index=model_frame.index)
    combined = pd.concat([model_frame[[time_col, event_col]], predictor_frame], axis=1).dropna()
    combined[event_col] = combined[event_col].astype(int)
    combined = combined[(combined[event_col].isin([0, 1])) & (combined[time_col] > 0)]
    if combined.empty:
        raise ValueError("Cox regression has no complete-case rows after applying time/event and predictor requirements.")
    if combined[event_col].sum() == 0:
        raise ValueError("Cox regression requires at least one observed event in the analysis subset.")

    predictor_columns = [column for column in combined.columns if column not in {time_col, event_col}]
    design = pd.get_dummies(combined[predictor_columns], drop_first=True, dtype=float)
    design, interaction_warnings = _apply_interaction_terms(design, spec, metadata)
    design = design.loc[:, design.nunique(dropna=False) > 1]
    design, stabilization_warnings = _stabilize_design_matrix(
        design,
        sample_size=int(combined.shape[0]),
        treatment_col=treatment_col,
        event_count=int(combined[event_col].sum()),
    )
    if design.empty:
        raise ValueError("Predictor encoding produced no informative columns for Cox regression.")

    cox_frame = pd.concat([combined[[time_col, event_col]], design], axis=1)
    fitter = CoxPHFitter(penalizer=0.2)
    try:
        fitter.fit(cox_frame, duration_col=time_col, event_col=event_col)
    except Exception as error:  # pragma: no cover - fitter failures depend on data shape
        raise ValueError(f"Cox regression failed to converge on the current workspace: {error}") from error

    summary = fitter.summary.reset_index().rename(columns={"covariate": "predictor"})
    table_rows: list[dict[str, str | float | int]] = []
    for _, row in summary.iterrows():
        table_rows.append(
            {
                "predictor": str(row["predictor"]),
                "coefficient": round(float(row["coef"]), 6),
                "hazard_ratio": round(float(row["exp(coef)"]), 6),
                "ci_lower_95": round(float(row["exp(coef) lower 95%"]), 6),
                "ci_upper_95": round(float(row["exp(coef) upper 95%"]), 6),
                "p_value": round(float(row["p"]), 6),
            }
        )

    metrics = [
        AnalysisMetric(name="analysis_method", value="cox_proportional_hazards"),
        AnalysisMetric(name="subjects_used", value=int(cox_frame.shape[0])),
        AnalysisMetric(name="event_subjects", value=int(cox_frame[event_col].sum())),
        AnalysisMetric(name="predictor_columns", value=int(len(table_rows))),
        AnalysisMetric(name="concordance_index", value=round(float(fitter.concordance_index_), 6)),
    ]
    if subject_id_col:
        metrics.append(AnalysisMetric(name="subject_identifier", value=subject_id_col))
    if treatment_col:
        metrics.append(AnalysisMetric(name="treatment_variable", value=treatment_col))
    if spec and spec.interaction_terms:
        metrics.append(AnalysisMetric(name="interaction_terms_requested", value=len(spec.interaction_terms)))

    warnings.append("Cox regression currently uses complete-case rows after baseline predictor preprocessing.")
    if spec is None or not spec.covariates:
        warnings.append("Predictors were auto-selected from treatment, demographic, and baseline lab columns.")
    warnings.extend(interaction_warnings)
    warnings.extend(stabilization_warnings)

    return AnalysisRunResponse(
        status="executable",
        executed=True,
        analysis_family="cox",
        workspace_id=workspace_id,
        interpretation=(
            "Computed a Cox proportional hazards model from the FastAPI survival workspace."
            if metadata.get("target_definition") != "time_to_resolution_grade_2_plus_dae"
            else "Computed a Cox proportional hazards model for time to resolution among subjects with qualifying adverse events."
        ),
        metrics=metrics,
        table=AnalysisTable(
            title="Cox proportional hazards coefficients",
            columns=["predictor", "coefficient", "hazard_ratio", "ci_lower_95", "ci_upper_95", "p_value"],
            rows=table_rows,
        ),
        warnings=warnings,
        explanation="Deterministic Cox regression executed on the FastAPI workspace.",
    )


def run_mixed_model_analysis(
    workspace_id: str,
    workspace: pd.DataFrame,
    metadata: dict[str, str | int | list[str] | None],
    spec: AnalysisSpec | None,
) -> AnalysisRunResponse:
    subject_col = str(metadata.get("subject_id_column") or "")
    treatment_col = str(metadata.get("treatment_column") or "")
    time_col = str(metadata.get("repeated_time_column") or "")
    value_col = str(metadata.get("repeated_value_column") or "")

    required = [subject_col, treatment_col, time_col, value_col]
    if any(not column for column in required):
        raise ValueError("Repeated-measures metadata is missing subject, treatment, time, or value columns.")
    if any(column not in workspace.columns for column in required):
        raise ValueError("Workspace does not contain the required repeated-measures columns.")

    candidate_covariates = _select_logistic_covariates(workspace, metadata, spec)
    covariate_columns = [column for column in candidate_covariates if column in workspace.columns and column not in {subject_col, treatment_col, time_col, value_col}]

    frame = workspace[[subject_col, treatment_col, time_col, value_col, *covariate_columns]].copy()
    frame[time_col] = pd.to_numeric(frame[time_col], errors="coerce")
    frame[value_col] = pd.to_numeric(frame[value_col], errors="coerce")
    frame = frame.dropna(subset=[subject_col, treatment_col, time_col, value_col]).copy()
    if frame.empty:
        raise ValueError("Repeated-measures analysis has no complete rows after preprocessing.")
    if frame[subject_col].nunique() < 2:
        raise ValueError("Repeated-measures analysis requires at least two subjects.")

    base_predictors = [treatment_col, time_col, *covariate_columns]
    design_base = frame[base_predictors].copy()
    categorical_columns = [column for column in design_base.columns if column != time_col and not pd.api.types.is_numeric_dtype(design_base[column])]
    if categorical_columns:
        design = pd.get_dummies(design_base, columns=categorical_columns, drop_first=True, dtype=float)
    else:
        design = design_base.astype(float)

    treatment_columns = [column for column in design.columns if _normalize_column_name(treatment_col) in _normalize_column_name(column)]
    if not treatment_columns and treatment_col in design.columns:
        treatment_columns = [treatment_col]
    for treatment_term in treatment_columns[:4]:
        interaction_name = f"INT__{treatment_term}__X__{time_col}"
        if interaction_name not in design.columns:
            design[interaction_name] = design[treatment_term] * design[time_col]

    design = design.loc[:, design.nunique(dropna=False) > 1]
    design = sm.add_constant(design, has_constant="add")
    outcome = frame[value_col].astype(float)

    unique_outcomes = sorted(set(outcome.dropna().tolist()))
    is_binary = len(unique_outcomes) <= 2 and set(unique_outcomes).issubset({0.0, 1.0})
    family = sm.families.Binomial() if is_binary else sm.families.Gaussian()

    try:
        fitted = sm.GEE(
            outcome,
            design,
            groups=frame[subject_col],
            cov_struct=sm.cov_struct.Exchangeable(),
            family=family,
        ).fit()
    except Exception as error:  # pragma: no cover - depends on data shape
        raise ValueError(f"Repeated-measures model failed to converge on the current workspace: {error}") from error

    conf_int = fitted.conf_int()
    rows: list[dict[str, str | float | int]] = []
    for parameter in fitted.params.index:
        if parameter == "const":
            continue
        lower = float(conf_int.loc[parameter, 0])
        upper = float(conf_int.loc[parameter, 1])
        rows.append(
            {
                "predictor": parameter,
                "coefficient": round(float(fitted.params[parameter]), 6),
                "ci_lower_95": round(lower, 6),
                "ci_upper_95": round(upper, 6),
                "p_value": round(float(fitted.pvalues[parameter]), 6),
            }
        )

    metrics = [
        AnalysisMetric(name="analysis_method", value="gee_exchangeable"),
        AnalysisMetric(name="subjects_used", value=int(frame[subject_col].nunique())),
        AnalysisMetric(name="observations_used", value=int(frame.shape[0])),
        AnalysisMetric(name="predictor_columns", value=int(len(rows))),
        AnalysisMetric(name="outcome_type", value="binary" if is_binary else "continuous"),
    ]

    return AnalysisRunResponse(
        status="executable",
        executed=True,
        analysis_family="mixed_model",
        workspace_id=workspace_id,
        interpretation="Computed a repeated-measures GEE model to estimate within-subject change over time and treatment-by-time effects.",
        metrics=metrics,
        table=AnalysisTable(
            title="Repeated-measures coefficient table",
            columns=["predictor", "coefficient", "ci_lower_95", "ci_upper_95", "p_value"],
            rows=rows,
        ),
        warnings=[
            "Repeated-measures output currently uses an exchangeable GEE working correlation rather than a full random-effects mixed model.",
            "When multiple repeated parameters exist, verify that the selected endpoint label matches the intended measurement series.",
        ],
        explanation="Deterministic repeated-measures analysis executed on the FastAPI workspace.",
    )


def run_threshold_search_analysis(
    workspace_id: str,
    workspace: pd.DataFrame,
    metadata: dict[str, str | int | list[str] | None],
    spec: AnalysisSpec | None,
) -> AnalysisRunResponse:
    outcome_col = str(metadata.get("outcome_column") or "")
    if not outcome_col or outcome_col not in workspace.columns:
        raise ValueError("Threshold search requires a derived binary outcome column in the workspace.")

    frame = workspace.copy()
    frame[outcome_col] = pd.to_numeric(frame[outcome_col], errors="coerce")
    frame = frame[frame[outcome_col].isin([0, 1])].copy()
    if frame.empty:
        raise ValueError("Threshold search has no usable binary outcome rows after preprocessing.")
    if frame[outcome_col].nunique() < 2:
        raise ValueError("Threshold search requires both outcome classes to be present.")

    preferred = list(spec.threshold_variables) if spec and spec.threshold_variables else []
    candidate_columns = [column for column in preferred if column in frame.columns]
    if not candidate_columns:
        candidate_columns = [
            column
            for column in frame.columns
            if column != outcome_col
            and any(token in column for token in ("AE_EARLY_EVENT_FLAG", "AE_FIRST_QUALIFYING_DAY", "AE_QUALIFYING_EVENT_COUNT", "EX_", "LAB_", "AGE"))
        ]

    scored_rows: list[dict[str, str | float | int]] = []
    metric_name = spec.threshold_metric if spec and spec.threshold_metric else "balanced_accuracy"
    for column in candidate_columns[:10]:
        values = pd.to_numeric(frame[column], errors="coerce")
        valid = pd.DataFrame({"predictor": values, "outcome": frame[outcome_col]}).dropna()
        unique_count = int(valid["predictor"].nunique())
        if valid.shape[0] < 6 or unique_count < 2:
            continue

        if unique_count == 2:
            thresholds = [float(sorted(valid["predictor"].unique())[-1])]
        else:
            quantiles = valid["predictor"].quantile([0.2, 0.35, 0.5, 0.65, 0.8]).dropna().unique().tolist()
            thresholds = sorted(set(float(value) for value in quantiles))
        if not thresholds:
            continue

        best: dict[str, str | float | int] | None = None
        for direction in ("gte", "lte"):
            for threshold in thresholds:
                predictions = (valid["predictor"] >= threshold).astype(int) if direction == "gte" else (valid["predictor"] <= threshold).astype(int)
                if predictions.nunique() < 2:
                    continue
                balanced_accuracy = float(balanced_accuracy_score(valid["outcome"], predictions))
                sensitivity = float(((predictions == 1) & (valid["outcome"] == 1)).sum() / max(1, int((valid["outcome"] == 1).sum())))
                specificity = float(((predictions == 0) & (valid["outcome"] == 0)).sum() / max(1, int((valid["outcome"] == 0).sum())))
                f1_value = float(f1_score(valid["outcome"], predictions))
                score = balanced_accuracy if metric_name == "balanced_accuracy" else sensitivity + specificity - 1 if metric_name == "youden_j" else f1_value
                candidate = {
                    "predictor": column,
                    "direction": direction,
                    "threshold": round(threshold, 6),
                    "balanced_accuracy": round(balanced_accuracy, 6),
                    "sensitivity": round(sensitivity, 6),
                    "specificity": round(specificity, 6),
                    "f1": round(f1_value, 6),
                    "score": round(score, 6),
                }
                if best is None or float(candidate["score"]) > float(best["score"]):
                    best = candidate

        if best is not None:
            scored_rows.append(best)

    if not scored_rows:
        raise ValueError("Threshold search could not find any usable numeric predictors with enough variation.")

    ranked = sorted(scored_rows, key=lambda row: float(row["score"]), reverse=True)
    top = ranked[0]
    metrics = [
        AnalysisMetric(name="analysis_method", value="threshold_search"),
        AnalysisMetric(name="subjects_used", value=int(frame.shape[0])),
        AnalysisMetric(name="candidate_predictors", value=int(len(scored_rows))),
        AnalysisMetric(name="top_predictor", value=str(top["predictor"])),
        AnalysisMetric(name="optimization_metric", value=str(metric_name)),
    ]

    return AnalysisRunResponse(
        status="executable",
        executed=True,
        analysis_family="threshold_search",
        workspace_id=workspace_id,
        interpretation="Computed exploratory threshold candidates to flag later treatment persistence risk from early-event and baseline predictors.",
        metrics=metrics,
        table=AnalysisTable(
            title="Threshold search ranking",
            columns=["predictor", "direction", "threshold", "balanced_accuracy", "sensitivity", "specificity", "f1", "score"],
            rows=ranked[:15],
        ),
        warnings=[
            "Threshold search is exploratory and should be validated on a holdout cohort or reference implementation before operational use.",
            "Balanced accuracy ranking does not guarantee clinical utility or causal interpretation.",
        ],
        explanation="Exploratory threshold-search analysis executed on the FastAPI workspace.",
    )


def run_competing_risks_analysis(
    workspace_id: str,
    workspace: pd.DataFrame,
    metadata: dict[str, str | int | list[str] | None],
    spec: AnalysisSpec | None,
) -> AnalysisRunResponse:
    treatment_col = str(metadata.get("treatment_column") or "")
    time_col = str(metadata.get("competing_time_column") or "")
    event_col = str(metadata.get("competing_event_column") or "")

    if not treatment_col or not time_col or not event_col:
        raise ValueError("Competing-risks analysis requires treatment, competing-event time, and competing-event code metadata.")
    if any(column not in workspace.columns for column in (treatment_col, time_col, event_col)):
        raise ValueError("Workspace does not contain the required competing-risk columns.")

    frame = workspace[[treatment_col, time_col, event_col]].copy()
    frame[time_col] = pd.to_numeric(frame[time_col], errors="coerce")
    frame[event_col] = pd.to_numeric(frame[event_col], errors="coerce")
    frame = frame.dropna(subset=[time_col, event_col])
    if frame.empty:
        raise ValueError("Competing-risks analysis has no usable rows after preprocessing.")

    rows: list[dict[str, str | float | int]] = []
    for group, group_frame in frame.groupby(treatment_col, dropna=False):
        if AalenJohansenFitter is not None:
            fitter = AalenJohansenFitter()
            fitter.fit(group_frame[time_col], group_frame[event_col].astype(int), event_of_interest=1)
            cif_value = float(fitter.cumulative_density_.iloc[-1, 0]) if not fitter.cumulative_density_.empty else 0.0
        else:
            cif_value = float((group_frame[event_col] == 1).sum() / max(1, group_frame.shape[0]))
        rows.append(
            {
                treatment_col: str(group),
                "n": int(group_frame.shape[0]),
                "event_of_interest_n": int((group_frame[event_col] == 1).sum()),
                "competing_event_n": int((group_frame[event_col] == 2).sum()),
                "cumulative_incidence": round(cif_value, 6),
            }
        )

    metrics = [
        AnalysisMetric(name="analysis_method", value="aalen_johansen_cumulative_incidence" if AalenJohansenFitter is not None else "crude_cumulative_incidence"),
        AnalysisMetric(name="groups", value=int(len(rows))),
        AnalysisMetric(name="subjects_used", value=int(frame.shape[0])),
        AnalysisMetric(name="event_of_interest_subjects", value=int((frame[event_col] == 1).sum())),
        AnalysisMetric(name="competing_event_subjects", value=int((frame[event_col] == 2).sum())),
    ]

    warnings: list[str] = []
    if AalenJohansenFitter is None:
        warnings.append("Aalen-Johansen fitter was unavailable, so the cumulative-incidence estimate fell back to crude event proportions.")
    warnings.append("Fine-Gray regression is not implemented yet; this output is a group-level cumulative-incidence summary.")

    return AnalysisRunResponse(
        status="executable",
        executed=True,
        analysis_family="competing_risks",
        workspace_id=workspace_id,
        interpretation="Computed cumulative-incidence summaries for discontinuation while treating death as a competing event.",
        metrics=metrics,
        table=AnalysisTable(
            title="Competing-risks cumulative incidence by treatment group",
            columns=[treatment_col, "n", "event_of_interest_n", "competing_event_n", "cumulative_incidence"],
            rows=rows,
        ),
        warnings=warnings,
        explanation="Deterministic competing-risks analysis executed on the FastAPI workspace.",
    )


def run_feature_importance_analysis(
    workspace_id: str,
    workspace: pd.DataFrame,
    metadata: dict[str, str | int | list[str] | None],
    spec: AnalysisSpec | None,
) -> AnalysisRunResponse:
    outcome_col, design, outcome, warnings = _prepare_ml_analysis_frame(workspace, metadata, spec)
    model = RandomForestClassifier(
        n_estimators=300,
        random_state=42,
        min_samples_leaf=2,
        class_weight="balanced",
    )
    model.fit(design, outcome)

    importances = (
        pd.Series(model.feature_importances_, index=design.columns)
        .sort_values(ascending=False)
        .head(20)
    )
    table = AnalysisTable(
        title="Exploratory feature importance ranking",
        columns=["predictor", "importance"],
        rows=[
            {
                "predictor": str(predictor),
                "importance": round(float(importance), 6),
            }
            for predictor, importance in importances.items()
        ],
    )

    metrics = [
        AnalysisMetric(name="analysis_method", value="random_forest_feature_importance"),
        AnalysisMetric(name="subjects_used", value=int(design.shape[0])),
        AnalysisMetric(name="event_subjects", value=int(outcome.sum())),
        AnalysisMetric(name="candidate_predictors", value=int(design.shape[1])),
        AnalysisMetric(name="top_predictor", value=str(importances.index[0] if not importances.empty else "none")),
    ]
    warnings.extend(
        [
            "Feature importance is exploratory and should not be treated as confirmatory evidence without a pre-specified model.",
            "Tree-based importances can be unstable when predictors are correlated or sparse.",
        ]
    )

    return AnalysisRunResponse(
        status="executable",
        executed=True,
        analysis_family="feature_importance",
        workspace_id=workspace_id,
        interpretation=(
            "Computed exploratory random-forest feature importances for the derived binary endpoint using the row-level FastAPI workspace."
        ),
        metrics=metrics,
        table=table,
        warnings=warnings,
        explanation="Exploratory feature importance executed on the FastAPI workspace.",
    )


def run_partial_dependence_analysis(
    workspace_id: str,
    workspace: pd.DataFrame,
    metadata: dict[str, str | int | list[str] | None],
    spec: AnalysisSpec | None,
) -> AnalysisRunResponse:
    outcome_col, design, outcome, warnings = _prepare_ml_analysis_frame(workspace, metadata, spec)
    model = RandomForestClassifier(
        n_estimators=300,
        random_state=42,
        min_samples_leaf=2,
        class_weight="balanced",
    )
    model.fit(design, outcome)

    importances = pd.Series(model.feature_importances_, index=design.columns).sort_values(ascending=False)
    top_features = [feature for feature in importances.index[:3]]
    if not top_features:
        raise ValueError("Partial dependence requires at least one informative predictor.")

    rows: list[dict[str, str | float | int]] = []
    for feature in top_features:
        pd_result = partial_dependence(
            model,
            design,
            [feature],
            grid_resolution=20,
            kind="average",
        )
        feature_values = pd_result["grid_values"][0]
        averages = pd_result["average"][0]
        for feature_value, average in zip(feature_values, averages):
            rows.append(
                {
                    "feature": str(feature),
                    "feature_value": round(float(feature_value), 6),
                    "partial_dependence": round(float(average), 6),
                }
            )

    table = AnalysisTable(
        title="Exploratory partial dependence summary",
        columns=["feature", "feature_value", "partial_dependence"],
        rows=rows,
    )
    metrics = [
        AnalysisMetric(name="analysis_method", value="random_forest_partial_dependence"),
        AnalysisMetric(name="subjects_used", value=int(design.shape[0])),
        AnalysisMetric(name="event_subjects", value=int(outcome.sum())),
        AnalysisMetric(name="candidate_predictors", value=int(design.shape[1])),
        AnalysisMetric(name="features_profiled", value=int(len(top_features))),
    ]
    warnings.extend(
        [
            "Partial dependence is exploratory and reflects the fitted random-forest model rather than a confirmatory effect estimate.",
            "Partial dependence values are averaged over the observed covariate distribution after preprocessing and one-hot encoding.",
        ]
    )

    return AnalysisRunResponse(
        status="executable",
        executed=True,
        analysis_family="partial_dependence",
        workspace_id=workspace_id,
        interpretation=(
            "Computed exploratory partial dependence summaries for the highest-importance predictors in the FastAPI workspace."
        ),
        metrics=metrics,
        table=table,
        warnings=warnings,
        explanation="Exploratory partial dependence executed on the FastAPI workspace.",
    )


def _get_survival_columns(
    workspace: pd.DataFrame,
    metadata: dict[str, str | int | list[str] | None],
) -> tuple[str, str, str]:
    treatment_col = str(metadata.get("treatment_column") or "")
    time_col = str(metadata.get("survival_time_column") or "")
    event_col = str(metadata.get("survival_event_column") or "")
    missing = [column_name for column_name, value in (("treatment", treatment_col), ("time", time_col), ("event", event_col)) if not value]
    if missing:
        raise ValueError(f"Workspace metadata is missing required survival columns: {', '.join(missing)}.")
    if any(column not in workspace.columns for column in (treatment_col, time_col, event_col)):
        raise ValueError("Workspace does not contain the required treatment, time, and event columns for survival analysis.")
    return treatment_col, time_col, event_col


def _prepare_ml_analysis_frame(
    workspace: pd.DataFrame,
    metadata: dict[str, str | int | list[str] | None],
    spec: AnalysisSpec | None,
) -> tuple[str, pd.DataFrame, pd.Series, list[str]]:
    outcome_col = str(metadata.get("outcome_column") or "")
    if not outcome_col or outcome_col not in workspace.columns:
        raise ValueError("Workspace does not contain the derived binary outcome column required for exploratory ML.")

    candidate_covariates = _select_logistic_covariates(workspace, metadata, spec)
    treatment_col = str(metadata.get("treatment_column") or "")
    if treatment_col and treatment_col in workspace.columns and treatment_col not in candidate_covariates:
        candidate_covariates.insert(0, treatment_col)

    candidate_covariates = [
        column
        for column in candidate_covariates
        if column in workspace.columns and column != outcome_col
    ]
    if not candidate_covariates:
        raise ValueError("No usable predictors were detected for exploratory ML.")

    frame = workspace[[outcome_col, *candidate_covariates]].copy()
    frame[outcome_col] = pd.to_numeric(frame[outcome_col], errors="coerce")
    frame = frame[frame[outcome_col].isin([0, 1])].copy()
    if frame.empty:
        raise ValueError("Exploratory ML has no usable binary outcome rows after preprocessing.")

    warnings: list[str] = []
    prepared_predictors: dict[str, pd.Series] = {}
    for column in candidate_covariates:
        prepared = _prepare_predictor_series(frame[column])
        if prepared is None:
            warnings.append(f"Skipped predictor {column} because it was empty or constant in the analysis subset.")
            continue
        prepared_predictors[column] = prepared

    if not prepared_predictors:
        raise ValueError("All exploratory ML predictors were constant or missing after preprocessing.")

    predictor_frame = pd.DataFrame(prepared_predictors, index=frame.index)
    numeric_columns = predictor_frame.select_dtypes(include=["number"]).columns.tolist()
    categorical_columns = [column for column in predictor_frame.columns if column not in numeric_columns]

    if numeric_columns:
        predictor_frame[numeric_columns] = predictor_frame[numeric_columns].apply(
            lambda column: column.fillna(column.median())
        )
    if categorical_columns:
        predictor_frame[categorical_columns] = predictor_frame[categorical_columns].astype(str).replace("", "__MISSING__")
        predictor_frame[categorical_columns] = predictor_frame[categorical_columns].fillna("__MISSING__")

    design = pd.get_dummies(predictor_frame, drop_first=False, dtype=float)
    design = design.loc[:, design.nunique(dropna=False) > 1]
    if design.empty:
        raise ValueError("Exploratory ML encoding produced no informative predictor columns.")

    outcome = frame[outcome_col].astype(int)
    if outcome.nunique() < 2:
        raise ValueError("Exploratory ML requires both outcome classes to be present.")

    return outcome_col, design, outcome, warnings
