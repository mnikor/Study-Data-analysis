import { AnalysisResponse, ClinicalFile } from "../types";
import { type FastApiRunResponse } from "./fastapiAnalysisService";

export const metricsListToRecord = (
  metrics: Array<{ name: string; value: string | number }>
): Record<string, string | number> =>
  Object.fromEntries(metrics.map((metric) => [metric.name, metric.value]));

export const toFiniteNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

export const buildDeterministicChartConfig = (
  analysisFamily: string,
  table?: { title: string; columns: string[]; rows: Array<Record<string, string | number>> } | null
) => {
  if (!table || table.rows.length === 0) {
    return {
      data: [],
      layout: {
        title: { text: `${humanizeFamilyLabel(analysisFamily)} result` },
      },
    };
  }

  if (analysisFamily === 'incidence' || analysisFamily === 'risk_difference') {
    const categoryColumn = table.columns[0];
    const values = table.rows.map((row) => toFiniteNumber(row.incidence_pct) ?? 0);
    return {
      data: [
        {
          type: 'bar',
          x: table.rows.map((row) => String(row[categoryColumn] ?? '')),
          y: values,
          marker: { color: '#2563eb' },
        },
      ],
      layout: {
        title: { text: table.title || 'Incidence by treatment group' },
        xaxis: { title: categoryColumn },
        yaxis: { title: 'Incidence (%)' },
      },
    };
  }

  if (analysisFamily === 'kaplan_meier') {
    const categoryColumn = table.columns[0];
    return {
      data: [
        {
          type: 'bar',
          x: table.rows.map((row) => String(row[categoryColumn] ?? '')),
          y: table.rows.map((row) => toFiniteNumber(row.median_survival)),
          marker: { color: '#0f766e' },
          customdata: table.rows.map((row) => [row.event_n, row.n]),
          hovertemplate: '%{x}<br>Median survival: %{y}<br>Events: %{customdata[0]} / %{customdata[1]}<extra></extra>',
        },
      ],
      layout: {
        title: { text: table.title || 'Kaplan-Meier summary by treatment group' },
        xaxis: { title: categoryColumn },
        yaxis: { title: 'Median survival' },
      },
    };
  }

  if (analysisFamily === 'competing_risks') {
    const categoryColumn = table.columns[0];
    return {
      data: [
        {
          type: 'bar',
          x: table.rows.map((row) => String(row[categoryColumn] ?? '')),
          y: table.rows.map((row) => toFiniteNumber(row.cumulative_incidence) ?? 0),
          marker: { color: '#b45309' },
          customdata: table.rows.map((row) => [row.event_of_interest_n, row.competing_event_n]),
          hovertemplate: '%{x}<br>Cumulative incidence: %{y}<br>Event of interest: %{customdata[0]}<br>Competing events: %{customdata[1]}<extra></extra>',
        },
      ],
      layout: {
        title: { text: table.title || 'Competing-risks cumulative incidence' },
        xaxis: { title: categoryColumn },
        yaxis: { title: 'Cumulative incidence' },
      },
    };
  }

  if (analysisFamily === 'logistic_regression' || analysisFamily === 'cox' || analysisFamily === 'mixed_model') {
    const isRepeated = analysisFamily === 'mixed_model';
    const estimateKey = analysisFamily === 'cox' ? 'hazard_ratio' : 'odds_ratio';
    const color = analysisFamily === 'cox' ? '#dc2626' : isRepeated ? '#0891b2' : '#7c3aed';
    const x = table.rows.map((row) => toFiniteNumber(row[isRepeated ? 'coefficient' : estimateKey]) ?? (isRepeated ? 0 : 1));
    const lower = table.rows.map((row) => toFiniteNumber(row.ci_lower_95) ?? (isRepeated ? 0 : 1));
    const upper = table.rows.map((row) => toFiniteNumber(row.ci_upper_95) ?? (isRepeated ? 0 : 1));
    return {
      data: [
        {
          type: 'scatter',
          mode: 'markers',
          x,
          y: table.rows.map((row) => String(row.predictor ?? '')),
          marker: { color, size: 12 },
          error_x: {
            type: 'data',
            visible: true,
            array: upper.map((value, index) => value - x[index]),
            arrayminus: lower.map((value, index) => x[index] - value),
          },
          hovertemplate: `%{y}<br>${(isRepeated ? 'coefficient' : estimateKey).replace('_', ' ')}: %{x}<extra></extra>`,
        },
      ],
      layout: {
        title: { text: table.title || humanizeFamilyLabel(analysisFamily) },
        xaxis: { title: (isRepeated ? 'coefficient' : estimateKey).replace('_', ' ') },
        yaxis: { automargin: true },
        shapes: [
          {
            type: 'line',
            x0: isRepeated ? 0 : 1,
            x1: isRepeated ? 0 : 1,
            y0: -0.5,
            y1: Math.max(0.5, table.rows.length - 0.5),
            line: { color: '#94a3b8', dash: 'dash' },
          },
        ],
      },
    };
  }

  if (analysisFamily === 'threshold_search') {
    return {
      data: [
        {
          type: 'bar',
          x: table.rows.map((row) => String(row.predictor ?? '')),
          y: table.rows.map((row) => toFiniteNumber(row.score) ?? 0),
          marker: { color: '#0f766e' },
          customdata: table.rows.map((row) => [row.threshold, row.direction, row.balanced_accuracy, row.sensitivity, row.specificity]),
          hovertemplate: '%{x}<br>Score: %{y}<br>Threshold: %{customdata[0]} (%{customdata[1]})<br>Balanced accuracy: %{customdata[2]}<br>Sensitivity: %{customdata[3]}<br>Specificity: %{customdata[4]}<extra></extra>',
        },
      ],
      layout: {
        title: { text: table.title || 'Threshold search ranking' },
        xaxis: { automargin: true },
        yaxis: { title: 'Optimization score' },
      },
    };
  }

  if (analysisFamily === 'feature_importance') {
    return {
      data: [
        {
          type: 'bar',
          x: table.rows.map((row) => toFiniteNumber(row.importance) ?? 0),
          y: table.rows.map((row) => String(row.predictor ?? '')),
          orientation: 'h',
          marker: { color: '#2563eb' },
          hovertemplate: '%{y}<br>Importance: %{x}<extra></extra>',
        },
      ],
      layout: {
        title: { text: table.title || 'Exploratory feature importance' },
        xaxis: { title: 'Importance' },
        yaxis: { automargin: true, autorange: 'reversed' },
      },
    };
  }

  if (analysisFamily === 'partial_dependence') {
    const features = Array.from(new Set(table.rows.map((row) => String(row.feature ?? '')).filter(Boolean)));
    return {
      data: features.map((feature, index) => ({
        type: 'scatter',
        mode: 'lines+markers',
        name: feature,
        x: table.rows
          .filter((row) => String(row.feature ?? '') === feature)
          .map((row) => toFiniteNumber(row.feature_value) ?? 0),
        y: table.rows
          .filter((row) => String(row.feature ?? '') === feature)
          .map((row) => toFiniteNumber(row.partial_dependence) ?? 0),
        marker: { color: ['#7c3aed', '#2563eb', '#0f766e'][index % 3] },
        hovertemplate: `${feature}<br>Value: %{x}<br>Partial dependence: %{y}<extra></extra>`,
      })),
      layout: {
        title: { text: table.title || 'Exploratory partial dependence' },
        xaxis: { title: 'Feature value' },
        yaxis: { title: 'Partial dependence' },
      },
    };
  }

  return {
    data: [
      {
        type: 'bar',
        x: table.rows.map((row, index) => String(row[table.columns[0]] ?? `Row ${index + 1}`)),
        y: table.rows.map((row) => toFiniteNumber(row[table.columns[1]]) ?? 0),
        marker: { color: '#2563eb' },
      },
    ],
    layout: {
      title: { text: table.title || humanizeFamilyLabel(analysisFamily) },
      xaxis: { title: table.columns[0] },
      yaxis: { title: table.columns[1] || 'Value' },
    },
  };
};

