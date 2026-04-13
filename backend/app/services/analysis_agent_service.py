from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import json
from io import StringIO
import re
from typing import Iterable
from uuid import uuid4

import pandas as pd

from ..config import get_settings
from ..models.analysis import (
    AnalysisAgentChart,
    AnalysisAgentBrief,
    AnalysisAgentExportResponse,
    AnalysisAgentPlanRequest,
    AnalysisAgentProvenance,
    AnalysisAgentPlanResponse,
    AnalysisAgentRunRequest,
    AnalysisAgentRunResponse,
    AnalysisAgentRunSummary,
    AnalysisAgentStep,
    AnalysisAgentUserSummary,
    AnalysisCapabilityRequest,
    AnalysisCapabilityAssessment,
    AnalysisExecutionReceipt,
    AnalysisFamily,
    AnalysisFilter,
    AnalysisSpec,
    AnalysisPlanRequest,
    AnalysisRunRequest,
    AnalysisRunResponse,
    AnalysisTable,
    WorkspaceBuildRequest,
    DatasetReference,
)
from .analysis_agent_repository import FileAnalysisAgentRepository
from .analysis_service import AnalysisService
from .endpoint_templates import resolve_endpoint_template
from .workspace_builder import infer_role


@dataclass(frozen=True)
class ResolvedDatasets:
    datasets: list[DatasetReference]
    role_map: dict[str, str]
    notes: list[str]


