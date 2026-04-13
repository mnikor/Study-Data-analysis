export interface FastApiDatasetReference {
  file_id: string;
  name: string;
  role?: string;
  preferred?: boolean;
  row_count?: number;
  column_names?: string[];
  content?: string;
}

export interface FastApiCapabilityResponse {
  status: 'executable' | 'missing_data' | 'unsupported';
  analysis_family:
    | 'incidence'
    | 'risk_difference'
    | 'logistic_regression'
    | 'kaplan_meier'
    | 'cox'
    | 'mixed_model'
    | 'threshold_search'
    | 'competing_risks'
    | 'feature_importance'
    | 'partial_dependence'
    | 'unknown';
  executable: boolean;
  requires_row_level_data: boolean;
  missing_roles: string[];
  warnings: string[];
  explanation: string;
  assessment?: {
    support_level: 'supported' | 'partial' | 'unsupported';
    blocker_stage: 'none' | 'selection' | 'planner' | 'data' | 'method';
    blocker_reason?: string | null;
    recommended_next_step?: string | null;
    fallback_option?: string | null;
    data_requirements: string[];
    method_constraints: string[];
  } | null;
}

export interface FastApiAnalysisSpec {
  analysis_family: FastApiCapabilityResponse['analysis_family'];
  target_definition?: string | null;
  endpoint_label?: string | null;
  treatment_variable?: string | null;
  outcome_variable?: string | null;
  time_variable?: string | null;
  event_variable?: string | null;
  repeated_measure_variable?: string | null;
  repeated_time_variable?: string | null;
  subject_variable?: string | null;
  competing_event_variable?: string | null;
  grade_threshold?: number | null;
  term_filters: string[];
  cohort_filters?: Array<{
    field: string;
    operator: 'equals' | 'contains' | 'gte' | 'lte';
    value: string;
    label?: string | null;
  }>;
  covariates: string[];
  interaction_terms: string[];
  threshold_variables?: string[];
  threshold_direction?: 'gte' | 'lte' | 'auto' | null;
  threshold_metric?: 'balanced_accuracy' | 'youden_j' | 'f1' | null;
  time_window_days?: number | null;
  requested_outputs: string[];
  notes: string[];
}

export interface FastApiPlanResponse {
  status: FastApiCapabilityResponse['status'];
  spec?: FastApiAnalysisSpec | null;
  missing_roles: string[];
  warnings: string[];
  explanation: string;
  assessment?: FastApiCapabilityResponse['assessment'];
}

export interface FastApiAnalysisTable {
  title: string;
  columns: string[];
  rows: Array<Record<string, string | number>>;
}

export interface FastApiWorkspaceResponse {
  status: FastApiCapabilityResponse['status'];
  workspace_id?: string | null;
  source_names: string[];
  missing_roles: string[];
  row_count?: number | null;
  column_count?: number | null;
  derived_columns: string[];
  preview_table?: FastApiAnalysisTable | null;
  notes: string[];
  explanation: string;
}

export interface FastApiRunMetric {
  name: string;
  value: string | number;
}

export interface FastApiRunResponse {
  status: FastApiCapabilityResponse['status'];
  executed: boolean;
  analysis_family: FastApiCapabilityResponse['analysis_family'];
  workspace_id?: string | null;
  interpretation?: string | null;
  metrics: FastApiRunMetric[];
  table?: FastApiAnalysisTable | null;
  receipt?: {
    source_names: string[];
    derived_columns: string[];
    row_count?: number | null;
    column_count?: number | null;
    subject_identifier?: string | null;
    treatment_variable?: string | null;
    outcome_variable?: string | null;
    time_variable?: string | null;
    event_variable?: string | null;
    endpoint_label?: string | null;
    target_definition?: string | null;
    cohort_filters_applied: string[];
  } | null;
  warnings: string[];
  explanation: string;
}

export interface FastApiAgentChart {
  data: any[];
  layout: any;
}

