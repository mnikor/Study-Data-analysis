from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, Field


CapabilityStatus = Literal["executable", "missing_data", "unsupported"]
CapabilitySupportLevel = Literal["supported", "partial", "unsupported"]
CapabilityBlockerStage = Literal["none", "selection", "planner", "data", "method"]
AnalysisFamily = Literal[
    "incidence",
    "risk_difference",
    "logistic_regression",
    "kaplan_meier",
    "cox",
    "mixed_model",
    "threshold_search",
    "competing_risks",
    "feature_importance",
    "partial_dependence",
    "unknown",
]
FilterOperator = Literal["equals", "contains", "gte", "lte"]


class AnalysisMetric(BaseModel):
    name: str
    value: str | float | int


class AnalysisTable(BaseModel):
    title: str
    columns: List[str]
    rows: List[dict[str, str | float | int]]


class AnalysisExecutionReceipt(BaseModel):
    source_names: List[str] = Field(default_factory=list)
    derived_columns: List[str] = Field(default_factory=list)
    row_count: Optional[int] = None
    column_count: Optional[int] = None
    subject_identifier: Optional[str] = None
    treatment_variable: Optional[str] = None
    outcome_variable: Optional[str] = None
    time_variable: Optional[str] = None
    event_variable: Optional[str] = None
    endpoint_label: Optional[str] = None
    target_definition: Optional[str] = None
    cohort_filters_applied: List[str] = Field(default_factory=list)


class AnalysisFilter(BaseModel):
    field: str
    operator: FilterOperator
    value: str
    label: Optional[str] = None


class DatasetReference(BaseModel):
    file_id: str
    name: str
    role: Optional[str] = None
    preferred: bool = False
    row_count: Optional[int] = None
    column_names: List[str] = Field(default_factory=list)
    content: Optional[str] = None


class AnalysisCapabilityRequest(BaseModel):
    question: str
    datasets: List[DatasetReference] = Field(default_factory=list)


class AnalysisCapabilityResponse(BaseModel):
    status: CapabilityStatus
    analysis_family: AnalysisFamily = "unknown"
    executable: bool = False
    requires_row_level_data: bool = False
    missing_roles: List[str] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)
    explanation: str
    assessment: Optional["AnalysisCapabilityAssessment"] = None


class AnalysisCapabilityAssessment(BaseModel):
    support_level: CapabilitySupportLevel = "unsupported"
    blocker_stage: CapabilityBlockerStage = "none"
    blocker_reason: Optional[str] = None
    recommended_next_step: Optional[str] = None
    fallback_option: Optional[str] = None
    data_requirements: List[str] = Field(default_factory=list)
    method_constraints: List[str] = Field(default_factory=list)


class AnalysisSpec(BaseModel):
    analysis_family: AnalysisFamily = "unknown"
    target_definition: Optional[str] = None
    endpoint_label: Optional[str] = None
    treatment_variable: Optional[str] = None
    outcome_variable: Optional[str] = None
    time_variable: Optional[str] = None
    event_variable: Optional[str] = None
    repeated_measure_variable: Optional[str] = None
    repeated_time_variable: Optional[str] = None
    subject_variable: Optional[str] = None
    competing_event_variable: Optional[str] = None
    grade_threshold: Optional[int] = None
    term_filters: List[str] = Field(default_factory=list)
    cohort_filters: List[AnalysisFilter] = Field(default_factory=list)
    covariates: List[str] = Field(default_factory=list)
    interaction_terms: List[str] = Field(default_factory=list)
    threshold_variables: List[str] = Field(default_factory=list)
    threshold_direction: Optional[Literal["gte", "lte", "auto"]] = None
    threshold_metric: Optional[Literal["balanced_accuracy", "youden_j", "f1"]] = None
    time_window_days: Optional[int] = None
    requested_outputs: List[str] = Field(default_factory=list)
    notes: List[str] = Field(default_factory=list)


class AnalysisPlanRequest(BaseModel):
    question: str
    datasets: List[DatasetReference] = Field(default_factory=list)


class AnalysisPlanResponse(BaseModel):
    status: CapabilityStatus
    spec: Optional[AnalysisSpec] = None
    missing_roles: List[str] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)
    explanation: str
    assessment: Optional[AnalysisCapabilityAssessment] = None


class WorkspaceBuildRequest(BaseModel):
    question: str
    datasets: List[DatasetReference] = Field(default_factory=list)
    spec: Optional[AnalysisSpec] = None


class WorkspaceBuildResponse(BaseModel):
    status: CapabilityStatus
    workspace_id: Optional[str] = None
    source_names: List[str] = Field(default_factory=list)
    missing_roles: List[str] = Field(default_factory=list)
    row_count: Optional[int] = None
    column_count: Optional[int] = None
    derived_columns: List[str] = Field(default_factory=list)
    preview_table: Optional[AnalysisTable] = None
    notes: List[str] = Field(default_factory=list)
    explanation: str


