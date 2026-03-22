from __future__ import annotations

from dataclasses import dataclass, field
import re

from ..models.analysis import AnalysisFamily


@dataclass(frozen=True)
class EndpointTemplate:
    target_definition: str | None = None
    endpoint_label: str | None = None
    required_roles: tuple[str, ...] = field(default_factory=tuple)
    time_window_days: int | None = None
    term_filters: tuple[str, ...] = field(default_factory=tuple)
    requested_outputs: tuple[str, ...] = field(default_factory=tuple)
    interaction_terms: tuple[str, ...] = field(default_factory=tuple)
    threshold_variables: tuple[str, ...] = field(default_factory=tuple)
    threshold_metric: str | None = None
    notes: tuple[str, ...] = field(default_factory=tuple)


def resolve_endpoint_template(question: str, family: AnalysisFamily) -> EndpointTemplate:
    lowered = question.lower()

    if "time to resolution" in lowered or "resolution" in lowered:
        return EndpointTemplate(
            target_definition="time_to_resolution_grade_2_plus_dae",
            endpoint_label="Time to resolution of Grade >=2 dermatologic adverse events",
            required_roles=("ADSL", "ADAE"),
            term_filters=_default_term_filters(lowered),
            requested_outputs=("hazard_ratio", "confidence_interval", "model_summary"),
            interaction_terms=("treatment*all",) if "differ by arm" in lowered else (),
            notes=("Requires AE end-day or duration fields for derived time-to-resolution modeling.",),
        )

    if any(token in lowered for token in ("earlier onset", "time to onset", "time to first", "onset")):
        return EndpointTemplate(
            target_definition="time_to_first_grade_2_plus_dae",
            endpoint_label="Time to first Grade >=2 dermatologic adverse event",
            required_roles=("ADSL", "ADAE"),
            term_filters=_default_term_filters(lowered),
            requested_outputs=("hazard_ratio", "confidence_interval", "model_summary"),
            interaction_terms=("treatment*dose",) if _mentions_dose(lowered) else (),
            notes=("Uses derived adverse-event onset timing when ADTTE is not available.",),
        )

    if family == "competing_risks" or any(token in lowered for token in ("competing risk", "competing risks")):
        return EndpointTemplate(
            target_definition="cumulative_incidence_of_discontinuation",
            endpoint_label="Cumulative incidence with competing events",
            required_roles=("ADSL", "DS"),
            requested_outputs=("cumulative_incidence", "group_summary", "event_breakdown"),
            notes=("Uses disposition timing to derive event-of-interest and competing-event codes.",),
        )

    if any(token in lowered for token in ("threshold", "cutoff", "cut-off", "early warning", "best predict", "warning threshold")):
        return EndpointTemplate(
            target_definition="later_treatment_discontinuation",
            endpoint_label="Threshold search for later persistence risk",
            required_roles=("ADSL", "ADAE", "DS"),
            time_window_days=28 if any(token in lowered for token in ("weeks 1-4", "weeks 1 to 4", "week 1-4")) else None,
            term_filters=_default_term_filters(lowered),
            requested_outputs=("threshold_ranking", "sensitivity_specificity", "confusion_summary"),
            threshold_variables=("AE_FIRST_QUALIFYING_DAY", "AE_QUALIFYING_EVENT_COUNT", "AGE"),
            threshold_metric="balanced_accuracy",
            notes=("Evaluates early warning cutoffs for later treatment persistence outcomes.",),
        )

    if any(token in lowered for token in ("repeated", "longitudinal", "trajectory", "trend over time", "mixed model", "visit-level")):
        return EndpointTemplate(
            target_definition="repeated_measure_change",
            endpoint_label="Repeated-measures trend",
            required_roles=("ADSL", "ADLB"),
            requested_outputs=("coefficient_table", "trend_summary", "interaction_terms"),
            interaction_terms=("treatment*time",),
            notes=("Requires a repeated measurement source such as ADLB with visit/day information.",),
        )

    if any(token in lowered for token in ("adherence", "compliance", "discontinuation", "interrupt", "reduction", "non-persistence")):
        return EndpointTemplate(
            target_definition="later_treatment_discontinuation",
            endpoint_label="Later treatment discontinuation or non-persistence",
            required_roles=("ADSL", "ADAE", "DS"),
            time_window_days=28 if any(token in lowered for token in ("weeks 1-4", "weeks 1 to 4", "week 1-4")) else None,
            term_filters=_default_term_filters(lowered),
            requested_outputs=("coefficient_table", "odds_ratios", "confidence_interval"),
            notes=("Requires disposition/compliance input to derive downstream treatment persistence endpoints.",),
        )

    if family in {"incidence", "risk_difference", "logistic_regression"} and "week 12" in lowered:
        return EndpointTemplate(
            target_definition="grade_2_plus_dae_by_week_12",
            endpoint_label="Grade >=2 dermatologic adverse event by Week 12",
            required_roles=("ADSL", "ADAE"),
            time_window_days=84,
            term_filters=_default_term_filters(lowered),
            requested_outputs=("contingency_table", "risk_difference", "confidence_interval")
            if family in {"incidence", "risk_difference"}
            else ("coefficient_table", "odds_ratios", "confidence_interval"),
        )

    if family in {"feature_importance", "partial_dependence"}:
        return EndpointTemplate(
            target_definition="grade_2_plus_dae_by_week_12" if "week 12" in lowered else None,
            endpoint_label="Exploratory predictors of derived adverse-event endpoint",
            required_roles=("ADSL", "ADAE", "ADLB"),
            time_window_days=84 if "week 12" in lowered else None,
            term_filters=_default_term_filters(lowered),
            requested_outputs=("feature_importance", "partial_dependence", "model_summary"),
        )

    return EndpointTemplate()


def _default_term_filters(question: str) -> tuple[str, ...]:
    if any(token in question for token in ("dermat", "rash", "skin")):
        return ("rash", "dermatologic", "erythema", "skin")
    return ()


def _mentions_dose(question: str) -> bool:
    return any(token in question for token in ("dose", "dosing", "weight", "exposure", ">80 kg", "80 kg"))
