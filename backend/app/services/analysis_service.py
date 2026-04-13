from __future__ import annotations

from dataclasses import dataclass
import re
from typing import Iterable
from uuid import uuid4

from ..config import get_settings
from .deterministic_runner import (
    run_competing_risks_analysis,
    run_cox_analysis,
    run_feature_importance_analysis,
    run_incidence_analysis,
    run_kaplan_meier_analysis,
    run_logistic_regression,
    run_mixed_model_analysis,
    run_partial_dependence_analysis,
    run_threshold_search_analysis,
)
from .endpoint_templates import resolve_endpoint_template
from .workspace_repository import FileWorkspaceRepository
from .workspace_builder import build_workspace, infer_role
from ..models.analysis import (
    AnalysisCapabilityAssessment,
    AnalysisCapabilityRequest,
    AnalysisCapabilityResponse,
    CapabilityBlockerStage,
    AnalysisExecutionReceipt,
    AnalysisFamily,
    AnalysisFilter,
    AnalysisMetric,
    AnalysisPlanRequest,
    AnalysisPlanResponse,
    AnalysisRunRequest,
    AnalysisRunResponse,
    AnalysisSpec,
    AnalysisTable,
    CapabilityStatus,
    DatasetReference,
    WorkspaceBuildRequest,
    WorkspaceBuildResponse,
)


ADVANCED_KEYWORDS: tuple[tuple[str, AnalysisFamily], ...] = (
    ("repeated measures", "mixed_model"),
    ("repeated-measures", "mixed_model"),
    ("longitudinal", "mixed_model"),
    ("mixed model", "mixed_model"),
    ("trajectory", "mixed_model"),
    ("trend over time", "mixed_model"),
    ("threshold", "threshold_search"),
    ("cutoff", "threshold_search"),
    ("cut-off", "threshold_search"),
    ("early warning", "threshold_search"),
    ("competing risk", "competing_risks"),
    ("competing risks", "competing_risks"),
    ("cumulative incidence", "competing_risks"),
    ("feature importance", "feature_importance"),
    ("ranked feature importance", "feature_importance"),
    ("strongest predictors", "feature_importance"),
    ("key drivers", "feature_importance"),
    ("partial dependence", "partial_dependence"),
    ("time to resolution", "cox"),
    ("earlier onset", "cox"),
    ("time to onset", "cox"),
    ("time to first", "cox"),
    ("risk difference", "risk_difference"),
    ("logistic", "logistic_regression"),
    ("odds ratio", "logistic_regression"),
    ("hazard ratio", "cox"),
    ("cox", "cox"),
    ("survival", "kaplan_meier"),
    ("week 12", "incidence"),
    ("incidence", "incidence"),
)


@dataclass(frozen=True)
class CapabilityResult:
    status: CapabilityStatus
    family: AnalysisFamily
    missing_roles: list[str]
    requires_row_level_data: bool
    warnings: list[str]
    explanation: str
    blocker_stage: CapabilityBlockerStage
    blocker_reason: str | None
    recommended_next_step: str | None
    fallback_option: str | None
    data_requirements: list[str]
    method_constraints: list[str]


@dataclass(frozen=True)
class UnsupportedMethodGap:
    family: AnalysisFamily
    reason: str
    recommended_next_step: str
    fallback_option: str
    method_constraints: list[str]
    data_requirements: list[str]