class AnalysisAgentService:
    def __init__(self) -> None:
        settings = get_settings()
        self._analysis = AnalysisService()
        self._runs = FileAnalysisAgentRepository(settings.analysis_agent_store_dir)

    def build_plan(self, payload: AnalysisAgentPlanRequest) -> AnalysisAgentPlanResponse:
        question = payload.question.strip()
        run_id = f"agent_{uuid4().hex[:12]}"
        resolved = self._resolve_datasets(payload.datasets)
        capability = self._analysis.classify_capabilities(
            AnalysisCapabilityRequest(question=question, datasets=resolved.datasets)
        )

        steps = [
            self._dataset_selection_step(resolved),
            self._capability_step(resolved, capability.status, capability.analysis_family, capability.explanation, capability.missing_roles, capability.warnings),
        ]
        brief = self._build_agent_brief(
            question=question,
            resolved=resolved,
            family=capability.analysis_family,
            missing_roles=capability.missing_roles,
            assessment=capability.assessment,
        )

        if capability.status != "unsupported":
            plan = self._analysis.build_plan(
                AnalysisPlanRequest(question=question, datasets=resolved.datasets)
            )
            planned_family = plan.spec.analysis_family if plan.spec else capability.analysis_family
            brief = self._build_agent_brief(
                question=question,
                resolved=resolved,
                family=planned_family,
                missing_roles=plan.missing_roles or capability.missing_roles,
                spec=plan.spec,
                warnings=plan.warnings,
                assessment=plan.assessment or capability.assessment,
            )
            steps.append(self._planning_step(planned_family, plan.explanation, plan.spec.notes if plan.spec else [], resolved))
            explanation = plan.explanation
            warnings = [*resolved.notes, *capability.warnings, *plan.warnings]
        else:
            planned_family = capability.analysis_family
            explanation = capability.explanation
            warnings = [*resolved.notes, *capability.warnings]

        return AnalysisAgentPlanResponse(
            run_id=run_id,
            status=capability.status,
            analysis_family=planned_family,
            selected_sources=[dataset.name for dataset in resolved.datasets],
            selected_roles=resolved.role_map,
            brief=brief,
            steps=steps,
            warnings=warnings,
            explanation=explanation,
        )

    def run(self, payload: AnalysisAgentRunRequest) -> AnalysisAgentRunResponse:
        question = payload.question.strip()
        run_id = f"agent_{uuid4().hex[:12]}"
        created_at = datetime.now(timezone.utc).isoformat()
        resolved = self._resolve_datasets(payload.datasets)
        capability = self._analysis.classify_capabilities(
            AnalysisCapabilityRequest(question=question, datasets=resolved.datasets)
        )

        steps: list[AnalysisAgentStep] = [
            self._dataset_selection_step(resolved),
            self._capability_step(resolved, capability.status, capability.analysis_family, capability.explanation, capability.missing_roles, capability.warnings),
        ]
        warnings = [*resolved.notes, *capability.warnings]

        if capability.status != "executable":
            answer = self._build_blocked_answer(
                question,
                resolved,
                capability.explanation,
                capability.missing_roles,
                capability.assessment,
            )
            response = AnalysisAgentRunResponse(
                run_id=run_id,
                question=question,
                created_at=created_at,
                status=capability.status,
                missing_roles=capability.missing_roles,
                executed=False,
                analysis_family=capability.analysis_family,
                selected_sources=[dataset.name for dataset in resolved.datasets],
                selected_roles=resolved.role_map,
                steps=steps,
                answer=answer,
                user_summary=self._build_blocked_user_summary(capability.explanation, capability.missing_roles, capability.assessment),
                warnings=warnings,
                explanation=capability.explanation,
            )
            self._runs.save(response)
            return response

        plan = self._analysis.build_plan(
            AnalysisPlanRequest(question=question, datasets=resolved.datasets)
        )
        steps.append(self._planning_step(plan.spec.analysis_family if plan.spec else capability.analysis_family, plan.explanation, plan.spec.notes if plan.spec else [], resolved))
        warnings.extend(plan.warnings)

        workspace = self._analysis.build_workspace(
            WorkspaceBuildRequest(question=question, datasets=resolved.datasets, spec=plan.spec)
        )
        preview_details = [
            f"Rows: {workspace.row_count}" if workspace.row_count is not None else "",
            f"Columns: {workspace.column_count}" if workspace.column_count is not None else "",
            *workspace.notes,
        ]
        workspace_entry = self._analysis._workspace_store.load(workspace.workspace_id) if workspace.workspace_id else None
        steps.append(
            AnalysisAgentStep(
                id="workspace",
                title="Build analysis workspace",
                status="completed" if workspace.status == "executable" else "failed",
                summary=workspace.explanation,
                details=[detail for detail in preview_details if detail],
                table=workspace.preview_table,
                provenance=self._workspace_provenance(workspace_entry),
            )
        )

        if workspace.status != "executable" or not workspace.workspace_id:
            answer = self._build_blocked_answer(question, resolved, workspace.explanation, workspace.missing_roles)
            response = AnalysisAgentRunResponse(
                run_id=run_id,
                question=question,
                created_at=created_at,
                status=workspace.status,
                missing_roles=workspace.missing_roles,
                executed=False,
                analysis_family=capability.analysis_family,
                selected_sources=[dataset.name for dataset in resolved.datasets],
                selected_roles=resolved.role_map,
                steps=steps,
                answer=answer,
                user_summary=self._build_blocked_user_summary(workspace.explanation, workspace.missing_roles),
                warnings=warnings,
                explanation=workspace.explanation,
            )
            self._runs.save(response)
            return response

        executed = self._analysis.run_analysis(
            AnalysisRunRequest(
                question=question,
                datasets=resolved.datasets,
                spec=plan.spec,
                workspace_id=workspace.workspace_id,
            )
        )
        warnings.extend(executed.warnings)
        primary_chart = self._build_primary_chart(executed)
        steps.append(
            AnalysisAgentStep(
                id="execution",
                title="Execute deterministic analysis",
                status="completed" if executed.executed else "failed",
                summary=executed.interpretation or executed.explanation,
                details=[f"{metric.name}: {metric.value}" for metric in executed.metrics[:8]],
                code=self._build_execution_code(question, resolved, executed),
                chart=primary_chart,
                table=executed.table,
                provenance=self._receipt_provenance(
                    executed.receipt,
                    note="This step executed the deterministic statistical family on the prepared workspace.",
                ),
            )
        )

        supplemental_steps = self._build_supplemental_steps(resolved, workspace.workspace_id)
        steps.extend(supplemental_steps)

        user_summary = self._build_executed_user_summary(executed, supplemental_steps)
        answer = self._build_final_answer(question, resolved, executed, supplemental_steps, user_summary)
        response = AnalysisAgentRunResponse(
            run_id=run_id,
            question=question,
            created_at=created_at,
            status=executed.status,
            missing_roles=[],
            executed=executed.executed,
            analysis_family=executed.analysis_family,
            selected_sources=[dataset.name for dataset in resolved.datasets],
            selected_roles=resolved.role_map,
            workspace_id=workspace.workspace_id,
            steps=steps,
            answer=answer,
            user_summary=user_summary,
            chart=primary_chart,
            table=executed.table,
            warnings=warnings,
            explanation=executed.explanation,
        )
        self._runs.save(response)
        return response

    def get_run(self, run_id: str) -> AnalysisAgentRunResponse:
        run = self._runs.load(run_id)
        if run is None:
            raise ValueError(f"Analysis agent run {run_id} was not found.")
        return run

    def list_runs(self, limit: int = 20) -> list[AnalysisAgentRunSummary]:
        return self._runs.list_recent(limit=limit)

    def export_run(self, run_id: str, export_format: str) -> AnalysisAgentExportResponse:
        run = self.get_run(run_id)
        normalized_format = export_format.lower()
        if normalized_format == "ipynb":
            filename = f"{run.run_id}.ipynb"
            return AnalysisAgentExportResponse(
                run_id=run.run_id,
                format="ipynb",
                filename=filename,
                mime_type="application/x-ipynb+json",
                content=json.dumps(self._build_notebook_payload(run), indent=2),
            )
        if normalized_format == "html":
            filename = f"{run.run_id}.html"
            return AnalysisAgentExportResponse(
                run_id=run.run_id,
                format="html",
                filename=filename,
                mime_type="text/html",
                content=self._build_html_report(run),
            )
        raise ValueError(f"Unsupported export format: {export_format}")

    def _resolve_datasets(self, datasets: Iterable[DatasetReference]) -> ResolvedDatasets:
        resolved_by_role: dict[str, DatasetReference] = {}
        notes: list[str] = []
        fallback: list[DatasetReference] = []

        for dataset in datasets:
            role = infer_role(dataset)
            if not role:
                fallback.append(dataset)
                continue

            current = resolved_by_role.get(role)
            if current is None or self._dataset_rank(dataset, role) > self._dataset_rank(current, role):
                if current is not None:
                    notes.append(f"Resolved duplicate {role} candidates by preferring {dataset.name} over {current.name}.")
                resolved_by_role[role] = dataset
            else:
                notes.append(f"Ignored duplicate {role} candidate {dataset.name} in favor of {current.name}.")

        curated = list(resolved_by_role.values())
        if not curated:
            curated = list(datasets)
        elif fallback and len(curated) < 2:
            curated.extend(fallback[:1])

        role_map = {role: dataset.name for role, dataset in resolved_by_role.items()}
        return ResolvedDatasets(datasets=curated, role_map=role_map, notes=notes)

    def _dataset_rank(self, dataset: DatasetReference, role: str) -> int:
        name = dataset.name.lower()
        score = 0
        if dataset.role:
            score += 30
            if dataset.role.upper() == role:
                score += 15
        if dataset.preferred:
            score += 25
        if role.lower() in name:
            score += 18
        if "workspace_" in name:
            score -= 30
        if "readme" in name:
            score -= 40
        if "clean" in name or "final" in name:
            score += 12
        if "adam" in name or role.lower() in name:
            score += 10
        if dataset.row_count:
            score += min(10, int(dataset.row_count // 100))
        if dataset.column_names:
            score += min(8, len(dataset.column_names) // 5)
        return score

    def _dataset_selection_step(self, resolved: ResolvedDatasets) -> AnalysisAgentStep:
        details = [f"{role}: {name}" for role, name in resolved.role_map.items()]
        if any(not dataset.preferred for dataset in resolved.datasets) and any(dataset.preferred for dataset in resolved.datasets):
            details.append("Filled missing analysis roles from other available project datasets when the current selection was incomplete.")
        if not details:
            details = [dataset.name for dataset in resolved.datasets]
        return AnalysisAgentStep(
            id="resolve",
            title="Resolve relevant datasets",
            status="completed",
            summary="Selected the most relevant analysis-ready files for the question and de-duplicated competing dataset roles.",
            details=details + resolved.notes,
            provenance=AnalysisAgentProvenance(
                source_names=[dataset.name for dataset in resolved.datasets],
                note="Role inference and duplicate resolution were applied before planning.",
            ),
        )

    def _capability_step(
        self,
        resolved: ResolvedDatasets,
        status: str,
        family: str,
        explanation: str,
        missing_roles: list[str],
        warnings: list[str],
    ) -> AnalysisAgentStep:
        details = [f"Analysis family: {family}"]
        if missing_roles:
            details.append(f"Missing roles: {', '.join(missing_roles)}")
        details.extend(warnings)
        return AnalysisAgentStep(
            id="capability",
            title="Capability assessment",
            status="completed" if status == "executable" else "failed",
            summary=explanation,
            details=details,
            provenance=AnalysisAgentProvenance(
                source_names=[dataset.name for dataset in resolved.datasets],
                note="Question support and dataset readiness were checked against the resolved dataset roles.",
            ),
        )

    def _planning_step(self, family: str, explanation: str, notes: list[str], resolved: ResolvedDatasets) -> AnalysisAgentStep:
        return AnalysisAgentStep(
            id="plan",
            title="Build deterministic plan",
            status="completed",
            summary=explanation,
            details=[f"Planned family: {family}", *notes],
            provenance=AnalysisAgentProvenance(
                source_names=[dataset.name for dataset in resolved.datasets],
                note="The planner mapped the question to a deterministic analysis family and required roles.",
            ),
        )

    def _build_agent_brief(
        self,
        question: str,
        resolved: ResolvedDatasets,
        family: AnalysisFamily,
        missing_roles: list[str],
        spec: AnalysisSpec | None = None,
        warnings: list[str] | None = None,
        assessment: AnalysisCapabilityAssessment | None = None,
    ) -> AnalysisAgentBrief:
        endpoint_template = resolve_endpoint_template(question.lower(), family)
        required_roles = self._required_roles_for_brief(family, endpoint_template.required_roles)
        return AnalysisAgentBrief(
            analysis_family=family,
            target_definition=spec.target_definition if spec else endpoint_template.target_definition,
            endpoint_label=spec.endpoint_label if spec else endpoint_template.endpoint_label,
            treatment_variable=spec.treatment_variable if spec else None,
            subgroup_factors=self._extract_subgroup_factors(spec),
            required_roles=required_roles,
            missing_roles=missing_roles,
            selected_sources=[dataset.name for dataset in resolved.datasets],
            selected_roles=resolved.role_map,
            time_window_days=spec.time_window_days if spec else endpoint_template.time_window_days,
            grade_threshold=spec.grade_threshold if spec else None,
            term_filters=list(spec.term_filters) if spec else list(endpoint_template.term_filters),
            cohort_filters=self._format_cohort_filters(spec.cohort_filters if spec else []),
            interaction_terms=list(spec.interaction_terms) if spec else list(endpoint_template.interaction_terms),
            requested_outputs=list(spec.requested_outputs) if spec else self._default_outputs_for_brief(family, endpoint_template.requested_outputs),
            notes=[
                *(list(spec.notes) if spec else list(endpoint_template.notes)),
                *(warnings or []),
            ],
            assessment=assessment,
        )

    def _required_roles_for_brief(self, family: AnalysisFamily, template_roles: tuple[str, ...]) -> list[str]:
        if template_roles:
            return list(template_roles)
        if family in {"incidence", "risk_difference", "logistic_regression", "kaplan_meier", "cox"}:
            return ["ADSL", "ADAE"]
        if family == "mixed_model":
            return ["ADSL", "ADLB"]
        if family == "threshold_search":
            return ["ADSL", "ADAE", "DS"]
        if family == "competing_risks":
            return ["ADSL", "DS"]
        if family in {"feature_importance", "partial_dependence"}:
            return ["ADSL", "ADAE", "ADLB"]
        return []

    def _default_outputs_for_brief(self, family: AnalysisFamily, template_outputs: tuple[str, ...]) -> list[str]:
        if template_outputs:
            return list(template_outputs)
        if family in {"feature_importance", "partial_dependence"}:
            return ["feature_importance", "partial_dependence", "model_summary"]
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

    def _extract_subgroup_factors(self, spec: AnalysisSpec | None) -> list[str]:
        if spec is None:
            return []

        factors: list[str] = []
        for covariate in spec.covariates:
            cleaned = covariate.strip()
            if cleaned and cleaned not in factors:
                factors.append(cleaned)

        for term in spec.interaction_terms:
            if "*" not in term:
                continue
            for part in term.split("*"):
                cleaned = part.strip()
                if cleaned and cleaned != "treatment" and cleaned not in factors:
                    factors.append(cleaned)
        return factors

    def _format_cohort_filters(self, filters: list[AnalysisFilter]) -> list[str]:
        formatted: list[str] = []
        for filter_item in filters:
            if filter_item.label:
                formatted.append(filter_item.label)
                continue
            formatted.append(f"{filter_item.field} {filter_item.operator} {filter_item.value}")
        return formatted

    def _receipt_provenance(
        self,
        receipt: AnalysisExecutionReceipt | None,
        note: str | None = None,
        join_keys: list[str] | None = None,
    ) -> AnalysisAgentProvenance | None:
        if receipt is None:
            return None

        columns_used = [
            value
            for value in [
                receipt.subject_identifier,
                receipt.treatment_variable,
                receipt.outcome_variable,
                receipt.time_variable,
                receipt.event_variable,
            ]
            if value
        ]

        return AnalysisAgentProvenance(
            source_names=list(receipt.source_names or []),
            columns_used=columns_used,
            derived_columns=list(receipt.derived_columns or []),
            cohort_filters_applied=list(receipt.cohort_filters_applied or []),
            join_keys=list(join_keys or []),
            note=note,
        )

    def _workspace_provenance(self, workspace_entry: dict | None) -> AnalysisAgentProvenance | None:
        if not isinstance(workspace_entry, dict):
            return None

        metadata = workspace_entry.get("metadata", {})
        if not isinstance(metadata, dict):
            metadata = {}

        columns_used = [
            str(value)
            for value in [
                metadata.get("subject_id_column"),
                metadata.get("treatment_column"),
                metadata.get("outcome_column"),
                metadata.get("time_column"),
                metadata.get("event_column"),
            ]
            if str(value or "").strip()
        ]
        cohort_filters = metadata.get("cohort_filter_labels", [])
        if not isinstance(cohort_filters, list):
            cohort_filters = []

        return AnalysisAgentProvenance(
            source_names=[str(name) for name in workspace_entry.get("source_names", []) if str(name).strip()],
            columns_used=columns_used,
            derived_columns=[str(name) for name in workspace_entry.get("derived_columns", []) if str(name).strip()],
            cohort_filters_applied=[str(label) for label in cohort_filters if str(label).strip()],
            note="A materialized workspace was built before the deterministic analysis step.",
        )

    def _build_primary_chart(self, executed: AnalysisRunResponse) -> AnalysisAgentChart | None:
        table = executed.table
        if table is None or not table.rows:
            return None

        if executed.analysis_family in {"incidence", "risk_difference"} and "incidence_pct" in table.columns:
            category_col = table.columns[0]
            return AnalysisAgentChart(
                data=[
                    {
                        "type": "bar",
                        "x": [str(row.get(category_col, "")) for row in table.rows],
                        "y": [float(row.get("incidence_pct", 0) or 0) for row in table.rows],
                        "marker": {"color": "#2563eb"},
                    }
                ],
                layout={
                    "title": {"text": table.title or "Incidence by treatment group"},
                    "xaxis": {"title": category_col},
                    "yaxis": {"title": "Incidence (%)"},
                },
            )

        numeric_cols = [column for column in table.columns[1:] if all(isinstance(row.get(column), (int, float)) for row in table.rows)]
        if not numeric_cols:
            return None
        value_col = numeric_cols[0]
        return AnalysisAgentChart(
            data=[
                {
                    "type": "bar",
                    "x": [str(row.get(table.columns[0], "")) for row in table.rows],
                    "y": [float(row.get(value_col, 0) or 0) for row in table.rows],
                    "marker": {"color": "#0f766e"},
                }
            ],
            layout={
                "title": {"text": table.title or "Executed analysis output"},
                "xaxis": {"title": table.columns[0]},
                "yaxis": {"title": value_col},
            },
        )

    def _build_execution_code(
        self,
        question: str,
        resolved: ResolvedDatasets,
        executed: AnalysisRunResponse,
    ) -> str:
        source_names = ", ".join(dataset.name for dataset in resolved.datasets)
        return (
            "# Analysis Agent execution summary\n"
            f"# Question: {question}\n"
            f"# Sources: {source_names}\n"
            f"# Deterministic family: {executed.analysis_family}\n"
            "# The backend classified the question, built a row-level workspace, and executed\n"
            "# the deterministic analysis engine rather than generating a free-form chat summary."
        )

    def _build_supplemental_steps(self, resolved: ResolvedDatasets, workspace_id: str) -> list[AnalysisAgentStep]:
        workspace_entry = self._analysis._workspace_store.load(workspace_id)
        if workspace_entry is None:
            return []

        dataframe = workspace_entry.get("dataframe")
        metadata = workspace_entry.get("metadata", {})
        if not isinstance(dataframe, pd.DataFrame) or not isinstance(metadata, dict):
            return []

        steps: list[AnalysisAgentStep] = []
        treatment_col = str(metadata.get("treatment_column") or "")
        subject_col = str(metadata.get("subject_id_column") or "")
        source_names = [str(name) for name in workspace_entry.get("source_names", []) if str(name).strip()]
        if treatment_col and treatment_col in dataframe.columns:
            steps.append(self._treatment_balance_step(dataframe, treatment_col, subject_col, source_names))

        adae = next((dataset for dataset in resolved.datasets if infer_role(dataset) == "ADAE" and dataset.content), None)
        adsl = next((dataset for dataset in resolved.datasets if infer_role(dataset) == "ADSL" and dataset.content), None)
        if adae and adsl:
            ae_step = self._ae_signal_step(adae, adsl)
            if ae_step is not None:
                steps.append(ae_step)

        return steps

    def _treatment_balance_step(
        self,
        dataframe: pd.DataFrame,
        treatment_col: str,
        subject_col: str,
        source_names: list[str],
    ) -> AnalysisAgentStep:
        if subject_col and subject_col in dataframe.columns:
            balance = (
                dataframe[[subject_col, treatment_col]]
                .dropna(subset=[treatment_col])
                .drop_duplicates(subset=[subject_col], keep="first")
                .groupby(treatment_col, dropna=False)[subject_col]
                .nunique()
                .reset_index(name="subjects")
            )
        else:
            balance = dataframe.groupby(treatment_col, dropna=False).size().reset_index(name="rows")

        value_col = balance.columns[1]
        table = AnalysisTable(
            title="Treatment cohort balance",
            columns=list(balance.columns),
            rows=balance.to_dict(orient="records"),
        )
        chart = AnalysisAgentChart(
            data=[
                {
                    "type": "bar",
                    "x": [str(value) for value in balance[treatment_col].tolist()],
                    "y": [int(value) for value in balance[value_col].tolist()],
                    "marker": {"color": "#7c3aed"},
                }
            ],
            layout={
                "title": {"text": "Treatment cohort balance"},
                "xaxis": {"title": treatment_col},
                "yaxis": {"title": value_col},
            },
        )
        return AnalysisAgentStep(
            id="treatment-balance",
            title="Inspect treatment cohort balance",
            status="completed",
            summary="Profiled the analysis cohort by treatment arm before interpreting the main result.",
            table=table,
            chart=chart,
            provenance=AnalysisAgentProvenance(
                source_names=source_names,
                columns_used=[value for value in [subject_col, treatment_col] if value],
                note="This step used the materialized workspace to confirm cohort balance before interpretation.",
            ),
        )

    def _ae_signal_step(self, adae: DatasetReference, adsl: DatasetReference) -> AnalysisAgentStep | None:
        adae_df = self._read_dataset_frame(adae)
        adsl_df = self._read_dataset_frame(adsl)
        if adae_df is None or adsl_df is None:
            return None

        ae_subject = self._find_column(adae_df, ("USUBJID", "SUBJID", "SUBJECT_ID", "PATIENT_ID"))
        adsl_subject = self._find_column(adsl_df, ("USUBJID", "SUBJID", "SUBJECT_ID", "PATIENT_ID"))
        treatment_col = self._find_column(adsl_df, ("TRT01A", "TRTA", "TRT01P", "ACTARM", "ARM", "TRT_ARM", "TREATMENT_ARM"))
        term_col = self._find_column(adae_df, ("AEDECOD", "AETERM", "TERM", "PT"))
        if not ae_subject or not adsl_subject or not treatment_col or not term_col:
            return None

        arm_map = adsl_df[[adsl_subject, treatment_col]].dropna(subset=[adsl_subject, treatment_col]).drop_duplicates(subset=[adsl_subject], keep="first")
        merged = adae_df[[ae_subject, term_col]].dropna(subset=[ae_subject, term_col]).merge(
            arm_map,
            how="inner",
            left_on=ae_subject,
            right_on=adsl_subject,
        )
        if merged.empty:
            return None

        top_terms = (
            merged.groupby(term_col)
            .size()
            .reset_index(name="events")
            .sort_values("events", ascending=False)
            .head(6)[term_col]
            .tolist()
        )
        filtered = merged[merged[term_col].isin(top_terms)].copy()
        if filtered.empty:
            return None

        grouped = (
            filtered.groupby([treatment_col, term_col])
            .size()
            .reset_index(name="events")
        )
        table = AnalysisTable(
            title="Top adverse events by treatment arm",
            columns=[treatment_col, term_col, "events"],
            rows=grouped.to_dict(orient="records"),
        )
        chart = AnalysisAgentChart(
            data=[
                {
                    "type": "bar",
                    "name": str(term),
                    "x": [str(arm) for arm in grouped[treatment_col].drop_duplicates().tolist()],
                    "y": [
                        int(
                            grouped[
                                (grouped[treatment_col] == arm) & (grouped[term_col] == term)
                            ]["events"].sum()
                        )
                        for arm in grouped[treatment_col].drop_duplicates().tolist()
                    ],
                }
                for term in top_terms
            ],
            layout={
                "title": {"text": "Top adverse events by treatment arm"},
                "barmode": "stack",
                "xaxis": {"title": treatment_col},
                "yaxis": {"title": "Event count"},
            },
        )
        return AnalysisAgentStep(
            id="ae-profile",
            title="Profile adverse-event distribution",
            status="completed",
            summary="Cross-matched treatment arm assignments with raw adverse-event rows to generate a supporting event profile.",
            table=table,
            chart=chart,
            code=(
                "# Supporting AE profile\n"
                "# 1. Join ADAE rows to treatment arm from ADSL on subject identifier\n"
                "# 2. Rank the most frequent event terms\n"
                "# 3. Plot event counts by treatment arm"
            ),
            provenance=AnalysisAgentProvenance(
                source_names=[adae.name, adsl.name],
                columns_used=[ae_subject, adsl_subject, treatment_col, term_col],
                join_keys=[f"{ae_subject} = {adsl_subject}"],
                note="This supporting profile joined ADAE event rows to the ADSL treatment arm assignment.",
            ),
        )

    def _build_blocked_answer(
        self,
        question: str,
        resolved: ResolvedDatasets,
        explanation: str,
        missing_roles: list[str],
        assessment: AnalysisCapabilityAssessment | None = None,
    ) -> str:
        sources = ", ".join(dataset.name for dataset in resolved.datasets) or "no datasets"
        missing = f"\n\nStill needed: {', '.join(missing_roles)}." if missing_roles else ""
        next_step = (
            f"\n\nWhat to do next: {assessment.recommended_next_step}"
            if assessment and assessment.recommended_next_step
            else ""
        )
        fallback = (
            f"\n\nFallback: {assessment.fallback_option}"
            if assessment and assessment.fallback_option
            else ""
        )
        return (
            "### AI Analysis Agent could not execute this question yet\n"
            f"Question: {question}\n\n"
            f"Selected sources: {sources}\n\n"
            f"{explanation}{missing}{next_step}{fallback}\n\n"
            "The agent stopped before free-form summarization because this mode is intended to stay grounded in executable analysis steps."
        )

    def _build_final_answer(
        self,
        question: str,
        resolved: ResolvedDatasets,
        executed: AnalysisRunResponse,
        supplemental_steps: list[AnalysisAgentStep],
        user_summary: AnalysisAgentUserSummary,
    ) -> str:
        sources = ", ".join(dataset.name for dataset in resolved.datasets)
        role_lines = ", ".join(f"{role}={name}" for role, name in resolved.role_map.items())
        supplemental_titles = ", ".join(step.title for step in supplemental_steps) if supplemental_steps else "none"
        hypotheses = "\n".join(f"- {item}" for item in user_summary.potential_hypotheses[:3]) or "- No concrete explanatory hypothesis was generated."
        follow_up = "\n".join(f"- {item}" for item in user_summary.recommended_follow_up[:3]) or "- No follow-up analysis was suggested."
        limitations = "\n".join(f"- {item}" for item in user_summary.limitations[:3]) or "- No material limitations were captured."
        return (
            "### AI Analysis Agent executed\n"
            f"Question: {question}\n\n"
            f"Deterministic family: {executed.analysis_family}\n"
            f"Selected sources: {sources}\n"
            f"Resolved roles: {role_lines or 'not inferred'}\n\n"
            f"### Direct answer\n{user_summary.bottom_line}\n\n"
            f"### Supporting evidence\n" + "\n".join(f"- {point}" for point in user_summary.evidence_points[:4]) + "\n\n"
            f"### Possible explanations\n{hypotheses}\n\n"
            f"### Recommended follow-up analyses\n{follow_up}\n\n"
            f"### Limitations\n{limitations}\n\n"
            f"### Supporting executed steps\nSupplemental inspections produced: {supplemental_titles}.\n\n"
            "This answer is grounded in executed deterministic workflow steps rather than a free-form RAG summary."
        )

    def _build_blocked_user_summary(
        self,
        explanation: str,
        missing_roles: list[str],
        assessment: AnalysisCapabilityAssessment | None = None,
    ) -> AnalysisAgentUserSummary:
        missing_text = ", ".join(missing_roles) if missing_roles else "required datasets"
        return AnalysisAgentUserSummary(
            bottom_line="The agent could not run this analysis yet.",
            evidence_points=[explanation] if explanation else [],
            limitations=[explanation] if explanation else [],
            next_step=assessment.recommended_next_step if assessment and assessment.recommended_next_step else f"Add or select the missing dataset roles: {missing_text}.",
            context_note=assessment.fallback_option if assessment and assessment.fallback_option else None,
        )

    def _build_executed_user_summary(
        self,
        executed: AnalysisRunResponse,
        supplemental_steps: list[AnalysisAgentStep],
    ) -> AnalysisAgentUserSummary:
        metrics = {metric.name: metric.value for metric in executed.metrics}
        bottom_line = (executed.interpretation or executed.explanation or "The deterministic analysis completed.").strip()
        evidence_points = self._build_user_evidence_points(executed, metrics)
        family_summary = self._build_family_bottom_line(executed, metrics)
        if family_summary:
            bottom_line = family_summary

        next_step = None
        if executed.warnings:
            next_step = executed.warnings[0]
        elif supplemental_steps:
            next_step = f"Review the supporting step: {supplemental_steps[0].title.lower()}."

        return AnalysisAgentUserSummary(
            bottom_line=bottom_line,
            evidence_points=[point for point in evidence_points if str(point).strip()],
            potential_hypotheses=self._build_potential_hypotheses(executed, metrics),
            recommended_follow_up=self._build_recommended_follow_up(executed, metrics, supplemental_steps),
            limitations=self._build_limitations(executed, metrics),
            next_step=next_step,
        )

    def _build_potential_hypotheses(
        self,
        executed: AnalysisRunResponse,
        metrics: dict[str, object],
    ) -> list[str]:
        p_value = self._to_float(metrics.get("p_value"))
        hypotheses: list[str] = []

        if executed.analysis_family in {"incidence", "risk_difference"}:
            hypotheses.extend([
                "The difference between groups may reflect a real treatment-related effect on this outcome.",
                "Part of the gap may come from baseline differences between groups (for example, one group starting with higher risk).",
                "Differences in exposure time, event capture, or coding practices may also contribute to the observed gap.",
            ])
            if p_value is None or p_value >= 0.05:
                hypotheses.append("Chance variation is still a possible explanation because this comparison does not show a strong statistical separation.")
            return hypotheses

        if executed.analysis_family == "logistic_regression":
            hypotheses.extend([
                "The strongest predictors may be markers of higher-risk patients, not direct causes of the outcome.",
                "Some predictor effects may reflect differences in treatment assignment, exposure time, or other factors the model did not fully capture.",
                "Several baseline variables may describe the same underlying clinical pattern, so one top predictor should not be treated as the single explanation.",
            ])
            return hypotheses

        if executed.analysis_family in {"kaplan_meier", "cox"}:
            hypotheses.extend([
                "The time-to-event difference may reflect a real treatment effect on when events happen or resolve.",
                "Part of the separation may also come from baseline risk differences or uneven follow-up/censoring between groups.",
                "If event timing was derived rather than directly recorded, endpoint construction rules may influence the survival comparison.",
            ])
            return hypotheses

        if executed.analysis_family == "mixed_model":
            return [
                "The trend over time may differ by treatment, rather than showing one constant gap between groups.",
                "Visit timing, missing data patterns, and repeated-measure structure may influence the estimated trend differences.",
                "Baseline differences in the measured variable can still affect trajectories when adjustment is limited.",
            ]

        if executed.analysis_family == "threshold_search":
            return [
                "The identified threshold may be a useful early warning marker, but it may also reflect overall disease burden rather than one specific mechanism.",
                "This cutoff may be overfit to the current data and should be validated before operational use.",
                "Threshold performance can shift if early follow-up is incomplete or event timing is recorded inconsistently.",
            ]

        if executed.analysis_family in {"feature_importance", "partial_dependence"}:
            return [
                "Top-ranked features show which variables help prediction most, but they do not prove cause-and-effect.",
                "Related variables can split importance between each other, so the ranking should be read as a group-level signal.",
                "Dependence patterns may reflect this dataset's structure and may change in other cohorts.",
            ]

        return [
            "The observed pattern may represent a real clinical signal, but unmeasured factors and endpoint-definition choices should still be considered."
        ]

    def _build_recommended_follow_up(
        self,
        executed: AnalysisRunResponse,
        metrics: dict[str, object],
        supplemental_steps: list[AnalysisAgentStep],
    ) -> list[str]:
        follow_up: list[str] = []

        if executed.analysis_family in {"incidence", "risk_difference"}:
            follow_up.extend([
                "Adjust the comparison for key baseline covariates in a subject-level logistic model to test whether the incidence gap persists after adjustment.",
                "Review baseline prevalence of the endpoint-related risk factors by arm to assess possible imbalance.",
                "Stratify the endpoint by exposure duration, dose modification, or treatment discontinuation status if those data are available.",
            ])
        elif executed.analysis_family == "logistic_regression":
            follow_up.extend([
                "Test treatment-covariate interaction terms to distinguish general risk factors from subgroup-specific treatment effects.",
                "Check calibration, discrimination, and stability across alternative covariate sets or sensitivity models.",
                "Review whether the top predictors remain consistent after removing correlated or proxy variables.",
            ])
        elif executed.analysis_family in {"kaplan_meier", "cox"}:
            follow_up.extend([
                "Inspect censoring balance and event counts by arm to determine whether differential follow-up may be influencing the result.",
                "Add major baseline prognostic factors to an adjusted Cox model and check proportional-hazards assumptions.",
                "Run sensitivity analyses with alternative event definitions or timing derivation rules if the endpoint was derived.",
            ])
        elif executed.analysis_family == "mixed_model":
            follow_up.extend([
                "Inspect visit-level missingness and timing consistency before attributing the trend difference to treatment.",
                "Compare adjusted and unadjusted baseline values of the repeated-measure endpoint.",
                "Test whether the treatment-time interaction remains after restricting to consistently observed visits.",
            ])
        elif executed.analysis_family == "threshold_search":
            follow_up.extend([
                "Validate the selected threshold on a holdout cohort or independent study subset before using it operationally.",
                "Compare threshold performance against simpler clinical rules based on baseline risk factors alone.",
                "Review whether threshold performance is stable across treatment arms and key clinical subgroups.",
            ])
        elif executed.analysis_family in {"feature_importance", "partial_dependence"}:
            follow_up.extend([
                "Confirm the top-ranked features in a simpler interpretable model such as logistic regression or Cox analysis.",
                "Evaluate whether the same feature ranking persists across bootstrap samples or alternative training subsets.",
                "Review clinically adjacent variables to determine whether the top signal is a proxy for a broader underlying factor.",
            ])
        else:
            follow_up.append("Run an adjusted follow-up model that tests whether the observed signal persists after accounting for key baseline imbalances.")

        if supplemental_steps:
            follow_up.append(f"Inspect the supporting output from {supplemental_steps[0].title.lower()} and use it to refine the next model or subgroup review.")

        return follow_up

    def _build_limitations(
        self,
        executed: AnalysisRunResponse,
        metrics: dict[str, object],
    ) -> list[str]:
        limitations: list[str] = []

        if executed.warnings:
            limitations.extend([warning for warning in executed.warnings if str(warning).strip()])

        if executed.analysis_family in {"incidence", "risk_difference"}:
            limitations.append("This comparison is descriptive unless covariate adjustment and sensitivity analyses confirm that the group difference is robust.")
        elif executed.analysis_family == "logistic_regression":
            pseudo_r2 = self._to_float(metrics.get("pseudo_r_squared"))
            if pseudo_r2 is not None and pseudo_r2 < 0.1:
                limitations.append("Model fit appears modest, so the identified predictors may explain only a limited share of outcome variability.")
            limitations.append("Predictor effects should not be interpreted as causal without additional adjustment, interaction testing, and external clinical review.")
        elif executed.analysis_family in {"kaplan_meier", "cox"}:
            limitations.append("Time-to-event findings remain sensitive to censoring assumptions, event-definition rules, and baseline prognostic balance.")
        elif executed.analysis_family == "mixed_model":
            limitations.append("Longitudinal estimates can be sensitive to visit scheduling, missing data mechanisms, and the assumed covariance structure.")
        elif executed.analysis_family == "threshold_search":
            limitations.append("Threshold performance may be optimistic on the derivation dataset and requires independent validation.")
        elif executed.analysis_family in {"feature_importance", "partial_dependence"}:
            limitations.append("Machine-learning importance and dependence outputs are exploratory and should be confirmed in simpler, clinically interpretable analyses.")

        if not limitations:
            limitations.append("This result should be treated as exploratory until it is reviewed against endpoint definitions, data quality, and clinical context.")

        deduped: list[str] = []
        for item in limitations:
            cleaned = str(item).strip()
            if cleaned and cleaned not in deduped:
                deduped.append(cleaned)
        return deduped

    def _build_family_bottom_line(
        self,
        executed: AnalysisRunResponse,
        metrics: dict[str, object],
    ) -> str | None:
        if executed.analysis_family in {"incidence", "risk_difference"} and executed.table and executed.table.rows:
            group_col = executed.table.columns[0] if executed.table.columns else "group"
            rows = executed.table.rows
            sorted_rows = sorted(
                rows,
                key=lambda row: float(row.get("incidence_pct", 0) or 0),
                reverse=True,
            )
            if len(sorted_rows) >= 2:
                top = sorted_rows[0]
                bottom = sorted_rows[-1]
                top_group = str(top.get(group_col, "Top group"))
                bottom_group = str(bottom.get(group_col, "Comparison group"))
                top_rate = float(top.get("incidence_pct", 0) or 0)
                bottom_rate = float(bottom.get("incidence_pct", 0) or 0)
                if metrics.get("risk_difference") is not None and metrics.get("comparison_group") and metrics.get("reference_group"):
                    risk_difference_pp = float(metrics["risk_difference"]) * 100
                    comparison_group = str(metrics["comparison_group"])
                    reference_group = str(metrics["reference_group"])
                    return (
                        f"Events were more frequent in {top_group} than {bottom_group} "
                        f"({top_rate:.1f}% vs {bottom_rate:.1f}%). "
                        f"The estimated risk difference was {risk_difference_pp:+.1f} percentage points "
                        f"for {comparison_group} minus {reference_group}."
                    )
                return f"Events were more frequent in {top_group} than {bottom_group} ({top_rate:.1f}% vs {bottom_rate:.1f}%)."

        if executed.analysis_family == "logistic_regression" and executed.table and executed.table.rows:
            significant = [
                row for row in executed.table.rows
                if self._to_float(row.get("p_value")) is not None and self._to_float(row.get("p_value")) < 0.05
            ]
            if significant:
                top = min(significant, key=lambda row: self._to_float(row.get("p_value")) or 1)
                predictor = str(top.get("predictor", "A predictor")).replace("_", " ")
                odds_ratio = self._to_float(top.get("odds_ratio"))
                if odds_ratio is not None:
                    direction = "higher" if odds_ratio > 1 else "lower"
                    return f"{predictor} was associated with a {direction} odds of the endpoint (odds ratio {odds_ratio:.2f})."
            return "The model estimated subject-level odds of the endpoint from treatment and baseline predictors."

        if executed.analysis_family == "cox" and executed.table and executed.table.rows:
            significant = [
                row for row in executed.table.rows
                if self._to_float(row.get("p_value")) is not None and self._to_float(row.get("p_value")) < 0.05
            ]
            if significant:
                top = min(significant, key=lambda row: self._to_float(row.get("p_value")) or 1)
                predictor = str(top.get("predictor", "A predictor")).replace("_", " ")
                hazard_ratio = self._to_float(top.get("hazard_ratio"))
                if hazard_ratio is not None:
                    direction = "higher" if hazard_ratio > 1 else "lower"
                    return f"{predictor} was associated with a {direction} hazard of the event (hazard ratio {hazard_ratio:.2f})."
            return "The Cox model estimated time-to-event differences across treatment and baseline predictors."

        if executed.analysis_family == "kaplan_meier" and executed.table and executed.table.rows:
            group_col = executed.table.columns[0] if executed.table.columns else "group"
            rows = executed.table.rows
            if len(rows) >= 2:
                sorted_rows = sorted(rows, key=lambda row: self._to_float(row.get("median_survival")) or 0, reverse=True)
                top = sorted_rows[0]
                bottom = sorted_rows[-1]
                return (
                    f"{top.get(group_col, 'Top group')} showed longer median survival than "
                    f"{bottom.get(group_col, 'comparison group')}."
                )
            return "Kaplan-Meier group summaries were computed across treatment groups."

        return None

    def _build_user_evidence_points(
        self,
        executed: AnalysisRunResponse,
        metrics: dict[str, object],
    ) -> list[str]:
        if executed.analysis_family in {"incidence", "risk_difference"} and executed.table and executed.table.rows:
            group_col = executed.table.columns[0] if executed.table.columns else "group"
            rows = sorted(
                executed.table.rows,
                key=lambda row: float(row.get("incidence_pct", 0) or 0),
                reverse=True,
            )
            bullets = [
                f"{str(row.get(group_col, 'Group'))}: {float(row.get('incidence_pct', 0) or 0):.1f}% ({int(row.get('event_n', 0) or 0)}/{int(row.get('n', 0) or 0)} subjects)"
                for row in rows[:3]
            ]
            p_value = self._to_float(metrics.get("p_value"))
            if p_value is not None:
                bullets.append(f"Chi-square p-value: {p_value:.4f}")
            ci_lower = self._to_float(metrics.get("ci_lower_95"))
            ci_upper = self._to_float(metrics.get("ci_upper_95"))
            if ci_lower is not None and ci_upper is not None:
                bullets.append(f"Risk difference 95% CI: {ci_lower * 100:+.1f} to {ci_upper * 100:+.1f} percentage points")
            return bullets

        if executed.analysis_family == "logistic_regression" and executed.table and executed.table.rows:
            rows = sorted(
                executed.table.rows,
                key=lambda row: self._to_float(row.get("p_value")) or 1,
            )
            bullets = []
            for row in rows[:3]:
                predictor = str(row.get("predictor", "predictor")).replace("_", " ")
                odds_ratio = self._to_float(row.get("odds_ratio"))
                p_value = self._to_float(row.get("p_value"))
                if odds_ratio is not None and p_value is not None:
                    bullets.append(f"{predictor}: odds ratio {odds_ratio:.2f}, p={p_value:.4f}")
            pseudo_r2 = self._to_float(metrics.get("pseudo_r_squared"))
            if pseudo_r2 is not None:
                bullets.append(f"Pseudo R-squared: {pseudo_r2:.3f}")
            return bullets

        if executed.analysis_family == "cox" and executed.table and executed.table.rows:
            rows = sorted(
                executed.table.rows,
                key=lambda row: self._to_float(row.get("p_value")) or 1,
            )
            bullets = []
            for row in rows[:3]:
                predictor = str(row.get("predictor", "predictor")).replace("_", " ")
                hazard_ratio = self._to_float(row.get("hazard_ratio"))
                p_value = self._to_float(row.get("p_value"))
                if hazard_ratio is not None and p_value is not None:
                    bullets.append(f"{predictor}: hazard ratio {hazard_ratio:.2f}, p={p_value:.4f}")
            concordance = self._to_float(metrics.get("concordance_index"))
            if concordance is not None:
                bullets.append(f"Concordance index: {concordance:.3f}")
            return bullets

        if executed.analysis_family == "kaplan_meier" and executed.table and executed.table.rows:
            group_col = executed.table.columns[0] if executed.table.columns else "group"
            bullets = []
            for row in executed.table.rows[:3]:
                group = str(row.get(group_col, "Group"))
                median_survival = self._to_float(row.get("median_survival"))
                event_n = row.get("event_n")
                n = row.get("n")
                if median_survival is not None:
                    bullets.append(f"{group}: median survival {median_survival:.2f}, events {event_n}/{n}")
            log_rank = self._to_float(metrics.get("log_rank_p_value"))
            if log_rank is not None:
                bullets.append(f"Log-rank p-value: {log_rank:.4f}")
            return bullets

        fallback = [f"{metric.name.replace('_', ' ')}: {metric.value}" for metric in executed.metrics[:3]]
        if not fallback and executed.table and executed.table.rows:
            first_row = executed.table.rows[0]
            first_cols = executed.table.columns[: min(3, len(executed.table.columns))]
            fallback = [
                f"{column.replace('_', ' ')}: {first_row.get(column, '')}"
                for column in first_cols
                if column in first_row
            ]
        return fallback

    def _to_float(self, value: object) -> float | None:
        if isinstance(value, (int, float)):
            return float(value)
        if isinstance(value, str):
            try:
                return float(value)
            except ValueError:
                return None
        return None

    def _build_notebook_payload(self, run: AnalysisAgentRunResponse) -> dict:
        cells: list[dict] = [
            self._markdown_notebook_cell(
                [
                    "# AI Analysis Agent Run\n",
                    f"- Run ID: `{run.run_id}`\n",
                    f"- Analysis family: `{run.analysis_family}`\n",
                    f"- Executed: `{run.executed}`\n",
                    f"- Sources: {', '.join(run.selected_sources) or 'none'}\n",
                ]
            ),
            self._code_notebook_cell(
                self._lines(
                    "import json",
                    "import pandas as pd",
                    "from IPython.display import display, Markdown",
                    "",
                    "try:",
                    "    import plotly.graph_objects as go",
                    "except ImportError:",
                    "    go = None",
                    "",
                    "def show_step_table(title, columns, rows):",
                    "    df = pd.DataFrame(rows, columns=columns) if rows else pd.DataFrame(columns=columns)",
                    "    display(Markdown(f\"### {title}\"))",
                    "    display(df)",
                    "    return df",
                    "",
                    "def show_chart_from_spec(spec):",
                    "    if go is None:",
                    "        print(\"Plotly is not installed in this notebook environment. Chart spec is still available as a Python dict.\")",
                    "        return spec",
                    "    fig = go.Figure()",
                    "    for trace in spec.get('data', []):",
                    "        fig.add_trace(go.Figure(data=[trace]).data[0])",
                    "    fig.update_layout(**spec.get('layout', {}))",
                    "    fig.show()",
                    "    return fig",
                )
            ),
            self._code_notebook_cell(
                self._lines(
                    f"run_metadata = {json.dumps({'run_id': run.run_id, 'question': run.question, 'analysis_family': run.analysis_family, 'executed': run.executed, 'selected_sources': run.selected_sources, 'warnings': run.warnings}, indent=2)}",
                    "run_metadata",
                )
            ),
            self._markdown_notebook_cell(["## Final Answer\n", run.answer]),
        ]

        for step in run.steps:
            cells.append(
                self._markdown_notebook_cell(
                    [
                        f"## {step.title}\n",
                        f"- Status: `{step.status}`\n",
                        f"{step.summary}\n",
                        *([f"\n- {detail}\n" for detail in step.details] if step.details else []),
                        *(
                            [
                                f"\n- Sources: {', '.join(step.provenance.source_names)}\n",
                                *([f"- Variables: {', '.join(step.provenance.columns_used)}\n"] if step.provenance.columns_used else []),
                                *([f"- Derived columns: {', '.join(step.provenance.derived_columns)}\n"] if step.provenance.derived_columns else []),
                                *([f"- Filters: {', '.join(step.provenance.cohort_filters_applied)}\n"] if step.provenance.cohort_filters_applied else []),
                                *([f"- Join logic: {', '.join(step.provenance.join_keys)}\n"] if step.provenance.join_keys else []),
                                *([f"- Note: {step.provenance.note}\n"] if step.provenance.note else []),
                            ]
                            if step.provenance
                            else []
                        ),
                    ]
                )
            )
            if step.code:
                cells.append(self._code_notebook_cell(step.code))
            if step.table:
                cells.append(
                    self._code_notebook_cell(
                        self._build_notebook_table_code(step.id, step.table.title or "Table", step.table.columns, step.table.rows)
                    )
                )
            if step.chart:
                cells.append(
                    self._code_notebook_cell(
                        self._build_notebook_chart_code(step.id, {"data": step.chart.data, "layout": step.chart.layout})
                    )
                )

        return {
            "cells": cells,
            "metadata": {
                "kernelspec": {
                    "display_name": "Python 3",
                    "language": "python",
                    "name": "python3",
                },
                "language_info": {
                    "name": "python",
                    "version": "3.x",
                },
            },
            "nbformat": 4,
            "nbformat_minor": 5,
        }

    def _markdown_notebook_cell(self, source: list[str] | str) -> dict:
        return {
            "cell_type": "markdown",
            "metadata": {},
            "source": source if isinstance(source, list) else [source],
        }

    def _code_notebook_cell(self, source: list[str] | str) -> dict:
        return {
            "cell_type": "code",
            "execution_count": None,
            "metadata": {},
            "outputs": [],
            "source": source if isinstance(source, list) else [source],
        }

    def _lines(self, *lines: str) -> list[str]:
        return [f"{line}\n" for line in lines]

    def _build_notebook_table_code(
        self,
        step_id: str,
        title: str,
        columns: list[str],
        rows: list[dict[str, str | float | int]],
    ) -> list[str]:
        variable_prefix = self._sanitize_notebook_identifier(step_id)
        return self._lines(
            f"{variable_prefix}_table_columns = {json.dumps(columns)}",
            f"{variable_prefix}_table_rows = {json.dumps(rows, indent=2)}",
            f"{variable_prefix}_table_df = show_step_table({json.dumps(title)}, {variable_prefix}_table_columns, {variable_prefix}_table_rows)",
            f"{variable_prefix}_table_df.head()",
        )

    def _build_notebook_chart_code(
        self,
        step_id: str,
        chart_spec: dict[str, object],
    ) -> list[str]:
        variable_prefix = self._sanitize_notebook_identifier(step_id)
        return self._lines(
            f"{variable_prefix}_chart_spec = {json.dumps(chart_spec, indent=2)}",
            f"{variable_prefix}_figure = show_chart_from_spec({variable_prefix}_chart_spec)",
            f"{variable_prefix}_chart_spec",
        )

    def _sanitize_notebook_identifier(self, value: str) -> str:
        sanitized = re.sub(r"[^0-9a-zA-Z_]+", "_", value).strip("_")
        if not sanitized:
            return "step"
        if sanitized[0].isdigit():
            return f"step_{sanitized}"
        return sanitized

    def _build_html_report(self, run: AnalysisAgentRunResponse) -> str:
        sections = []
        for step in run.steps:
            details_html = "".join(f"<li>{self._escape_html(detail)}</li>" for detail in step.details)
            provenance_html = ""
            if step.provenance:
                provenance_items = []
                if step.provenance.source_names:
                    provenance_items.append(f"<li><strong>Sources:</strong> {self._escape_html(', '.join(step.provenance.source_names))}</li>")
                if step.provenance.columns_used:
                    provenance_items.append(f"<li><strong>Variables:</strong> {self._escape_html(', '.join(step.provenance.columns_used))}</li>")
                if step.provenance.derived_columns:
                    provenance_items.append(f"<li><strong>Derived columns:</strong> {self._escape_html(', '.join(step.provenance.derived_columns))}</li>")
                if step.provenance.cohort_filters_applied:
                    provenance_items.append(f"<li><strong>Filters:</strong> {self._escape_html(', '.join(step.provenance.cohort_filters_applied))}</li>")
                if step.provenance.join_keys:
                    provenance_items.append(f"<li><strong>Join logic:</strong> {self._escape_html(', '.join(step.provenance.join_keys))}</li>")
                if step.provenance.note:
                    provenance_items.append(f"<li><strong>Note:</strong> {self._escape_html(step.provenance.note)}</li>")
                if provenance_items:
                    provenance_html = f"<h4>Provenance</h4><ul>{''.join(provenance_items)}</ul>"
            code_html = (
                f"<pre><code>{self._escape_html(step.code or '')}</code></pre>"
                if step.code
                else ""
            )
            table_html = ""
            if step.table:
                header = "".join(f"<th>{self._escape_html(column)}</th>" for column in step.table.columns)
                rows = "".join(
                    "<tr>" + "".join(
                        f"<td>{self._escape_html(str(row.get(column, '')))}</td>"
                        for column in step.table.columns
                    ) + "</tr>"
                    for row in step.table.rows
                )
                table_html = (
                    f"<h4>{self._escape_html(step.table.title or 'Table')}</h4>"
                    f"<table><thead><tr>{header}</tr></thead><tbody>{rows}</tbody></table>"
                )
            chart_html = (
                f"<pre><code>{self._escape_html(json.dumps({'data': step.chart.data, 'layout': step.chart.layout}, indent=2))}</code></pre>"
                if step.chart
                else ""
            )
            sections.append(
                f"""
                <section>
                  <h2>{self._escape_html(step.title)}</h2>
                  <p><strong>Status:</strong> {self._escape_html(step.status)}</p>
                  <p>{self._escape_html(step.summary)}</p>
                  {'<ul>' + details_html + '</ul>' if details_html else ''}
                  {provenance_html}
                  {code_html}
                  {table_html}
                  {chart_html}
                </section>
                """
            )

        return f"""
        <html>
          <head>
            <meta charset="utf-8" />
            <title>{self._escape_html(run.run_id)}</title>
            <style>
              body {{ font-family: Arial, sans-serif; margin: 32px; color: #0f172a; }}
              h1, h2, h3, h4 {{ color: #0f172a; }}
              pre {{ background: #0f172a; color: #e2e8f0; padding: 16px; border-radius: 8px; overflow-x: auto; }}
              table {{ border-collapse: collapse; width: 100%; margin: 16px 0; }}
              th, td {{ border: 1px solid #e2e8f0; padding: 8px; text-align: left; }}
              th {{ background: #f8fafc; }}
              section {{ margin-bottom: 28px; }}
            </style>
          </head>
          <body>
            <h1>AI Analysis Agent Run</h1>
            <p><strong>Run ID:</strong> {self._escape_html(run.run_id)}</p>
            <p><strong>Family:</strong> {self._escape_html(run.analysis_family)}</p>
            <p><strong>Sources:</strong> {self._escape_html(', '.join(run.selected_sources))}</p>
            <h2>Final Answer</h2>
            <p>{self._escape_html(run.answer)}</p>
            {''.join(sections)}
          </body>
        </html>
        """

    def _escape_html(self, value: str) -> str:
        return (
            value.replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
            .replace('"', "&quot;")
            .replace("'", "&#39;")
        )

    def _read_dataset_frame(self, dataset: DatasetReference) -> pd.DataFrame | None:
        if not dataset.content:
            return None
        try:
            return pd.read_csv(StringIO(dataset.content))
        except Exception:
            return None

    def _find_column(self, frame: pd.DataFrame, hints: tuple[str, ...]) -> str | None:
        normalized = {self._normalize(column): column for column in frame.columns}
        for hint in hints:
            needle = self._normalize(hint)
            if needle in normalized:
                return normalized[needle]
            for normalized_name, original in normalized.items():
                if needle == normalized_name or needle in normalized_name:
                    return original
        return None

    def _normalize(self, value: str) -> str:
        return "".join(character.lower() for character in value if character.isalnum())