export interface FastApiAgentStep {
  id: string;
  title: string;
  status: 'completed' | 'failed' | 'skipped';
  summary: string;
  details: string[];
  code?: string | null;
  chart?: FastApiAgentChart | null;
  table?: FastApiAnalysisTable | null;
  provenance?: {
    source_names: string[];
    columns_used: string[];
    derived_columns: string[];
    cohort_filters_applied: string[];
    join_keys: string[];
    note?: string | null;
  } | null;
}

export interface FastApiAgentUserSummary {
  bottom_line: string;
  evidence_points: string[];
  potential_hypotheses?: string[];
  recommended_follow_up?: string[];
  limitations?: string[];
  next_step?: string | null;
  context_note?: string | null;
}

export interface FastApiAgentBrief {
  analysis_family: FastApiCapabilityResponse['analysis_family'];
  target_definition?: string | null;
  endpoint_label?: string | null;
  treatment_variable?: string | null;
  subgroup_factors: string[];
  required_roles: string[];
  missing_roles: string[];
  selected_sources: string[];
  selected_roles: Record<string, string>;
  time_window_days?: number | null;
  grade_threshold?: number | null;
  term_filters: string[];
  cohort_filters: string[];
  interaction_terms: string[];
  requested_outputs: string[];
  notes: string[];
  assessment?: FastApiCapabilityResponse['assessment'];
}

export interface FastApiAgentPlanResponse {
  run_id: string;
  status: FastApiCapabilityResponse['status'];
  analysis_family: FastApiCapabilityResponse['analysis_family'];
  selected_sources: string[];
  selected_roles: Record<string, string>;
  brief?: FastApiAgentBrief | null;
  steps: FastApiAgentStep[];
  warnings: string[];
  explanation: string;
}

export interface FastApiAgentRunResponse {
  run_id: string;
  question: string;
  created_at?: string | null;
  status: FastApiCapabilityResponse['status'];
  missing_roles: string[];
  executed: boolean;
  analysis_family: FastApiCapabilityResponse['analysis_family'];
  selected_sources: string[];
  selected_roles: Record<string, string>;
  workspace_id?: string | null;
  steps: FastApiAgentStep[];
  answer: string;
  user_summary?: FastApiAgentUserSummary | null;
  chart?: FastApiAgentChart | null;
  table?: FastApiAnalysisTable | null;
  warnings: string[];
  explanation: string;
}

export interface FastApiAgentRunSummary {
  run_id: string;
  question: string;
  created_at?: string | null;
  status: FastApiCapabilityResponse['status'];
  missing_roles: string[];
  executed: boolean;
  analysis_family: FastApiCapabilityResponse['analysis_family'];
  selected_sources: string[];
}

const CONFIGURED_FASTAPI_BASE_URL = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env
  ?.VITE_FASTAPI_BASE_URL;

const directCandidateUrls = () => {
  if (typeof window === 'undefined') {
    return ['http://localhost:8000/api/v1', 'http://127.0.0.1:8000/api/v1'];
  }

  const host = window.location.hostname || 'localhost';
  const isLocalHost =
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '0.0.0.0' ||
    host.endsWith('.local');
  if (!isLocalHost) {
    return [];
  }
  const preferredHost = host === '127.0.0.1' ? '127.0.0.1' : 'localhost';
  const secondaryHost = preferredHost === 'localhost' ? '127.0.0.1' : 'localhost';
  return [`http://${preferredHost}:8000/api/v1`, `http://${secondaryHost}:8000/api/v1`];
};

const unique = (values: string[]) => Array.from(new Set(values.filter(Boolean)));

const getCandidateBaseUrls = () =>
  unique([
    CONFIGURED_FASTAPI_BASE_URL || '',
    '/api/v1',
    ...directCandidateUrls(),
  ]);

const buildErrorMessage = async (response: Response, baseUrl: string) => {
  const message = await response.text().catch(() => '');
  return message || `FastAPI request failed (${response.status}) via ${baseUrl}`;
};

