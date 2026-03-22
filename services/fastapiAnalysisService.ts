export interface FastApiDatasetReference {
  file_id: string;
  name: string;
  role?: string;
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

const CONFIGURED_FASTAPI_BASE_URL = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env
  ?.VITE_FASTAPI_BASE_URL;

const directCandidateUrls = () => {
  if (typeof window === 'undefined') {
    return ['http://localhost:8000/api/v1', 'http://127.0.0.1:8000/api/v1'];
  }

  const host = window.location.hostname || 'localhost';
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