export const buildDeterministicExecutedCode = (
  code: string,
  analysisFamily: string,
  workspaceId?: string | null,
  sourceFiles?: ClinicalFile[]
) =>
  [
    '# Deterministic analysis engine execution',
    `# Analysis family: ${analysisFamily}`,
    ...(workspaceId ? [`# Workspace ID: ${workspaceId}`] : []),
    ...(sourceFiles && sourceFiles.length > 0 ? [`# Source datasets: ${sourceFiles.map((file) => file.name).join(', ')}`] : []),
    '',
    code || '# No local Python preview was supplied.',
  ].join('\n');

const humanizeFamilyLabel = (family: string) => {
  switch (family) {
    case 'feature_importance':
      return 'Exploratory predictor ranking';
    case 'partial_dependence':
      return 'Exploratory predictor profile';
    case 'mixed_model':
      return 'Repeated-measures model';
    case 'threshold_search':
      return 'Early warning threshold search';
    case 'competing_risks':
      return 'Competing-risks summary';
    case 'incidence':
    case 'risk_difference':
      return 'Incidence comparison';
    case 'logistic_regression':
      return 'Predictor analysis';
    case 'kaplan_meier':
      return 'Survival comparison';
    case 'cox':
      return 'Time-to-event model';
    default:
      return 'Analysis results';
  }
};