class AnalysisService:
    def __init__(self) -> None:
        settings = get_settings()
        self._workspace_store = FileWorkspaceRepository(settings.workspace_store_dir)

    def classify_capabilities(self, payload: AnalysisCapabilityRequest) -> AnalysisCapabilityResponse:
        result = self._classify(payload.question, payload.datasets)
        return AnalysisCapabilityResponse(
            status=result.status,
            analysis_family=result.family,
            executable=result.status == "executable",
            requires_row_level_data=result.requires_row_level_data,
            missing_roles=result.missing_roles,
            warnings=result.warnings,
            explanation=result.explanation,
            assessment=self._build_assessment(result),
        )

    def build_plan(self, payload: AnalysisPlanRequest) -> AnalysisPlanResponse:
        result = self._classify(payload.question, payload.datasets)
        spec = None
        if result.status != "unsupported":
            spec = self._build_spec(payload.question, result.family)

        return AnalysisPlanResponse(
            status=result.status,
            spec=spec,
            missing_roles=result.missing_roles,
            warnings=result.warnings,
            explanation=result.explanation,
            assessment=self._build_assessment(result),
        )

    def build_workspace(self, payload: WorkspaceBuildRequest) -> WorkspaceBuildResponse:
        result = self._classify(payload.question, payload.datasets)
        if result.status != "executable":
            return WorkspaceBuildResponse(
                status=result.status,
                missing_roles=result.missing_roles,
                source_names=[dataset.name for dataset in payload.datasets],
                notes=result.warnings,
                explanation=result.explanation,
            )

        try:
            effective_spec = payload.spec or self._build_spec(payload.question, result.family)
            built = build_workspace(payload.question, payload.datasets, effective_spec)
        except ValueError as error:
            return WorkspaceBuildResponse(
                status="missing_data",
                source_names=[dataset.name for dataset in payload.datasets],
                notes=result.warnings,
                explanation=str(error),
            )

        workspace_id = f"ws_{uuid4().hex[:12]}"
        self._workspace_store.save(
            workspace_id,
            built.dataframe,
            built.metadata,
            built.source_names,
            built.notes,
            built.derived_columns,
        )

        preview_columns = list(built.dataframe.columns[: min(8, len(built.dataframe.columns))])
        preview_table = AnalysisTable(
            title="Workspace preview",
            columns=preview_columns,
            rows=built.dataframe.head(5)[preview_columns].fillna("").to_dict(orient="records"),
        )

        return WorkspaceBuildResponse(
            status="executable",
            workspace_id=workspace_id,
            source_names=built.source_names,
            row_count=int(built.dataframe.shape[0]),
            column_count=int(built.dataframe.shape[1]),
            derived_columns=built.derived_columns,
            preview_table=preview_table,
            notes=built.notes,
            explanation="Row-level analysis workspace built successfully.",
        )

    def run_analysis(self, payload: AnalysisRunRequest) -> AnalysisRunResponse:
        result = self._classify(payload.question, payload.datasets)
        if result.status != "executable":
            return AnalysisRunResponse(
                status=result.status,
                analysis_family=result.family,
                executed=False,
                warnings=result.warnings,
                explanation=result.explanation,
            )

        effective_spec = payload.spec or self._build_spec(payload.question, result.family)
        family = effective_spec.analysis_family if effective_spec else result.family
        workspace_id = payload.workspace_id or f"ws_{uuid4().hex[:12]}"
        workspace_entry = self._workspace_store.load(payload.workspace_id or "")

        if workspace_entry is None:
            try:
                built = build_workspace(payload.question, payload.datasets, effective_spec)
            except ValueError as error:
                return AnalysisRunResponse(
                    status="missing_data",
                    analysis_family=family,
                    executed=False,
                    explanation=str(error),
                )

            workspace_entry = {
                "dataframe": built.dataframe,
                "metadata": built.metadata,
                "source_names": built.source_names,
                "notes": built.notes,
                "derived_columns": built.derived_columns,
                "row_count": int(built.dataframe.shape[0]),
                "column_count": int(built.dataframe.shape[1]),
            }
            self._workspace_store.save(
                workspace_id,
                built.dataframe,
                built.metadata,
                built.source_names,
                built.notes,
                built.derived_columns,
            )
        elif payload.workspace_id:
            workspace_id = payload.workspace_id

        try:
            if family in {"incidence", "risk_difference"}:
                response = run_incidence_analysis(
                    workspace_id,
                    workspace_entry["dataframe"],  # type: ignore[arg-type]
                    workspace_entry["metadata"],  # type: ignore[arg-type]
                    family,
                )
                response.warnings.extend(result.warnings)
                response.receipt = self._build_execution_receipt(workspace_entry, payload.spec)
                return response

            if family == "logistic_regression":
                response = run_logistic_regression(
                    workspace_id,
                    workspace_entry["dataframe"],  # type: ignore[arg-type]
                    workspace_entry["metadata"],  # type: ignore[arg-type]
                    effective_spec,
                )
                response.warnings.extend(result.warnings)
                response.receipt = self._build_execution_receipt(workspace_entry, effective_spec)
                return response

            if family == "kaplan_meier":
                response = run_kaplan_meier_analysis(
                    workspace_id,
                    workspace_entry["dataframe"],  # type: ignore[arg-type]
                    workspace_entry["metadata"],  # type: ignore[arg-type]
                    family,
                )
                response.warnings.extend(result.warnings)
                response.receipt = self._build_execution_receipt(workspace_entry, payload.spec)
                return response

            if family == "cox":
                response = run_cox_analysis(
                    workspace_id,
                    workspace_entry["dataframe"],  # type: ignore[arg-type]
                    workspace_entry["metadata"],  # type: ignore[arg-type]
                    effective_spec,
                )
                response.warnings.extend(result.warnings)
                response.receipt = self._build_execution_receipt(workspace_entry, effective_spec)
                return response

            if family == "feature_importance":
                response = run_feature_importance_analysis(
                    workspace_id,
                    workspace_entry["dataframe"],  # type: ignore[arg-type]
                    workspace_entry["metadata"],  # type: ignore[arg-type]
                    effective_spec,
                )
                response.warnings.extend(result.warnings)
                response.receipt = self._build_execution_receipt(workspace_entry, effective_spec)
                return response

            if family == "partial_dependence":
                response = run_partial_dependence_analysis(
                    workspace_id,
                    workspace_entry["dataframe"],  # type: ignore[arg-type]
                    workspace_entry["metadata"],  # type: ignore[arg-type]
                    effective_spec,
                )
                response.warnings.extend(result.warnings)
                response.receipt = self._build_execution_receipt(workspace_entry, effective_spec)
                return response

            if family == "mixed_model":
                response = run_mixed_model_analysis(
                    workspace_id,
                    workspace_entry["dataframe"],  # type: ignore[arg-type]
                    workspace_entry["metadata"],  # type: ignore[arg-type]
                    effective_spec,
                )
                response.warnings.extend(result.warnings)
                response.receipt = self._build_execution_receipt(workspace_entry, effective_spec)
                return response

            if family == "threshold_search":
                response = run_threshold_search_analysis(
                    workspace_id,
                    workspace_entry["dataframe"],  # type: ignore[arg-type]
                    workspace_entry["metadata"],  # type: ignore[arg-type]
                    effective_spec,
                )
                response.warnings.extend(result.warnings)
                response.receipt = self._build_execution_receipt(workspace_entry, effective_spec)
                return response

            if family == "competing_risks":
                response = run_competing_risks_analysis(
                    workspace_id,
                    workspace_entry["dataframe"],  # type: ignore[arg-type]
                    workspace_entry["metadata"],  # type: ignore[arg-type]
                    effective_spec,
                )
                response.warnings.extend(result.warnings)
                response.receipt = self._build_execution_receipt(workspace_entry, effective_spec)
                return response
        except ValueError as error:
            return AnalysisRunResponse(
                status="missing_data",
                analysis_family=family,
                executed=False,
                workspace_id=workspace_id,
                warnings=result.warnings,
                explanation=str(error),
            )

        return AnalysisRunResponse(
            status="executable",
            executed=False,
            analysis_family=family,
            workspace_id=workspace_id,
            receipt=self._build_execution_receipt(workspace_entry, effective_spec),
            metrics=[AnalysisMetric(name="backend_status", value="unsupported_family")],
            warnings=["This analysis family has not been implemented yet in the deterministic analysis engine."],
            explanation="Workspace build is live, but this model family is still pending implementation.",
        )

    def _build_execution_receipt(
        self,
        workspace_entry: dict[str, object],
        spec: AnalysisSpec | None,
    ) -> AnalysisExecutionReceipt:
        metadata = workspace_entry.get("metadata", {})
        if not isinstance(metadata, dict):
            metadata = {}
        cohort_filters_applied = metadata.get("cohort_filter_labels")
        if isinstance(cohort_filters_applied, list):
            filters = [str(value).strip() for value in cohort_filters_applied if str(value).strip()]
        else:
            filters = []
        safe_spec = spec or AnalysisSpec()
        return AnalysisExecutionReceipt(
            source_names=[str(name) for name in workspace_entry.get("source_names", []) if str(name).strip()],
            derived_columns=[str(name) for name in workspace_entry.get("derived_columns", []) if str(name).strip()],
            row_count=int(workspace_entry.get("row_count") or 0) or None,
            column_count=int(workspace_entry.get("column_count") or 0) or None,
            subject_identifier=str(metadata.get("subject_id_column") or "") or None,
            treatment_variable=str(metadata.get("treatment_column") or safe_spec.treatment_variable or "") or None,
            outcome_variable=str(metadata.get("outcome_column") or safe_spec.outcome_variable or "") or None,
            time_variable=str(
                metadata.get("survival_time_column")
                or metadata.get("repeated_time_column")
                or metadata.get("competing_time_column")
                or safe_spec.time_variable
                or ""
            )
            or None,
            event_variable=str(
                metadata.get("survival_event_column")
                or metadata.get("competing_event_column")
                or safe_spec.event_variable
                or ""
            )
            or None,
            endpoint_label=str(metadata.get("endpoint_label") or safe_spec.endpoint_label or "") or None,
            target_definition=str(metadata.get("target_definition") or safe_spec.target_definition or "") or None,
            cohort_filters_applied=filters,
        )

    def _classify(self, question: str, datasets: Iterable[DatasetReference]) -> CapabilityResult:
        question_lower = question.lower()
        family = self._infer_family(question_lower)
        method_gap = self._detect_unsupported_method_gap(question_lower)
        if method_gap is not None:
            return CapabilityResult(
                status="unsupported",
                family=method_gap.family,
                missing_roles=[],
                requires_row_level_data=True,
                warnings=[],
                explanation=method_gap.reason,
                blocker_stage="method",
                blocker_reason=method_gap.reason,
                recommended_next_step=method_gap.recommended_next_step,
                fallback_option=method_gap.fallback_option,
                data_requirements=method_gap.data_requirements,
                method_constraints=method_gap.method_constraints,
            )

        duplicate_roles = self._detect_duplicate_roles(datasets)
        if duplicate_roles:
            formatted = "; ".join(f"{role}: {', '.join(names)}" for role, names in duplicate_roles.items())
            return CapabilityResult(
                status="missing_data",
                family=family,
                missing_roles=[],
                requires_row_level_data=True,
                warnings=["The backend no longer guesses when multiple selected datasets map to the same singleton analysis role."],
                explanation=f"Multiple selected datasets map to the same required role. Keep one file per role before execution. Conflicts: {formatted}",
                blocker_stage="selection",
                blocker_reason="Multiple selected files map to the same singleton dataset role.",
                recommended_next_step="Keep one analysis-ready file per role, remove duplicate ADSL/ADAE/ADLB/ADTTE-style files, then rerun the question.",
                fallback_option="Use AI Chat only for high-level document or metadata review until the file selection is cleaned up.",
                data_requirements=["One de-duplicated analysis-ready file for each required role."],
                method_constraints=[],
            )

        roles = self._infer_roles(datasets)
        endpoint_template = resolve_endpoint_template(question_lower, family)
        base_data_requirements = self._describe_data_requirements(family, list(endpoint_template.required_roles))

        if family in {"feature_importance", "partial_dependence"}:
            missing = self._missing_roles(roles, list(endpoint_template.required_roles or ("ADSL", "ADAE", "ADLB")))
            status: CapabilityStatus = "executable" if not missing else "missing_data"
            return CapabilityResult(
                status=status,
                family=family,
                missing_roles=missing,
                requires_row_level_data=True,
                warnings=[
                    "Exploratory ML outputs must be derived from an executed backend run, never from chat summaries.",
                ],
                explanation=(
                    "This request needs a row-level subject-event workspace with baseline covariates and a derived target."
                    if missing
                    else "This request matches the exploratory ML workflow implemented in the analysis engine."
                ),
                blocker_stage="data" if missing else "none",
                blocker_reason="Required analysis roles for exploratory ML are missing." if missing else None,
                recommended_next_step=(
                    f"Add or select the missing roles ({', '.join(missing)}) and rerun the analysis agent."
                    if missing
                    else "Run the analysis agent to execute the exploratory ML workflow on the assembled workspace."
                ),
                fallback_option=(
                    "Use AI Chat only for qualitative source review; do not treat chat output as executed ML analysis."
                    if missing
                    else "Use AI Chat for framing questions, but rely on the agent run for actual model output."
                ),
                data_requirements=self._describe_data_requirements(family, list(endpoint_template.required_roles or ("ADSL", "ADAE", "ADLB"))),
                method_constraints=[
                    "Feature importance and partial dependence are exploratory and do not establish causality.",
                ],
            )

        if family in {"incidence", "risk_difference"}:
            missing = self._missing_roles(roles, list(endpoint_template.required_roles or ("ADSL", "ADAE")))
            status = "executable" if not missing else "missing_data"
            return CapabilityResult(
                status=status,
                family=family,
                missing_roles=missing,
                requires_row_level_data=True,
                warnings=[
                    "Week-window incidence questions require event timing fields and deterministic endpoint derivation.",
                ],
                explanation=(
                    "This request needs subject-level denominators plus term-level adverse event rows."
                    if missing
                    else "This request matches the deterministic incidence workflow implemented in the analysis engine."
                ),
                blocker_stage="data" if missing else "none",
                blocker_reason="Required subject-level denominator or adverse-event rows are missing." if missing else None,
                recommended_next_step=(
                    f"Add or select the missing roles ({', '.join(missing)}) so the app can derive denominators and event incidence."
                    if missing
                    else "Run the analysis agent to compute the bounded incidence comparison on the selected data."
                ),
                fallback_option=(
                    "Use AI Chat for protocol or metadata review only until the missing clinical domains are available."
                    if missing
                    else "Use AI Chat for interpretation after the deterministic result is executed."
                ),
                data_requirements=self._describe_data_requirements(family, list(endpoint_template.required_roles or ("ADSL", "ADAE"))),
                method_constraints=[
                    "Week-window incidence questions require deterministic event timing and endpoint derivation rules.",
                ],
            )

        if family == "logistic_regression":
            missing = self._missing_roles(roles, list(endpoint_template.required_roles or ("ADSL", "ADAE")))
            if self._is_dose_or_exposure_question(question_lower) and not self._has_exposure_inputs(datasets, roles):
                missing = [*missing, "ADEX/EX or weight column"]
            status = "executable" if not missing else "missing_data"
            exposure_warnings = (
                [
                    "Exposure or weight-tier questions are executed as subject-level risk models with dose/exposure features and treatment interaction screening when mitigation language is present.",
                    "If the question does not specify an endpoint explicitly, the workspace will fall back to the default derived AE outcome for the selected datasets.",
                ]
                if self._is_exposure_risk_question(question_lower)
                else []
            )
            subgroup_warnings = (
                [
                    "Subgroup-benefit questions are executed as treatment-interaction screening against the derived binary endpoint.",
                    "If the endpoint is not explicit in the question, the workspace will fall back to the default derived AE outcome for the selected datasets.",
                ]
                if self._is_subgroup_benefit_question(question_lower)
                else []
            )
            return CapabilityResult(
                status=status,
                family=family,
                missing_roles=missing,
                requires_row_level_data=True,
                warnings=[
                    "Logistic regression assumes the derived endpoint is binary and subject-level.",
                    "Dose-tier questions work best when exposure data or baseline weight is available for deterministic feature derivation.",
                    *exposure_warnings,
                    *subgroup_warnings,
                ],
                explanation=(
                    "This request needs subject-level baseline covariates plus derived adverse-event outcomes."
                    if missing
                    else (
                        "This request matches the deterministic exposure-mitigation workflow implemented on top of the logistic regression engine."
                        if self._is_exposure_risk_question(question_lower)
                        else (
                        "This request matches the deterministic subgroup interaction workflow implemented on top of the logistic regression engine."
                        if self._is_subgroup_benefit_question(question_lower)
                        else "This request matches the deterministic logistic regression workflow implemented in the analysis engine."
                        )
                    )
                ),
                blocker_stage="data" if missing else "none",
                blocker_reason="Required subject-level predictors or derived endpoints are missing." if missing else None,
                recommended_next_step=(
                    f"Add or select the missing roles ({', '.join(missing)}) so the app can derive the endpoint and predictors."
                    if missing
                    else "Run the analysis agent to estimate the subject-level risk model on the selected workspace."
                ),
                fallback_option=(
                    "Use AI Chat for qualitative review only until the subject-level modeling inputs are available."
                    if missing
                    else "Use AI Chat to refine the question, then use the agent run for the executed model."
                ),
                data_requirements=self._describe_data_requirements(
                    family,
                    list(endpoint_template.required_roles or ("ADSL", "ADAE")),
                    include_exposure_requirement=self._is_dose_or_exposure_question(question_lower),
                ),
                method_constraints=[
                    "The implemented logistic workflow assumes a binary subject-level endpoint.",
                    "Predictor effects are associative and should not be interpreted as causal without additional methods.",
                ],
            )

        if family in {"kaplan_meier", "cox"}:
            has_adtte = "ADTTE" in roles
            has_derived_ae_survival = "ADSL" in roles and "ADAE" in roles and self._supports_derived_ae_survival(question_lower)
            missing: list[str] = []
            if not (has_adtte or has_derived_ae_survival):
                missing = ["ADTTE or ADSL + ADAE with explicit event timing"]
            if self._is_dose_or_exposure_question(question_lower) and not self._has_exposure_inputs(datasets, roles):
                missing.append("ADEX/EX or weight column")
            status = "executable" if not missing else "missing_data"
            return CapabilityResult(
                status=status,
                family=family,
                missing_roles=missing,
                requires_row_level_data=True,
                warnings=[
                    "Prefer ADTTE for formal survival endpoints; ADAE-derived time-to-event is only appropriate for bounded adverse-event onset questions.",
                    "Time-to-resolution analyses require AE start and end or duration fields; the workspace builder will reject the run when those fields are absent.",
                ],
                explanation=(
                    "This request needs an ADTTE time-to-event dataset or a derivable AE onset endpoint with explicit timing."
                    if status != "executable"
                    else (
                        "This request matches the deterministic survival workflow implemented in the analysis engine."
                        if has_adtte
                        else "This request can use a derived AE time-to-first-event workflow because the selected ADSL + ADAE datasets expose explicit event timing."
                    )
                ),
                blocker_stage="data" if missing else "none",
                blocker_reason="Explicit event timing or a formal time-to-event dataset is missing." if missing else None,
                recommended_next_step=(
                    "Select an ADTTE file, or provide ADSL + ADAE with explicit event timing and any needed exposure inputs, then rerun."
                    if missing
                    else "Run the analysis agent to execute the time-to-event workflow on the selected sources."
                ),
                fallback_option=(
                    "Use AI Chat for question framing only; survival curves and hazard estimates require an executed run."
                    if missing
                    else "Use AI Chat after execution for narrative interpretation, not as a replacement for the survival model."
                ),
                data_requirements=self._describe_data_requirements(
                    family,
                    list(endpoint_template.required_roles or ("ADSL", "ADAE")),
                    include_survival_requirement=True,
                    include_exposure_requirement=self._is_dose_or_exposure_question(question_lower),
                ),
                method_constraints=[
                    "The current survival workflow does not support time-varying covariates, recurrent-event models, or treatment switching adjustments.",
                ],
            )

        if family == "mixed_model":
            missing = self._missing_roles(roles, list(endpoint_template.required_roles or ("ADSL", "ADLB")))
            status = "executable" if not missing else "missing_data"
            return CapabilityResult(
                status=status,
                family=family,
                missing_roles=missing,
                requires_row_level_data=True,
                warnings=[
                    "Repeated-measures models require long-format visit-level rows and consistent subject identifiers.",
                    "When multiple repeated parameters exist, the planner may need a specific endpoint label or parameter hint.",
                ],
                explanation=(
                    "This request needs subject-level baseline context plus repeated measurement rows."
                    if missing
                    else "This request matches the repeated-measures workflow implemented in the analysis engine."
                ),
                blocker_stage="data" if missing else "none",
                blocker_reason="Repeated-measures source data is missing." if missing else None,
                recommended_next_step=(
                    f"Add or select the missing roles ({', '.join(missing)}) so the app can assemble a visit-level longitudinal workspace."
                    if missing
                    else "Run the analysis agent to execute the repeated-measures model."
                ),
                fallback_option=(
                    "Use AI Chat only for high-level review until a repeated-measures dataset is available."
                    if missing
                    else "Use AI Chat for follow-up interpretation once the repeated-measures output has executed."
                ),
                data_requirements=self._describe_data_requirements(family, list(endpoint_template.required_roles or ("ADSL", "ADLB"))),
                method_constraints=[
                    "The current repeated-measures workflow expects long-format rows with consistent subject and visit identifiers.",
                ],
            )

        if family == "threshold_search":
            missing = self._missing_roles(roles, list(endpoint_template.required_roles or ("ADSL", "ADAE", "DS")))
            status = "executable" if not missing else "missing_data"
            return CapabilityResult(
                status=status,
                family=family,
                missing_roles=missing,
                requires_row_level_data=True,
                warnings=[
                    "Threshold search is exploratory and should be validated against a holdout set or external reference implementation.",
                    "Later persistence endpoints require disposition or compliance timing to avoid label leakage.",
                ],
                explanation=(
                    "This request needs early-event predictors plus a downstream persistence endpoint."
                    if missing
                    else "This request matches the exploratory threshold-search workflow implemented in the analysis engine."
                ),
                blocker_stage="data" if missing else "none",
                blocker_reason="Threshold-search inputs are incomplete." if missing else None,
                recommended_next_step=(
                    f"Add or select the missing roles ({', '.join(missing)}) so the app can derive early predictors and later persistence outcomes."
                    if missing
                    else "Run the analysis agent to execute the threshold-search workflow and inspect the ranking output."
                ),
                fallback_option=(
                    "Use AI Chat for planning only until the full threshold-search inputs are present."
                    if missing
                    else "Use AI Chat for interpretation after the exploratory threshold-search run completes."
                ),
                data_requirements=self._describe_data_requirements(family, list(endpoint_template.required_roles or ("ADSL", "ADAE", "DS"))),
                method_constraints=[
                    "Threshold-search results are exploratory and require validation before operational use.",
                ],
            )

        if family == "competing_risks":
            missing = self._missing_roles(roles, list(endpoint_template.required_roles or ("ADSL", "DS")))
            status = "executable" if not missing else "missing_data"
            return CapabilityResult(
                status=status,
                family=family,
                missing_roles=missing,
                requires_row_level_data=True,
                warnings=[
                    "Competing-risk output currently provides nonparametric cumulative-incidence summaries rather than a full Fine-Gray regression.",
                ],
                explanation=(
                    "This request needs event timing with distinguishable event-of-interest and competing-event definitions."
                    if missing
                    else "This request matches the competing-risks workflow implemented in the analysis engine."
                ),
                blocker_stage="data" if missing else "none",
                blocker_reason="Disposition or competing-event timing inputs are missing." if missing else None,
                recommended_next_step=(
                    f"Add or select the missing roles ({', '.join(missing)}) so the app can derive event-of-interest and competing-event status."
                    if missing
                    else "Run the analysis agent to compute the cumulative-incidence summary on the selected data."
                ),
                fallback_option=(
                    "Use AI Chat for protocol review only until disposition timing is available."
                    if missing
                    else "Use AI Chat for interpretation after the executed competing-risk summary."
                ),
                data_requirements=self._describe_data_requirements(family, list(endpoint_template.required_roles or ("ADSL", "DS")), include_survival_requirement=True),
                method_constraints=[
                    "The current implementation provides nonparametric cumulative-incidence summaries, not full Fine-Gray regression.",
                ],
            )

        return CapabilityResult(
            status="unsupported",
            family="unknown",
            missing_roles=[],
            requires_row_level_data=False,
            warnings=[],
            explanation="The planner could not classify this question yet. Extend the supported analysis rules before allowing fallback analysis.",
            blocker_stage="planner",
            blocker_reason="The question did not map to a supported deterministic analysis family.",
            recommended_next_step="Rewrite the question with a specific endpoint, population, time window, and analysis objective, or extend the planner rules for this question type.",
            fallback_option="Use AI Chat for qualitative review only and do not present the output as executed analysis.",
            data_requirements=base_data_requirements,
            method_constraints=self._infer_unknown_method_constraints(question_lower),
        )

    def _infer_family(self, question: str) -> AnalysisFamily:
        if self._is_subgroup_benefit_question(question):
            return "logistic_regression"
        if self._is_exposure_risk_question(question):
            if any(token in question for token in ("time to", "onset", "resolution", "survival", "hazard")):
                return "cox"
            return "logistic_regression"
        if any(token in question for token in ("repeated measures", "repeated-measures", "longitudinal", "mixed model", "trajectory", "trend over time", "visit-level")):
            return "mixed_model"
        if any(token in question for token in ("threshold", "cutoff", "cut-off", "early warning", "warning threshold", "best predict")):
            return "threshold_search"
        if "risk difference" in question:
            return "risk_difference"
        if any(token in question for token in ("competing risk", "competing risks", "cumulative incidence")):
            return "competing_risks"
        if any(token in question for token in ("adherence", "compliance", "discontinuation", "interrupt", "reduction", "non-persistence")):
            return "logistic_regression"
        if any(token in question for token in ("time to resolution", "resolution", "earlier onset", "time to onset", "time to first", "onset")):
            return "cox"
        if any(token in question for token in ("feature importance", "ranked feature importance", "partial dependence")):
            return "partial_dependence" if "partial dependence" in question else "feature_importance"
        if "strongest predictors" in question or "key drivers" in question:
            return "feature_importance"
        if ("predict" in question or "predictor" in question or "predictors" in question or "factor" in question):
            if "time to" in question or "resolution" in question or "survival" in question:
                return "cox"
            if "week 12" in question or "grade" in question or "adverse event" in question or "ae " in question:
                return "logistic_regression"
        for token, family in ADVANCED_KEYWORDS:
            if token in question:
                return family
        return "unknown"

    def _infer_roles(self, datasets: Iterable[DatasetReference]) -> set[str]:
        roles: set[str] = set()
        for dataset in datasets:
            inferred_role = infer_role(dataset)
            if inferred_role:
                roles.add(inferred_role)
        return roles

    def _detect_duplicate_roles(self, datasets: Iterable[DatasetReference]) -> dict[str, list[str]]:
        singleton_roles = {"ADSL", "ADAE", "ADLB", "ADTTE", "ADEX", "EX", "DS"}
        matched: dict[str, list[str]] = {}
        for dataset in datasets:
            inferred_role = infer_role(dataset)
            if inferred_role and inferred_role in singleton_roles:
                matched.setdefault(inferred_role, []).append(dataset.name)
        return {role: names for role, names in matched.items() if len(names) > 1}

    def _missing_roles(self, roles: set[str], required_roles: list[str]) -> list[str]:
        return [role for role in required_roles if role not in roles]

    def _build_assessment(self, result: CapabilityResult) -> AnalysisCapabilityAssessment:
        support_level = (
            "supported"
            if result.status == "executable"
            else "partial"
            if result.status == "missing_data"
            else "unsupported"
        )
        return AnalysisCapabilityAssessment(
            support_level=support_level,
            blocker_stage=result.blocker_stage,
            blocker_reason=result.blocker_reason,
            recommended_next_step=result.recommended_next_step,
            fallback_option=result.fallback_option,
            data_requirements=result.data_requirements,
            method_constraints=result.method_constraints,
        )

    def _describe_data_requirements(
        self,
        family: AnalysisFamily,
        required_roles: list[str],
        *,
        include_survival_requirement: bool = False,
        include_exposure_requirement: bool = False,
    ) -> list[str]:
        requirements: list[str] = []
        if required_roles:
            requirements.append(f"Required dataset roles: {', '.join(required_roles)}.")
        if family in {"incidence", "risk_difference", "logistic_regression"}:
            requirements.append("Subject-level denominators plus row-level event outcomes are needed.")
        if family in {"kaplan_meier", "cox"} or include_survival_requirement:
            requirements.append("Explicit event timing is required through ADTTE or derivable event dates/durations.")
        if family == "mixed_model":
            requirements.append("Repeated measurement rows with visit or day information are required.")
        if family == "threshold_search":
            requirements.append("Both early predictors and a downstream persistence endpoint are required.")
        if family == "competing_risks":
            requirements.append("Event-of-interest timing and a distinguishable competing-event definition are required.")
        if family in {"feature_importance", "partial_dependence"}:
            requirements.append("A derived subject-level target plus baseline covariates are required.")
        if include_exposure_requirement:
            requirements.append("Exposure, dosing, or baseline weight information is required for deterministic dose/exposure features.")
        return requirements

    def _infer_unknown_method_constraints(self, question: str) -> list[str]:
        constraints: list[str] = []
        unsupported_tokens: tuple[tuple[tuple[str, ...], str], ...] = (
            (("non-inferiority", "noninferiority", "equivalence margin"), "Formal non-inferiority or equivalence testing is not implemented."),
            (("multiplicity", "hierarchical testing", "alpha spending", "interim analysis"), "Multiplicity control and formal testing hierarchies are not implemented."),
            (("propensity", "iptw", "inverse probability", "matching", "causal"), "Causal-adjustment workflows are not implemented in the deterministic engine."),
            (("time-varying", "multi-state", "recurrent event", "andersen-gill"), "Advanced survival extensions are not implemented in the deterministic engine."),
            (("fine-gray", "fine gray", "subdistribution hazard"), "Fine-Gray competing-risk regression is not implemented."),
            (("hy's law", "hys law", "shift table", "ctcae lab"), "Specialized clinical safety-table workflows are not implemented yet."),
        )
        for aliases, message in unsupported_tokens:
            if any(alias in question for alias in aliases):
                constraints.append(message)
        if not constraints:
            constraints.append("The planner currently handles only implemented deterministic families such as incidence, logistic regression, survival, repeated measures, threshold search, competing-risk summaries, and exploratory ML.")
        return constraints

    def _detect_unsupported_method_gap(self, question: str) -> UnsupportedMethodGap | None:
        if any(token in question for token in ("non-inferiority", "noninferiority", "equivalence margin", "superiority margin")):
            return UnsupportedMethodGap(
                family="unknown",
                reason="Formal non-inferiority, equivalence, or margin-based superiority testing is not implemented in the deterministic engine.",
                recommended_next_step="Route this request to a dedicated statistical testing workflow or extend the backend with margin-based hypothesis-testing support.",
                fallback_option="Use AI Chat only for SAP or protocol review; do not treat it as a formal test result.",
                data_requirements=["Analysis-ready endpoint data plus a prespecified testing framework and margin definition."],
                method_constraints=["Formal margin-based testing, alpha control, and reporting are not implemented."],
            )
        if any(token in question for token in ("multiplicity", "hierarchical testing", "gatekeeping", "alpha spending", "interim analysis")):
            return UnsupportedMethodGap(
                family="unknown",
                reason="Multiplicity adjustment, hierarchical testing, and interim alpha-control workflows are not implemented in the deterministic engine.",
                recommended_next_step="Route this question to a dedicated SAP/statistics workflow or extend the backend with formal multiple-testing support.",
                fallback_option="Use AI Chat to review the protocol language only; do not present a qualitative answer as a multiplicity-adjusted result.",
                data_requirements=["Prespecified endpoint hierarchy, testing order, and adjusted hypothesis-testing logic."],
                method_constraints=["Formal multiplicity control is outside the current deterministic workflow set."],
            )
        if any(token in question for token in ("propensity", "iptw", "inverse probability", "matching", "causal inference", "instrumental variable", "mediation")):
            return UnsupportedMethodGap(
                family="unknown",
                reason="Causal-adjustment workflows such as propensity methods, IPTW, and mediation analysis are not implemented in the deterministic engine.",
                recommended_next_step="Reframe the question as an associative analysis, or extend the backend with a dedicated causal-inference workflow.",
                fallback_option="Use AI Chat only for framing and assumptions review, not for causal conclusions.",
                data_requirements=["Treatment, outcome, and confounder data plus a dedicated causal-identification strategy."],
                method_constraints=["Current models estimate association, not causal effect."],
            )
        if any(token in question for token in ("time-varying covariate", "time varying covariate", "multi-state", "multistate", "recurrent event", "andersen-gill", "treatment switching")):
            return UnsupportedMethodGap(
                family="cox",
                reason="Advanced survival workflows such as time-varying covariates, recurrent events, multi-state models, and treatment-switching adjustments are not implemented.",
                recommended_next_step="Simplify the request to a standard KM/Cox question, or extend the backend with the required survival method.",
                fallback_option="Use AI Chat to scope the endpoint and data, but not to replace the unsupported survival method.",
                data_requirements=["Time-dependent covariates or event-history structure plus a dedicated advanced survival implementation."],
                method_constraints=["Only standard Kaplan-Meier and Cox-style workflows are currently supported."],
            )
        if any(token in question for token in ("fine-gray", "fine gray", "subdistribution hazard")):
            return UnsupportedMethodGap(
                family="competing_risks",
                reason="Fine-Gray subdistribution hazard modeling is not implemented. The current competing-risk workflow only produces nonparametric cumulative-incidence summaries.",
                recommended_next_step="Either simplify the request to cumulative-incidence comparison or extend the backend with Fine-Gray regression support.",
                fallback_option="Use AI Chat for protocol review only; do not report a qualitative substitute as Fine-Gray output.",
                data_requirements=["Competing-risk event coding, event timing, and a Fine-Gray regression implementation."],
                method_constraints=["Competing-risk support is summary-level only, not full regression modeling."],
            )
        if any(token in question for token in ("hy's law", "hys law", "shift table", "ctcae lab", "lab shift")):
            return UnsupportedMethodGap(
                family="unknown",
                reason="Specialized clinical safety workflows such as Hy's law and formal lab-shift tables are not implemented yet.",
                recommended_next_step="Extend the backend with domain-specific safety derivations and reporting logic for this question type.",
                fallback_option="Use AI Chat for high-level source inspection only; do not present it as a validated safety-table result.",
                data_requirements=["Analysis-ready laboratory data plus domain-specific toxicity grading and shift derivation rules."],
                method_constraints=["The current engine does not yet implement standard safety-table derivations for these endpoints."],
            )
        return None

    def _default_outputs(self, family: AnalysisFamily) -> list[str]:
        if family == "feature_importance":
            return ["feature_importance", "partial_dependence", "model_summary"]
        if family == "partial_dependence":
            return ["partial_dependence", "feature_importance", "model_summary"]
        if family == "mixed_model":
            return ["coefficient_table", "trend_summary", "interaction_terms"]
        if family == "threshold_search":
            return ["threshold_ranking", "sensitivity_specificity", "confusion_summary"]
        if family == "competing_risks":
            return ["cumulative_incidence", "group_summary", "event_breakdown"]
        if family in {"incidence", "risk_difference"}:
            return ["contingency_table", "risk_difference", "confidence_interval"]
        if family in {"kaplan_meier", "cox"}:
            return ["survival_curve", "hazard_ratio", "confidence_interval"]
        if family == "logistic_regression":
            return ["coefficient_table", "odds_ratios", "confidence_interval"]
        return ["summary"]

    def _build_spec(self, question: str, inferred_family: AnalysisFamily) -> AnalysisSpec:
        lower_question = question.lower()
        family = self._resolve_planned_family(inferred_family, lower_question)
        endpoint_template = resolve_endpoint_template(lower_question, family)
        requested_covariates = self._extract_requested_covariates(lower_question)
        return AnalysisSpec(
            analysis_family=family,
            target_definition=endpoint_template.target_definition or self._extract_target_definition(lower_question, family),
            endpoint_label=endpoint_template.endpoint_label,
            grade_threshold=self._extract_grade_threshold(lower_question),
            term_filters=list(endpoint_template.term_filters) or self._extract_term_filters(lower_question),
            cohort_filters=self._extract_cohort_filters(lower_question),
            covariates=requested_covariates,
            interaction_terms=list(endpoint_template.interaction_terms) or self._extract_interaction_terms(lower_question),
            threshold_variables=list(endpoint_template.threshold_variables),
            threshold_metric=endpoint_template.threshold_metric,  # type: ignore[arg-type]
            time_window_days=endpoint_template.time_window_days or self._extract_time_window_days(lower_question),
            requested_outputs=list(endpoint_template.requested_outputs) or self._default_outputs(family),
            notes=[
                "Deterministic analysis plan generated from question classification.",
                *(
                    [
                        "Requested subgroup factors were converted into targeted treatment-interaction terms for deterministic effect-modifier screening."
                    ]
                    if self._is_subgroup_benefit_question(lower_question)
                    else []
                ),
                *list(endpoint_template.notes),
            ],
        )

    def _supports_derived_ae_survival(self, question: str) -> bool:
        return (
            ("week" in question or "onset" in question or "time to first" in question or "resolution" in question)
            and ("grade" in question or "adverse event" in question or "ae" in question)
        )

    def _resolve_planned_family(self, family: AnalysisFamily, question: str) -> AnalysisFamily:
        if family == "competing_risks" and ("risk difference" in question or "week 12" in question):
            return "risk_difference"
        if family == "incidence" and ("predict" in question or "predictor" in question or "predictors" in question):
            return "logistic_regression"
        return family

    def _extract_grade_threshold(self, question: str) -> int | None:
        match = re.search(r"grade\s*(?:>=|≥)?\s*(\d+)", question)
        if match:
            return int(match.group(1))
        if "grade" in question:
            return 2
        return None

    def _extract_term_filters(self, question: str) -> list[str]:
        if any(token in question for token in ("dermat", "rash", "skin")):
            return ["rash", "dermatologic", "erythema", "skin"]
        return []

    def _extract_target_definition(self, question: str, family: AnalysisFamily) -> str | None:
        if family in {"incidence", "risk_difference", "logistic_regression"} and "week 12" in question:
            return "grade_2_plus_dae_by_week_12"
        if "time to resolution" in question or "resolution" in question:
            return "time_to_resolution_grade_2_plus_dae"
        if "competing risk" in question or "cumulative incidence" in question:
            return "cumulative_incidence_of_discontinuation"
        if any(token in question for token in ("threshold", "cutoff", "early warning")):
            return "later_treatment_discontinuation"
        if any(token in question for token in ("repeated measures", "longitudinal", "trajectory", "trend over time")):
            return "repeated_measure_change"
        if any(token in question for token in ("earlier onset", "time to onset", "time to first", "onset")):
            return "time_to_first_grade_2_plus_dae"
        return None

    def _extract_time_window_days(self, question: str) -> int | None:
        week_match = re.search(r"week\s*(\d+)", question)
        if week_match:
            return int(week_match.group(1)) * 7
        if any(token in question for token in ("weeks 1-4", "weeks 1 to 4", "week 1-4")):
            return 28
        return None

    def _extract_interaction_terms(self, question: str) -> list[str]:
        interactions: list[str] = []
        if self._is_dose_or_exposure_question(question) and any(token in question for token in ("mitigat", "differ by arm", "by arm", "interaction")):
            interactions.append("treatment*dose")
        if "differ by arm" in question or "predictors differ by arm" in question:
            interactions.append("treatment*all")
        if self._is_subgroup_benefit_question(question):
            subgroup_terms = self._extract_requested_covariates(question)
            for term in subgroup_terms:
                interaction = f"treatment*{term}"
                if interaction not in interactions:
                    interactions.append(interaction)
            if not subgroup_terms and "treatment*all" not in interactions:
                interactions.append("treatment*all")
        return interactions

    def _extract_requested_covariates(self, question: str) -> list[str]:
        requested: list[str] = []
        token_map: tuple[tuple[tuple[str, ...], str], ...] = (
            (("older age", "age", "older"), "age"),
            (("weight tier", "80 kg", "weight", "body weight"), "weight"),
            (("dose", "dosing", "exposure", "higher exposure"), "dose"),
            (("crp", "c-reactive protein"), "crp"),
            (("eczema", "eczema history"), "eczema"),
            (("dryness", "dry skin", "skin dryness"), "dry"),
            (("sex", "female", "male", "women", "men"), "sex"),
            (("race", "ethnicity", "ethnic"), "race"),
            (("ecog", "performance status"), "ecog"),
        )
        for aliases, label in token_map:
            if any(alias in question for alias in aliases) and label not in requested:
                requested.append(label)
        return requested

    def _is_subgroup_benefit_question(self, question: str) -> bool:
        subgroup_markers = (
            "larger in patients with",
            "greater in patients with",
            "benefit larger",
            "benefit greater",
            "larger benefit",
            "greater benefit",
            "benefit in subgroups",
            "benefit in certain",
            "high-risk subgroup",
            "high risk subgroup",
            "high-risk subgroups",
            "high risk subgroups",
            "certain subgroups",
            "certain high-risk subgroups",
            "which patients benefit more",
            "which subgroup benefits more",
            "effect modifier",
            "effect modification",
            "heterogeneity of treatment effect",
        )
        return any(marker in question for marker in subgroup_markers)

    def _is_dose_or_exposure_question(self, question: str) -> bool:
        return any(token in question for token in ("dose", "dosing", "weight", "exposure", ">80 kg", "80 kg"))

    def _is_exposure_risk_question(self, question: str) -> bool:
        if not self._is_dose_or_exposure_question(question):
            return False
        risk_markers = (
            "increase risk",
            "higher risk",
            "risk increase",
            "risk of",
            "more likely",
            "associated with risk",
            "linked to risk",
            "mitigat",
            "mitigated",
            "mitigation",
        )
        return any(marker in question for marker in risk_markers)

    def _has_exposure_inputs(self, datasets: Iterable[DatasetReference], roles: set[str]) -> bool:
        if "ADEX" in roles or "EX" in roles:
            return True
        for dataset in datasets:
            columns = {column.upper() for column in dataset.column_names}
            if any(token in columns for token in ("WEIGHT", "WT", "WTBL", "BASEWT", "WGT")):
                return True
        return False

    def _extract_cohort_filters(self, question: str) -> list[AnalysisFilter]:
        filters: list[AnalysisFilter] = []

        age_gte_match = re.search(r"(?:age|aged?|women|men|subjects|participants)[^0-9]{0,12}(?:>=|≥|over|older than|at least)\s*(\d+)", question)
        if age_gte_match:
            age_value = age_gte_match.group(1)
            filters.append(AnalysisFilter(field="AGE", operator="gte", value=age_value, label=f"AGE >= {age_value}"))
        else:
            age_suffix_match = re.search(r"(?:women|men|subjects|participants)\s*[≥>=]\s*(\d+)", question)
            if age_suffix_match:
                age_value = age_suffix_match.group(1)
                filters.append(AnalysisFilter(field="AGE", operator="gte", value=age_value, label=f"AGE >= {age_value}"))

        if re.search(r"\bwomen\b|\bfemale\b", question):
            filters.append(AnalysisFilter(field="SEX", operator="equals", value="F", label="SEX = female"))
        elif re.search(r"\bmen\b|\bmale\b", question):
            filters.append(AnalysisFilter(field="SEX", operator="equals", value="M", label="SEX = male"))

        race_tokens = {
            "asian": "ASIAN",
            "white": "WHITE",
            "black": "BLACK",
            "african american": "BLACK",
            "hispanic": "HISPANIC",
        }
        for token, value in race_tokens.items():
            if token in question:
                filters.append(AnalysisFilter(field="RACE", operator="contains", value=value, label=f"RACE contains {value}"))
                break

        return filters
