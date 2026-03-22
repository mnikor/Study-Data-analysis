from typing import List, Literal, Optional

from pydantic import BaseModel, Field


CapabilityStatus = Literal["executable", "missing_data", "unsupported"]
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


class AnalysisFilter(BaseModel):
    field: str
    operator: FilterOperator
    value: str
    label: Optional[str] = None


class DatasetReference(BaseModel):
    file_id: str
    name: str
    role: Optional[str] = None
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
    warnings: List[str] = Field(default_factory=list)
    explanation: str