const buildWhoWasIncludedText = (
  metrics: Record<string, string | number>,
  receipt?: FastApiRunResponse['receipt'] | null
) => {
  const fragments: string[] = [];
  const receiptFilters = receipt?.cohort_filters_applied && receipt.cohort_filters_applied.length > 0
    ? receipt.cohort_filters_applied.join(', ')
    : null;
  const metricFilters = typeof metrics.cohort_filters_applied === 'string' ? metrics.cohort_filters_applied : null;
  if (receiptFilters || metricFilters) {
    const filterSummary = receiptFilters || metricFilters || '';
    if (filterSummary) {
      fragments.push(`Cohort filters applied: ${filterSummary}.`);
    }
  }
  if (metrics.total_subjects) {
    fragments.push(`Included ${metrics.total_subjects} subjects.`);
  } else if (metrics.subjects_used) {
    fragments.push(`Included ${metrics.subjects_used} subjects.`);
  }
  if (metrics.event_subjects) {
    fragments.push(`${metrics.event_subjects} subjects met the endpoint.`);
  } else if (metrics.event_of_interest_subjects) {
    fragments.push(`${metrics.event_of_interest_subjects} subjects experienced the event of interest.`);
  }
  return fragments.join(' ');
};

const buildWhatWasAnalyzedText = (
  executed: FastApiRunResponse,
  receipt?: FastApiRunResponse['receipt'] | null
) => {
  const sections: string[] = [];
  const endpoint = receipt?.endpoint_label || receipt?.target_definition;
  const treatment = receipt?.treatment_variable;
  if (endpoint && treatment) {
    sections.push(`Endpoint: ${endpoint}. Grouping variable: ${treatment}.`);
  } else if (endpoint) {
    sections.push(`Endpoint: ${endpoint}.`);
  }
  if (receipt?.source_names && receipt.source_names.length > 0) {
    sections.push(`Data sources: ${receipt.source_names.join(', ')}.`);
  }
  if (receipt?.derived_columns && receipt.derived_columns.length > 0) {
    sections.push(`Derived fields: ${receipt.derived_columns.join(', ')}.`);
  }
  if (receipt?.row_count) {
    sections.push(`Analysis workspace: ${receipt.row_count} rows${receipt.column_count ? ` x ${receipt.column_count} columns` : ''}.`);
  }
  if (sections.length === 0) {
    sections.push(executed.explanation);
  }
  return sections.join(' ');
};

