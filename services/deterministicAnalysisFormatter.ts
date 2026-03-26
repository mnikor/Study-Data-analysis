import { AnalysisResponse, ClinicalFile, StatAnalysisResult } from "../types";
import { type FastApiRunResponse } from "./fastapiAnalysisService";
import {
  classifyPredictorFamily,
  normalizeSupportToken,
  summarizeQuestionSupport,
} from "../utils/questionSupport";

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

const humanizePredictorLabel = (value: string): string =>
  value
    .replace(/^INT__/, 'Interaction: ')
    .replace(/__X__/g, ' × ')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const wrapAxisLabel = (value: string, maxChars = 26): string => {
  const text = humanizePredictorLabel(value);
  if (text.length <= maxChars) return text;
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (!current) {
      current = word;
      continue;
    }
    if (`${current} ${word}`.length <= maxChars) {
      current = `${current} ${word}`;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.join('<br>');
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
    const yLabels = table.rows.map((row) => wrapAxisLabel(String(row.predictor ?? '')));
    const longestWrappedLine = yLabels.reduce((max, label) => {
      const lineMax = label
        .split('<br>')
        .reduce((innerMax, line) => Math.max(innerMax, line.replace(/<[^>]+>/g, '').length), 0);
      return Math.max(max, lineMax);
    }, 0);
    const dynamicLeftMargin = Math.min(460, Math.max(220, longestWrappedLine * 8 + 60));
    const dynamicHeight = Math.max(420, table.rows.length * 48 + 120);
    const x = table.rows.map((row) => toFiniteNumber(row[isRepeated ? 'coefficient' : estimateKey]) ?? (isRepeated ? 0 : 1));
    const lower = table.rows.map((row) => toFiniteNumber(row.ci_lower_95) ?? (isRepeated ? 0 : 1));
    const upper = table.rows.map((row) => toFiniteNumber(row.ci_upper_95) ?? (isRepeated ? 0 : 1));
    return {
      data: [
        {
          type: 'scatter',
          mode: 'markers',
          x,
          y: yLabels,
          marker: { color, size: 12 },
          error_x: {
            type: 'data',
            visible: true,
            array: upper.map((value, index) => value - x[index]),
            arrayminus: lower.map((value, index) => x[index] - value),
          },
          customdata: table.rows.map((row) => [String(row.predictor ?? '')]),
          hovertemplate: `%{customdata[0]}<br>${(isRepeated ? 'coefficient' : estimateKey).replace('_', ' ')}: %{x}<extra></extra>`,
        },
      ],
      layout: {
        title: { text: table.title || humanizeFamilyLabel(analysisFamily) },
        height: dynamicHeight,
        xaxis: { title: (isRepeated ? 'coefficient' : estimateKey).replace('_', ' ') },
        yaxis: { automargin: true, tickfont: { size: 12 } },
        margin: { l: dynamicLeftMargin, r: 32, t: 64, b: 72 },
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

const normalizeToken = normalizeSupportToken;

const questionMentionsSubgroup = (question?: string) =>
  Boolean(question && /\basian\b|\bwomen\b|\bfemale\b|>=\s*\d+|≥\s*\d+/i.test(question));

const questionMentionsDoseWeight = (question?: string) =>
  Boolean(question && /\bdose\b|\bdosing\b|\bweight\b|\bkg\b|\btier\b|>=\s*80\s*kg|≥\s*80\s*kg/i.test(question));

const questionMentionsMitigation = (question?: string) =>
  Boolean(question && /\bmitigat|\bdiffer by arm\b|\binteraction\b|\benhanced dm\b/i.test(question));

const questionMentionsEarlyOnset = (question?: string) =>
  Boolean(question && /\bearlier onset\b|\bonset\b|\btime to\b/i.test(question));

const questionMentionsResolution = (question?: string) =>
  Boolean(question && /\bresolution\b|\brecovery\b/i.test(question));

const questionMentionsPredictors = (question?: string) =>
  Boolean(question && /\bpredict|\bpredictor|\bfactors\b|\bdrivers\b|\bkey drivers\b|\bassociated with\b|\bcorrelate\b/i.test(question));

const textMentionsOnset = (value?: string | null) =>
  Boolean(value && /\bonset\b|\btime to first\b|\btime-to-first\b|\btime to event\b/i.test(value));

const textMentionsResolution = (value?: string | null) =>
  Boolean(value && /\bresolution\b|\brecovery\b/i.test(value));

type QuestionFitAssessment = {
  status: 'full' | 'partial';
  messages: string[];
  shortInsights: string[];
  hasQuestionSpecificEstimate: boolean;
};

const metricValue = (metrics: Record<string, string | number>, key: string) => metrics[key];

const isFiniteMetric = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

const formatEstimateSnippet = (row: Record<string, string | number>, estimateKey: 'hazard_ratio' | 'odds_ratio') => {
  const estimate = toFiniteNumber(row[estimateKey]);
  const lower = toFiniteNumber(row.ci_lower_95);
  const upper = toFiniteNumber(row.ci_upper_95);
  const p = toFiniteNumber(row.p_value);
  const fragments: string[] = [];
  if (estimate !== null) fragments.push(`${estimateKey === 'hazard_ratio' ? 'HR' : 'OR'} ${estimate.toFixed(2)}`);
  if (lower !== null && upper !== null) fragments.push(`95% CI ${lower.toFixed(2)} to ${upper.toFixed(2)}`);
  if (p !== null) fragments.push(`p=${p.toFixed(3)}`);
  return fragments.join(', ');
};

const findPredictorRows = (
  rows: Array<Record<string, string | number>> | undefined,
  patterns: RegExp[]
) => (rows || []).filter((row) => {
  const predictor = normalizeToken(String(row.predictor ?? ''));
  return patterns.some((pattern) => pattern.test(predictor));
});

const buildQuestionFitSummary = (
  question: string | undefined,
  executed: FastApiRunResponse,
  metrics: Record<string, string | number>,
  receipt?: FastApiRunResponse['receipt'] | null
) : QuestionFitAssessment => {
  if (!question || (executed.analysis_family !== 'cox' && executed.analysis_family !== 'logistic_regression')) {
    return { status: 'full', messages: [], shortInsights: [], hasQuestionSpecificEstimate: true };
  }

  const rows = executed.table?.rows || [];
  const treatmentVar = normalizeToken(receipt?.treatment_variable || '');
  const cohortFilters = receipt?.cohort_filters_applied || [];
  const doseRows = findPredictorRows(rows, [/dose/, /weight/, /80kg/, /tier/, /ge80kg/, /\bex_/]);
  const interactionRows = findPredictorRows(rows, [/^int /, /^int__/, /interaction/, /dose.*trt|trt.*dose/, /treatment.*dose/]);
  const supportSummary = summarizeQuestionSupport(
    question,
    rows.map((row) => String(row.predictor ?? '')).filter(Boolean)
  );
  const treatmentRows = rows.filter((row) => {
    const predictor = normalizeToken(String(row.predictor ?? ''));
    return treatmentVar ? predictor.includes(treatmentVar) && !predictor.includes('int') : /^trt|^arm/.test(predictor);
  });
  const eventSubjects = toFiniteNumber(metricValue(metrics, 'event_subjects'));
  const totalSubjects = toFiniteNumber(metricValue(metrics, 'subjects_used')) ?? toFiniteNumber(metricValue(metrics, 'total_subjects'));

  const lines: string[] = [];
  const shortInsights: string[] = [];
  let hasQuestionSpecificEstimate = true;

  if (questionMentionsSubgroup(question)) {
    if (cohortFilters.length > 0) {
      const message = `The run explicitly applied the requested subgroup filters: ${cohortFilters.join(', ')}.`;
      lines.push(message);
      shortInsights.push(`Subgroup applied: ${cohortFilters.join(', ')}.`);
    } else {
      lines.push('This run does not show the requested subgroup filters in the executed result, so it may not match the intended population exactly.');
      shortInsights.push('Requested subgroup was not confirmed in the executed result.');
      hasQuestionSpecificEstimate = false;
    }
  }

  if (questionMentionsDoseWeight(question)) {
    if (doseRows.length > 0) {
      const bestDose = doseRows[0];
      const estimate = `The clearest dose or weight-tier effect estimate in this run was for ${String(bestDose.predictor)} (${formatEstimateSnippet(bestDose, executed.analysis_family === 'cox' ? 'hazard_ratio' : 'odds_ratio')}).`;
      lines.push(estimate);
      shortInsights.push(estimate);
    } else {
      lines.push('This run did not isolate a direct dose-tier or weight-based effect estimate, so it does not fully answer whether higher dosing was associated with more events or earlier onset.');
      shortInsights.push('No direct dose-tier estimate was produced.');
      hasQuestionSpecificEstimate = false;
    }
  }

  if (questionMentionsMitigation(question)) {
    if (interactionRows.length > 0) {
      const bestInteraction = interactionRows[0];
      const estimate = `The run did include an interaction-style term, with ${String(bestInteraction.predictor)} reported as ${formatEstimateSnippet(bestInteraction, executed.analysis_family === 'cox' ? 'hazard_ratio' : 'odds_ratio')}.`;
      lines.push(estimate);
      shortInsights.push(estimate);
    } else {
      lines.push('The run did not produce a treatment-by-dose interaction estimate, so it does not directly answer whether Enhanced DM mitigated the dose relationship.');
      shortInsights.push('No treatment-by-dose interaction estimate was produced.');
      hasQuestionSpecificEstimate = false;
    }
  } else if (treatmentRows.length > 0) {
    const bestTreatment = treatmentRows[0];
    const estimate = `The treatment-arm effect shown in this run was ${String(bestTreatment.predictor)} (${formatEstimateSnippet(bestTreatment, executed.analysis_family === 'cox' ? 'hazard_ratio' : 'odds_ratio')}).`;
    lines.push(estimate);
    shortInsights.push(estimate);
  }

  for (const detail of supportSummary.details) {
    lines.push(detail);
    shortInsights.push(detail);
    hasQuestionSpecificEstimate = false;
  }

  if ((questionMentionsEarlyOnset(question) || questionMentionsResolution(question)) && isFiniteMetric(eventSubjects) && isFiniteMetric(totalSubjects) && totalSubjects > 0 && eventSubjects >= totalSubjects) {
    lines.push('All included subjects met the endpoint in this run, which is unusual for an onset question and should be reviewed before treating the model as a clean answer to the question.');
    shortInsights.push('All included subjects met the endpoint, which is unusual for an onset question.');
    hasQuestionSpecificEstimate = false;
  }

  return {
    status: hasQuestionSpecificEstimate ? 'full' : 'partial',
    messages: lines,
    shortInsights,
    hasQuestionSpecificEstimate,
  };
};

const buildQuestionFocusedTable = (
  executed: FastApiRunResponse,
  question?: string
) => {
  if (!executed.table || !question) return executed.table;
  if (executed.analysis_family !== 'cox' && executed.analysis_family !== 'logistic_regression') return executed.table;

  const rows = executed.table.rows || [];
  const relevant = rows.filter((row) => {
    const predictor = normalizeToken(String(row.predictor ?? ''));
    if (!predictor) return false;
    if (questionMentionsDoseWeight(question) && /(dose|weight|80kg|tier|ge80kg|\bex\b)/.test(predictor)) return true;
    if (questionMentionsMitigation(question) && /(int|interaction|trt|arm|treatment)/.test(predictor)) return true;
    if (questionMentionsSubgroup(question) && /(age|sex|race)/.test(predictor)) return true;
    return false;
  });

  if (relevant.length === 0) return null;
  if (relevant.length === rows.length) return executed.table;

  return {
    ...executed.table,
    title: `Primary estimates for the asked question`,
    rows: relevant.slice(0, 8),
  };
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
  if (metrics.non_event_subjects) {
    fragments.push(`${metrics.non_event_subjects} included subjects were censored or did not experience the modeled event.`);
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
  metrics: Record<string, string | number>,
  question?: string
) => {
  const questionFitSummary = buildQuestionFitSummary(question, executed, metrics, executed.receipt);
  if (questionFitSummary.messages.length > 0) {
    return questionFitSummary.messages.join(' ');
  }

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

type NarrativeSections = NonNullable<NonNullable<StatAnalysisResult['aiCommentary']>['sections']>;

const estimateLabel = (family: string) => (family === 'cox' ? 'HR' : family === 'logistic_regression' ? 'OR' : 'estimate');

const buildEstimateText = (row: Record<string, string | number>, family: string) => {
  const key = family === 'cox' ? 'hazard_ratio' : family === 'logistic_regression' ? 'odds_ratio' : 'coefficient';
  const value = toFiniteNumber(row[key]);
  const p = toFiniteNumber(row.p_value);
  const lower = toFiniteNumber(row.ci_lower_95);
  const upper = toFiniteNumber(row.ci_upper_95);
  const parts: string[] = [];
  if (value !== null) parts.push(`${estimateLabel(family)} ${value.toFixed(2)}`);
  if (lower !== null && upper !== null) parts.push(`95% CI ${lower.toFixed(2)} to ${upper.toFixed(2)}`);
  if (p !== null) parts.push(`p=${p.toFixed(3)}`);
  return parts.join(', ');
};

const isInteractionPredictor = (predictor: string) => /^int\b|^int__|interaction/i.test(normalizeToken(predictor));
const isEventDerivedPredictor = (predictor: string) => classifyPredictorFamily(String(predictor || '')) === 'event_derived';

export const buildStructuredNarrative = (
  analysisFamily: string,
  metrics: Record<string, string | number>,
  table: FastApiRunResponse['table'] | StatAnalysisResult['tableConfig'] | undefined,
  receipt: FastApiRunResponse['receipt'] | StatAnalysisResult['backendExecution']['receipt'] | null | undefined,
  interpretation: string,
  warnings: string[],
  question?: string
): {
  summary: string;
  limitations: string[];
  caution?: string;
  sections: NarrativeSections;
} => {
  const rows = table?.rows || [];
  const totalSubjects =
    toFiniteNumber(metrics.subjects_used) ??
    toFiniteNumber(metrics.total_subjects) ??
    toFiniteNumber(metrics.event_of_interest_subjects);
  const eventSubjects = toFiniteNumber(metrics.event_subjects) ?? toFiniteNumber(metrics.event_of_interest_subjects);
  const nonEventSubjects = toFiniteNumber(metrics.non_event_subjects);
  const endpointLabel = receipt?.endpoint_label || receipt?.endpointLabel || receipt?.target_definition || receipt?.targetDefinition;
  const timeVariable = receipt?.time_variable || receipt?.timeVariable;
  const eventVariable = receipt?.event_variable || receipt?.eventVariable;
  const treatmentVariable = receipt?.treatment_variable || receipt?.treatmentVariable;
  const cohortFilters = receipt?.cohort_filters_applied || receipt?.cohortFiltersApplied || [];

  const interactionRows = rows.filter((row) => isInteractionPredictor(String(row.predictor ?? '')));
  const treatmentRows = rows.filter((row) => {
    const predictor = normalizeToken(String(row.predictor ?? ''));
    if (isInteractionPredictor(predictor)) return false;
    const treatmentToken = normalizeToken(String(treatmentVariable || ''));
    return treatmentToken ? predictor.includes(treatmentToken) : /\btrt\b|\barm\b|treatment/.test(predictor);
  });
  const doseRows = findPredictorRows(rows, [/dose/, /weight/, /80kg/, /tier/, /ge80kg/, /\bex_/]);
  const supportSummary = summarizeQuestionSupport(
    question,
    rows.map((row) => String(row.predictor ?? '')).filter(Boolean)
  );
  const nonInteractionNonTreatmentRows = rows.filter((row) => {
    const predictor = String(row.predictor ?? '');
    return predictor && !isInteractionPredictor(predictor) && !treatmentRows.includes(row);
  });
  const eventDerivedRows = nonInteractionNonTreatmentRows.filter((row) => isEventDerivedPredictor(String(row.predictor ?? '')));
  const baselineRows = nonInteractionNonTreatmentRows.filter((row) => !isEventDerivedPredictor(String(row.predictor ?? '')));
  const predictorQuestion = /\bfactor\b|\bfactors\b|\bpredictor\b|\bpredictors\b|\bkey drivers\b|\bdriver\b|\bwhat predicts\b/i.test(
    question || ''
  );
  const eventDerivedDominates = predictorQuestion && eventDerivedRows.length > 0 && baselineRows.length <= eventDerivedRows.length;

  const isResolutionQuestion = questionMentionsResolution(question) || textMentionsResolution(endpointLabel);
  const isOnsetQuestion =
    !isResolutionQuestion &&
    (questionMentionsEarlyOnset(question) || textMentionsOnset(endpointLabel));

  const sortedMainRows = [...baselineRows].sort((a, b) => {
    const pa = toFiniteNumber(a.p_value);
    const pb = toFiniteNumber(b.p_value);
    if (pa === null && pb === null) return 0;
    if (pa === null) return 1;
    if (pb === null) return -1;
    return pa - pb;
  });
  const sortedInteractionRows = [...interactionRows].sort((a, b) => {
    const pa = toFiniteNumber(a.p_value);
    const pb = toFiniteNumber(b.p_value);
    if (pa === null && pb === null) return 0;
    if (pa === null) return 1;
    if (pb === null) return -1;
    return pa - pb;
  });

  const strongestMain = sortedMainRows[0];
  const strongestInteraction = sortedInteractionRows[0];
  const strongestInteractionP = strongestInteraction ? toFiniteNumber(strongestInteraction.p_value) : null;
  const hasInteractionSignal = strongestInteractionP !== null && strongestInteractionP < 0.05;
  const cIndex = toFiniteNumber(metrics.concordance_index);
  const onsetAllEventCohort =
    isOnsetQuestion &&
    eventSubjects !== null &&
    totalSubjects !== null &&
    totalSubjects > 0 &&
    eventSubjects >= totalSubjects;
  const missingDoseEstimate = questionMentionsDoseWeight(question) && doseRows.length === 0;
  const missingInteractionEstimate = questionMentionsMitigation(question) && interactionRows.length === 0;
  const missingRequiredPredictorFamilies = supportSummary.details;

  const populationBits: string[] = [];
  if (totalSubjects !== null) populationBits.push(`${totalSubjects} participants were included in the fitted model`);
  if (eventSubjects !== null) {
    if (eventSubjects === totalSubjects && totalSubjects !== null) {
      populationBits.push(
        isResolutionQuestion
          ? 'all included participants had an observed resolution event'
          : isOnsetQuestion
            ? 'all included participants experienced the modeled event'
            : 'all included participants met the modeled event definition'
      );
    } else {
      populationBits.push(`${eventSubjects} participants experienced the modeled event`);
    }
  }
  if (nonEventSubjects !== null && nonEventSubjects > 0) {
    populationBits.push(
      isResolutionQuestion
        ? `${nonEventSubjects} participants were included as unresolved or censored observations`
        : `${nonEventSubjects} participants were included as censored or non-event observations`
    );
  }
  if (cohortFilters.length > 0) populationBits.push(`cohort filters: ${cohortFilters.join(', ')}`);

  const endpointBits: string[] = [];
  if (endpointLabel) endpointBits.push(`Endpoint: ${endpointLabel}`);
  if (timeVariable) endpointBits.push(`time variable: ${timeVariable}`);
  if (eventVariable) endpointBits.push(`event variable: ${eventVariable}`);
  if (treatmentVariable) endpointBits.push(`grouping variable: ${treatmentVariable}`);

  let directAnswer = '';
  let mainFindings = interpretation;
  let interactionFindings = '';
  let modelStrength = '';
  const nextSteps: string[] = [];

  if (analysisFamily === 'cox') {
    const directAnswerIssues: string[] = [];
    if (missingDoseEstimate) {
      directAnswerIssues.push(
        'This run did not include a direct weight-tier or dose predictor estimate, so it does not directly answer whether higher dosing was associated with earlier Grade >=2 dermatologic adverse events.'
      );
    }
    if (missingInteractionEstimate) {
      directAnswerIssues.push(
        'It also did not produce an interpretable treatment-by-dose interaction estimate, so it does not directly answer whether COCOON DM mitigated that relationship.'
      );
    }
    if (onsetAllEventCohort) {
      directAnswerIssues.push(
        'All included participants experienced the modeled event, so this fitted cohort behaves like an event-case timing analysis rather than a clean time-to-first-event risk model across the full at-risk population.'
      );
    }
    directAnswerIssues.push(...missingRequiredPredictorFamilies);

    if (directAnswerIssues.length > 0) {
      directAnswer = directAnswerIssues.join(' ');
    } else if (eventDerivedDominates) {
      directAnswer =
        'This run only partially answers the question because the fitted model is still driven mainly by adverse-event descriptors rather than broader baseline, exposure, management, or lab factors.';
    } else if (isResolutionQuestion) {
      directAnswer = 'The app fit a time-to-resolution Cox model for participants with qualifying Grade >=2 dermatologic adverse events.';
    } else if (isOnsetQuestion) {
      directAnswer = 'The app fit a time-to-first-event Cox model for qualifying Grade >=2 dermatologic adverse events.';
    } else {
      directAnswer = 'The app fit a Cox proportional hazards model for the requested time-to-event question.';
    }

    if (questionMentionsMitigation(question)) {
      if (strongestInteraction) {
        interactionFindings = hasInteractionSignal
          ? `The strongest arm interaction was ${String(strongestInteraction.predictor)} (${buildEstimateText(strongestInteraction, analysisFamily)}), which suggests predictor effects may differ by arm.`
          : `The model included treatment-by-predictor interaction terms, but none provided strong evidence that predictor effects differed by arm. The strongest interaction shown was ${String(strongestInteraction.predictor)} (${buildEstimateText(strongestInteraction, analysisFamily)}).`;
      } else {
        interactionFindings = 'No interpretable treatment-by-predictor interaction estimates were produced, so the run did not establish that effects differed by arm.';
      }
    }

    if (missingDoseEstimate) {
      nextSteps.push('Select or add an exposure or dosing dataset that contains a direct dose, planned dose, delivered dose, weight, or weight-tier variable, then rerun the model.');
    }
    if (missingInteractionEstimate && questionMentionsMitigation(question)) {
      nextSteps.push('Rerun with a treatment-by-predictor interaction term so the app can directly test whether arm modifies the requested relationship.');
    }
    if (eventDerivedDominates || !supportSummary.hasMeaningfulPredictorFamily) {
      nextSteps.push('Add baseline clinical, lab, exposure, or management datasets so the fitted model can prioritize non-event predictors instead of AE-derived descriptors.');
    }
    if (!supportSummary.hasBroadPredictorPool && questionMentionsPredictors(question)) {
      nextSteps.push('Expand the predictor pool with additional families such as labs, exposure/dose, management, or comorbidity variables so the app can provide a fuller key-driver analysis rather than a narrow demographics-only model.');
    }
    if (isResolutionQuestion && nonEventSubjects !== null && nonEventSubjects === 0) {
      nextSteps.push('If unresolved cases should exist, include longer follow-up or disposition/exposure timing so unresolved events can remain as censored observations in the recovery model.');
    }
    if (isOnsetQuestion && onsetAllEventCohort) {
      nextSteps.push('Use a full at-risk cohort that includes non-event participants so the onset model can estimate time-to-first-event with proper censoring.');
    }
    if (questionMentionsPredictors(question) && sortedMainRows.length === 0) {
      nextSteps.push('Try a smaller core predictor set first, then add secondary predictors only after a stable baseline model is fit.');
    }

    const primaryNarrativeRows = sortedMainRows.length > 0 ? sortedMainRows : eventDerivedRows;
    if (primaryNarrativeRows.length > 0) {
      const topRows = primaryNarrativeRows.slice(0, 3).map((row) => `${String(row.predictor)} (${buildEstimateText(row, analysisFamily)})`);
      const sigCount = sortedMainRows.filter((row) => {
        const p = toFiniteNumber(row.p_value);
        return p !== null && p < 0.05;
      }).length;
      if (!supportSummary.hasMeaningfulPredictorFamily || eventDerivedDominates) {
        mainFindings = `The fitted model is dominated by treatment and event-derived variables such as ${topRows.join('; ')}, so it does not yet provide clinically meaningful non-event driver estimates for the question asked.`;
      } else if (!supportSummary.hasBroadPredictorPool && questionMentionsPredictors(question)) {
        mainFindings = `The fitted model currently relies on a narrow predictor pool, with the closest baseline-style signals being ${topRows.join('; ')}. That is enough for a basic exploratory model, but not broad enough to identify robust clinical key drivers.`;
      } else if (missingDoseEstimate) {
        mainFindings = `The fitted model did not retain a direct weight-tier or dose predictor. The strongest displayed terms were ${topRows.join('; ')}, so the run does not directly quantify the requested >=80 kg dosing effect.`;
      } else if (sortedMainRows.length > 0) {
        mainFindings =
          sigCount > 0
            ? `The strongest reported baseline-style predictors were ${topRows.join('; ')}.`
            : `No strong baseline-style predictors clearly stood out. The closest baseline signals were ${topRows.join('; ')}.`;
      } else {
        mainFindings = `No strong baseline-style predictors were retained. The strongest model signals came from event-derived variables such as ${topRows.join('; ')}, which should be interpreted as descriptive correlates rather than baseline drivers.`;
      }
    }

    if (cIndex !== null) {
      modelStrength =
        cIndex < 0.6
          ? `Model discrimination was weak (concordance index ${cIndex.toFixed(3)}), so the results should be treated as exploratory.`
          : cIndex < 0.7
            ? `Model discrimination was modest (concordance index ${cIndex.toFixed(3)}).`
            : `Model discrimination was relatively strong (concordance index ${cIndex.toFixed(3)}).`;
    }
  }

  if (!modelStrength) {
    modelStrength =
      analysisFamily === 'cox'
        ? 'Model strength could not be summarized cleanly from the returned metrics.'
        : interpretation;
  }

  const status =
    missingDoseEstimate || missingInteractionEstimate || onsetAllEventCohort || missingRequiredPredictorFamilies.length > 0 || eventDerivedDominates
      ? 'Partial answer only'
      : analysisFamily === 'cox' && questionMentionsMitigation(question)
        ? hasInteractionSignal
          ? 'Good match to question'
          : 'Exploratory answer with no strong arm-specific interaction signal'
        : 'Good match to question';

  const summary = [directAnswer, mainFindings, interactionFindings || null, modelStrength]
    .filter(Boolean)
    .join(' ');

  const limitations = [...warnings];
  if (analysisFamily === 'cox' && eventSubjects !== null && totalSubjects !== null && eventSubjects === totalSubjects) {
    limitations.unshift(
      isResolutionQuestion
        ? 'All included subjects had an observed resolution event, so there was no censoring in the fitted cohort.'
        : isOnsetQuestion
          ? 'All included subjects experienced the modeled event, so the fitted cohort does not represent a full at-risk population.'
          : 'All included subjects met the modeled event definition, which limits how broadly the survival result can be interpreted.'
    );
  }
  if (analysisFamily === 'cox' && missingDoseEstimate) {
    limitations.unshift('The fitted model did not include a direct weight-tier or exposure predictor, so it cannot answer whether >=80 kg dosing was associated with earlier onset or higher event risk.');
  }
  if (analysisFamily === 'cox' && missingInteractionEstimate) {
    limitations.unshift('No interpretable treatment-by-dose interaction estimate was produced, so this run does not answer whether COCOON DM mitigated the dose relationship.');
  }
  for (const detail of [...missingRequiredPredictorFamilies].reverse()) {
    limitations.unshift(detail);
  }
  if (analysisFamily === 'cox' && eventDerivedRows.length > 0) {
    limitations.unshift('Some predictors are event-derived rather than purely baseline variables, so they should be interpreted as exploratory event correlates rather than baseline drivers.');
  }
  if (analysisFamily === 'cox' && eventDerivedDominates) {
    limitations.unshift('The fitted model is still dominated by event-derived predictors, so it does not provide a strong baseline-style driver analysis for this question.');
  }
  if (analysisFamily === 'cox' && cIndex !== null && cIndex < 0.6) {
    limitations.unshift('Predictive discrimination was weak, so coefficient-level findings should not be overinterpreted.');
  }
  if (nextSteps.length === 0 && status === 'Partial answer only') {
    nextSteps.push('Review the selected datasets and rerun with files that directly support the requested endpoint, censoring logic, and predictor families.');
  }

  return {
    summary,
    limitations,
    caution: 'This is an exploratory model result and should be used to guide follow-up analysis, not as confirmatory evidence.',
    sections: {
      status,
      directAnswer,
      population: populationBits.length > 0 ? `${populationBits.join('; ')}.` : undefined,
      endpointDefinition: endpointBits.length > 0 ? `${endpointBits.join('; ')}.` : undefined,
      mainFindings,
      interactionFindings: interactionFindings || undefined,
      modelStrength,
      nextSteps: nextSteps.length > 0 ? nextSteps : undefined,
    },
  };
};

export const formatDeterministicChatResponse = (executed: FastApiRunResponse, question?: string): AnalysisResponse => {
  const metrics = metricsListToRecord(executed.metrics);
  const receipt = executed.receipt;
  const focusedTable = buildQuestionFocusedTable(executed, question);
  const questionFitSummary = buildQuestionFitSummary(question, executed, metrics, receipt);
  const narrative = buildStructuredNarrative(
    executed.analysis_family,
    metrics,
    executed.table,
    receipt,
    executed.interpretation || executed.explanation,
    executed.warnings,
    question
  );

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
  if (narrative.sections.directAnswer) {
    keyInsights.push(narrative.sections.directAnswer);
  }
  if (narrative.sections.population) {
    keyInsights.push(narrative.sections.population);
  }
  if (narrative.sections.interactionFindings) {
    keyInsights.push(narrative.sections.interactionFindings);
  }
  if (narrative.sections.modelStrength) {
    keyInsights.push(narrative.sections.modelStrength);
  }
  if (narrative.sections.nextSteps && narrative.sections.nextSteps.length > 0) {
    keyInsights.push(`What to do next: ${narrative.sections.nextSteps[0]}`);
  }
  if (keyInsights.length === 0) {
    if (metrics.total_subjects) keyInsights.push(`Included ${metrics.total_subjects} subjects.`);
    else if (metrics.subjects_used) keyInsights.push(`Included ${metrics.subjects_used} subjects.`);
    if (metrics.event_subjects) keyInsights.push(`${metrics.event_subjects} subjects met the endpoint.`);
    if (metrics.top_predictor) keyInsights.push(`${metrics.top_predictor} was the strongest predictor in this exploratory model.`);
    if (metrics.risk_difference !== undefined) keyInsights.push(`Estimated risk difference: ${metrics.risk_difference}.`);
    if (questionFitSummary.shortInsights.length > 0) {
      keyInsights.unshift(...questionFitSummary.shortInsights);
    }
  }

  const answerParts = [
    `### ${questionFitSummary.status === 'partial' ? 'Partial answer only' : humanizeFamilyLabel(executed.analysis_family)}`,
    '',
    '### Status',
    narrative.sections.status || 'Good match to question.',
    '',
    '### What was analyzed',
    buildWhatWasAnalyzedText(executed, receipt),
    '',
    '### Who was included',
    narrative.sections.population || buildWhoWasIncludedText(metrics, receipt) || 'The result did not return a cohort summary.',
    '',
    '### Endpoint definition',
    narrative.sections.endpointDefinition || 'The result did not return an explicit endpoint receipt.',
    '',
    '### Direct answer',
    narrative.sections.directAnswer || buildWhatWasFoundText(executed, metrics, question),
    '',
    '### Main findings',
    narrative.sections.mainFindings || buildWhatWasFoundText(executed, metrics, question),
  ];

  if (questionFitSummary.status === 'partial') {
    answerParts.splice(
      2,
      0,
      '### Status',
      'This run only partially answers the question. It provides some related model output, but it does not fully resolve the requested subgroup, dose-tier, or mitigation question.',
      ''
    );
  }

  if (narrative.sections.interactionFindings) {
    answerParts.push('', '### Arm interaction findings', narrative.sections.interactionFindings);
  }

  if (narrative.sections.modelStrength) {
    answerParts.push('', '### Model strength', narrative.sections.modelStrength);
  }

  if (narrative.sections.nextSteps && narrative.sections.nextSteps.length > 0) {
    answerParts.push('', '### What to do next', ...narrative.sections.nextSteps.map((step) => `- ${step}`));
  }

  if (narrative.limitations.length > 0) {
    answerParts.push('', '### Limitations', ...narrative.limitations.map((warning) => `- ${warning}`));
  }

  if (!focusedTable && questionFitSummary.status === 'partial') {
    answerParts.push(
      '',
      '### Question-specific estimates',
      'No focused result table is shown because the run did not produce a clear dose-tier or mitigation estimate for the asked question.'
    );
  }

  return {
    answer: answerParts.join('\n'),
    chartConfig: buildDeterministicChartConfig(
      executed.analysis_family,
      focusedTable || executed.table
    ),
    tableConfig: focusedTable
      ? {
          title: focusedTable.title,
          columns: focusedTable.columns,
          rows: focusedTable.rows,
        }
      : undefined,
    keyInsights,
  };
};