class AnalysisRunRequest(BaseModel):
    question: str
    datasets: List[DatasetReference] = Field(default_factory=list)
    spec: Optional[AnalysisSpec] = None
    workspace_id: Optional[str] = None


class AnalysisRunResponse(BaseModel):
    status: CapabilityStatus
    executed: bool = False
    analysis_family: AnalysisFamily = "unknown"
    workspace_id: Optional[str] = None
    interpretation: Optional[str] = None
    metrics: List[AnalysisMetric] = Field(default_factory=list)
    table: Optional[AnalysisTable] = None
    receipt: Optional[AnalysisExecutionReceipt] = None
    warnings: List[str] = Field(default_factory=list)
    explanation: str


AgentStepStatus = Literal["completed", "failed", "skipped"]


class AnalysisAgentChart(BaseModel):
    data: List[dict] = Field(default_factory=list)
    layout: Dict[str, object] = Field(default_factory=dict)


class AnalysisAgentProvenance(BaseModel):
    source_names: List[str] = Field(default_factory=list)
    columns_used: List[str] = Field(default_factory=list)
    derived_columns: List[str] = Field(default_factory=list)
    cohort_filters_applied: List[str] = Field(default_factory=list)
    join_keys: List[str] = Field(default_factory=list)
    note: Optional[str] = None


class AnalysisAgentStep(BaseModel):
    id: str
    title: str
    status: AgentStepStatus
    summary: str
    details: List[str] = Field(default_factory=list)
    code: Optional[str] = None
    chart: Optional[AnalysisAgentChart] = None
    table: Optional[AnalysisTable] = None
    provenance: Optional[AnalysisAgentProvenance] = None


class AnalysisAgentUserSummary(BaseModel):
    bottom_line: str
    evidence_points: List[str] = Field(default_factory=list)
    potential_hypotheses: List[str] = Field(default_factory=list)
    recommended_follow_up: List[str] = Field(default_factory=list)
    limitations: List[str] = Field(default_factory=list)
    next_step: Optional[str] = None
    context_note: Optional[str] = None


class AnalysisAgentBrief(BaseModel):
    analysis_family: AnalysisFamily = "unknown"
    target_definition: Optional[str] = None
    endpoint_label: Optional[str] = None
    treatment_variable: Optional[str] = None
    subgroup_factors: List[str] = Field(default_factory=list)
    required_roles: List[str] = Field(default_factory=list)
    missing_roles: List[str] = Field(default_factory=list)
    selected_sources: List[str] = Field(default_factory=list)
    selected_roles: Dict[str, str] = Field(default_factory=dict)
    time_window_days: Optional[int] = None
    grade_threshold: Optional[int] = None
    term_filters: List[str] = Field(default_factory=list)
    cohort_filters: List[str] = Field(default_factory=list)
    interaction_terms: List[str] = Field(default_factory=list)
    requested_outputs: List[str] = Field(default_factory=list)
    notes: List[str] = Field(default_factory=list)
    assessment: Optional[AnalysisCapabilityAssessment] = None


class AnalysisAgentPlanRequest(BaseModel):
    question: str
    datasets: List[DatasetReference] = Field(default_factory=list)


class AnalysisAgentPlanResponse(BaseModel):
    run_id: str
    status: CapabilityStatus
    analysis_family: AnalysisFamily = "unknown"
    selected_sources: List[str] = Field(default_factory=list)
    selected_roles: Dict[str, str] = Field(default_factory=dict)
    brief: Optional[AnalysisAgentBrief] = None
    steps: List[AnalysisAgentStep] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)
    explanation: str


class AnalysisAgentRunRequest(BaseModel):
    question: str
    datasets: List[DatasetReference] = Field(default_factory=list)


class AnalysisAgentRunResponse(BaseModel):
    run_id: str
    question: str = ""
    created_at: Optional[str] = None
    status: CapabilityStatus
    missing_roles: List[str] = Field(default_factory=list)
    executed: bool = False
    analysis_family: AnalysisFamily = "unknown"
    selected_sources: List[str] = Field(default_factory=list)
    selected_roles: Dict[str, str] = Field(default_factory=dict)
    workspace_id: Optional[str] = None
    steps: List[AnalysisAgentStep] = Field(default_factory=list)
    answer: str
    user_summary: Optional[AnalysisAgentUserSummary] = None
    chart: Optional[AnalysisAgentChart] = None
    table: Optional[AnalysisTable] = None
    warnings: List[str] = Field(default_factory=list)
    explanation: str


class AnalysisAgentRunSummary(BaseModel):
    run_id: str
    question: str = ""
    created_at: Optional[str] = None
    status: CapabilityStatus
    missing_roles: List[str] = Field(default_factory=list)
    executed: bool = False
    analysis_family: AnalysisFamily = "unknown"
    selected_sources: List[str] = Field(default_factory=list)


class AnalysisAgentExportResponse(BaseModel):
    run_id: str
    format: Literal["ipynb", "html"]
    filename: str
    mime_type: str
    content: str