const buildWhatWasFoundText = (
  executed: FastApiRunResponse,
  metrics: Record<string, string | number>
) => {
  switch (executed.analysis_family) {
    case 'feature_importance':
      return [
        metrics.top_predictor ? `The strongest predictor in this exploratory model was ${metrics.top_predictor}.` : null,
        metrics.candidate_predictors ? `${metrics.candidate_predictors} candidate predictors were usable after preprocessing.` : null,
      ].filter(Boolean).join(' ');
    case 'partial_dependence':
      return metrics.features_profiled
        ? `Partial dependence profiles were generated for ${metrics.features_profiled} leading predictors.`
        : executed.interpretation || executed.explanation;
    case 'mixed_model':
      return metrics.observations_used && metrics.subjects_used
        ? `The repeated-measures model used ${metrics.observations_used} visit-level observations from ${metrics.subjects_used} subjects.`
        : executed.interpretation || executed.explanation;
    case 'threshold_search':
      return metrics.top_predictor
        ? `The top-ranked threshold rule came from ${metrics.top_predictor}.`
        : executed.interpretation || executed.explanation;
    case 'competing_risks':
      return metrics.event_of_interest_subjects
        ? `The cumulative-incidence summary identified ${metrics.event_of_interest_subjects} event-of-interest outcomes and ${metrics.competing_event_subjects || 0} competing events.`
        : executed.interpretation || executed.explanation;
    case 'logistic_regression':
      return metrics.predictor_columns
        ? `The fitted regression retained ${metrics.predictor_columns} informative predictor terms.`
        : executed.interpretation || executed.explanation;
    case 'cox':
      return metrics.concordance_index
        ? `Model discrimination was ${metrics.concordance_index} by concordance index.`
        : executed.interpretation || executed.explanation;
    case 'kaplan_meier':
      return metrics.log_rank_p_value
        ? `The log-rank comparison returned a p-value of ${metrics.log_rank_p_value}.`
        : executed.interpretation || executed.explanation;
    case 'incidence':
    case 'risk_difference':
      return [
        metrics.risk_difference !== undefined ? `Estimated risk difference: ${metrics.risk_difference}.` : null,
        metrics.ci_lower_95 !== undefined && metrics.ci_upper_95 !== undefined
          ? `Approximate 95% CI: ${metrics.ci_lower_95} to ${metrics.ci_upper_95}.`
          : null,
      ].filter(Boolean).join(' ') || executed.interpretation || executed.explanation;
    default:
      return executed.interpretation || executed.explanation;
  }
};

export const formatDeterministicChatResponse = (executed: FastApiRunResponse): AnalysisResponse => {
  const metrics = metricsListToRecord(executed.metrics);
  const receipt = executed.receipt;

  const keyInsights: string[] = [];
  const keyInsightFilters =
    receipt?.cohort_filters_applied && receipt.cohort_filters_applied.length > 0
      ? receipt.cohort_filters_applied.join(', ')
      : typeof metrics.cohort_filters_applied === 'string'
        ? metrics.cohort_filters_applied
        : '';
  if (keyInsightFilters) {
    keyInsights.push(`Applied cohort filters: ${keyInsightFilters}.`);
  }
  if (metrics.total_subjects) keyInsights.push(`Included ${metrics.total_subjects} subjects.`);
  else if (metrics.subjects_used) keyInsights.push(`Included ${metrics.subjects_used} subjects.`);
  if (metrics.event_subjects) keyInsights.push(`${metrics.event_subjects} subjects met the endpoint.`);
  if (metrics.top_predictor) keyInsights.push(`${metrics.top_predictor} was the strongest predictor in this exploratory model.`);
  if (metrics.risk_difference !== undefined) keyInsights.push(`Estimated risk difference: ${metrics.risk_difference}.`);

  const answerParts = [
    `### ${humanizeFamilyLabel(executed.analysis_family)}`,
    '',
    '### What was analyzed',
    buildWhatWasAnalyzedText(executed, receipt),
    '',
    '### Who was included',
    buildWhoWasIncludedText(metrics, receipt) || 'The result did not return a cohort summary.',
    '',
    '### What was found',
    buildWhatWasFoundText(executed, metrics),
  ];

  if (executed.warnings.length > 0) {
    answerParts.push('', '### Limitations', ...executed.warnings.map((warning) => `- ${warning}`));
  }

  return {
    answer: answerParts.join('\n'),
    tableConfig: executed.table
      ? {
          title: executed.table.title,
          columns: executed.table.columns,
          rows: executed.table.rows,
        }
      : undefined,
    keyInsights,
  };
};