const postJson = async <T>(path: string, payload: unknown): Promise<T> => {
  const baseUrls = getCandidateBaseUrls();
  const errors: string[] = [];

  for (const baseUrl of baseUrls) {
    try {
      const response = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        return response.json() as Promise<T>;
      }

      const message = await buildErrorMessage(response, baseUrl);
      errors.push(message);

      if (![404, 502, 503].includes(response.status)) {
        throw new Error(message);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${baseUrl}: ${message}`);
    }
  }

  throw new Error(errors[errors.length - 1] || 'FastAPI request failed.');
};

const getJson = async <T>(path: string): Promise<T> => {
  const baseUrls = getCandidateBaseUrls();
  const errors: string[] = [];

  for (const baseUrl of baseUrls) {
    try {
      const response = await fetch(`${baseUrl}${path}`);

      if (response.ok) {
        return response.json() as Promise<T>;
      }

      const message = await buildErrorMessage(response, baseUrl);
      errors.push(message);

      if (![404, 502, 503].includes(response.status)) {
        throw new Error(message);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${baseUrl}: ${message}`);
    }
  }

  throw new Error(errors[errors.length - 1] || 'FastAPI request failed.');
};

export const classifyAnalysisCapabilities = async (
  question: string,
  datasets: FastApiDatasetReference[]
): Promise<FastApiCapabilityResponse> =>
  postJson<FastApiCapabilityResponse>('/analysis/capabilities', {
    question,
    datasets,
  });

export const requestAnalysisPlan = async (
  question: string,
  datasets: FastApiDatasetReference[]
): Promise<FastApiPlanResponse> =>
  postJson<FastApiPlanResponse>('/analysis/plan', {
    question,
    datasets,
  });

export const buildAnalysisWorkspace = async (
  question: string,
  datasets: FastApiDatasetReference[],
  spec?: FastApiAnalysisSpec | null
): Promise<FastApiWorkspaceResponse> =>
  postJson<FastApiWorkspaceResponse>('/analysis/build-workspace', {
    question,
    datasets,
    spec,
  });

export const runBackendAnalysis = async (
  question: string,
  datasets: FastApiDatasetReference[],
  spec?: FastApiAnalysisSpec | null,
  workspaceId?: string | null
): Promise<FastApiRunResponse> =>
  postJson<FastApiRunResponse>('/analysis/run', {
    question,
    datasets,
    spec,
    workspace_id: workspaceId,
  });

export const planAnalysisAgent = async (
  question: string,
  datasets: FastApiDatasetReference[]
): Promise<FastApiAgentPlanResponse> =>
  postJson<FastApiAgentPlanResponse>('/analysis/agent/plan', {
    question,
    datasets,
  });

export const runAnalysisAgent = async (
  question: string,
  datasets: FastApiDatasetReference[]
): Promise<FastApiAgentRunResponse> =>
  postJson<FastApiAgentRunResponse>('/analysis/agent/run', {
    question,
    datasets,
  });

export const getAnalysisAgentRun = async (runId: string): Promise<FastApiAgentRunResponse> =>
  getJson<FastApiAgentRunResponse>(`/analysis/agent/run/${runId}`);

export const listAnalysisAgentRuns = async (limit = 20): Promise<FastApiAgentRunSummary[]> =>
  getJson<FastApiAgentRunSummary[]>(`/analysis/agent/runs?limit=${limit}`);

export interface FastApiAgentExportResponse {
  run_id: string;
  format: 'ipynb' | 'html';
  filename: string;
  mime_type: string;
  content: string;
}

export const exportAnalysisAgentRun = async (
  runId: string,
  format: 'ipynb' | 'html'
): Promise<FastApiAgentExportResponse> =>
  getJson<FastApiAgentExportResponse>(`/analysis/agent/run/${runId}/export/${format}`);
