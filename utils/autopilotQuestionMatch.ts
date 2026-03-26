import { AutopilotDataScope, AutopilotExecutionMode, ResultTable, StatAnalysisResult, StatTestType } from '../types';
import { normalizeSupportToken, summarizeQuestionSupport } from './questionSupport';

export interface AutopilotQuestionMatchAssessment {
  status: 'MATCHED' | 'FAILED';
  summary: string;
  details: string[];
}

interface MatchContext {
  analysisScope: AutopilotDataScope;
  analysisMode: AutopilotExecutionMode;
  testType: StatTestType;
  var1: string;
  var2: string;
}

const summarizeTable = (table?: ResultTable): string => {
  if (!table) return '';
  const rowPreview = table.rows
    .slice(0, 5)
    .flatMap((row) => table.columns.map((column) => `${column}:${String(row[column] ?? '')}`))
    .join(' ');
  return [table.title, ...table.columns, rowPreview].join(' ');
};

const includesAny = (value: string, patterns: Array<string | RegExp>) =>
  patterns.some((pattern) => (typeof pattern === 'string' ? value.includes(pattern) : pattern.test(value)));

const hasMetric = (text: string, candidates: string[]) => candidates.some((candidate) => text.includes(candidate));
const normalizeToken = normalizeSupportToken;

const inferLocalFamily = (testType: StatTestType): string => {
  switch (testType) {
    case StatTestType.CHI_SQUARE:
      return 'chi_square';
    case StatTestType.KAPLAN_MEIER:
      return 'kaplan_meier';
    case StatTestType.COX_PH:
      return 'cox';
    case StatTestType.REGRESSION:
      return 'regression';
    case StatTestType.ANOVA:
      return 'anova';
    case StatTestType.T_TEST:
      return 't_test';
    case StatTestType.CORRELATION:
      return 'correlation';
    default:
      return 'unknown';
  }
};

const requiresBackendExecution = (question: string) =>
  includesAny(question, [
    /cumulative incidence/,
    /risk difference/,
    /\b95\s*%\s*ci\b/,
    /\bconfidence interval\b/,
    /week\s*\d+/,
    /grade\s*[>=]*\s*2/,
    /\bdae/i,
    /\badverse event/i,
    /\bpredict/i,
    /feature importance/,
    /partial dependence/,
    /threshold|cutoff|early warning/,
    /time to (?:resolution|onset|event)/,
    /hazard|cox|kaplan|survival/,
  ]);

const mentionsDoseWeight = (question: string) =>
  includesAny(question, [/\bdose\b/, /\bdosing\b/, /\bweight\b/, /\bkg\b/, /\btier\b/, />=\s*80\s*kg/, /≥\s*80\s*kg/]);

const mentionsMitigation = (question: string) =>
  includesAny(question, [/\bmitigat/i, /\bdiffer by arm\b/i, /\binteraction\b/i, /\benhanced dm\b/i]);

const mentionsOnsetOrTimeToEvent = (question: string) =>
  includesAny(question, [/\bearlier onset\b/i, /\bonset\b/i, /\btime to first\b/i, /\btime to event\b/i, /\bsurvival\b/i, /\bhazard\b/i, /\bcox\b/i]);

export const assessAutopilotQuestionMatch = (
  question: string,
  result: StatAnalysisResult,
  context: MatchContext
): AutopilotQuestionMatchAssessment => {
  const normalizedQuestion = question.trim().toLowerCase();
  if (!normalizedQuestion) {
    return {
      status: 'MATCHED',
      summary: 'No free-text question was provided for validation.',
      details: [],
    };
  }

  const actualFamily = result.backendExecution?.analysisFamily || inferLocalFamily(context.testType);
  const evidenceText = [
    normalizedQuestion,
    result.interpretation,
    result.executedCode,
    context.var1,
    context.var2,
    summarizeTable(result.tableConfig),
    ...Object.entries(result.metrics).map(([key, value]) => `${key}:${String(value)}`),
  ]
    .join(' ')
    .toLowerCase();

  const details: string[] = [];
  const isLinkedSingleQuestion = context.analysisMode === 'SINGLE' && context.analysisScope === 'LINKED_WORKSPACE';
  const predictorTexts = (result.tableConfig?.rows || [])
    .map((row) => normalizeToken(String(row.predictor ?? '')))
    .filter(Boolean);
  const supportSummary = summarizeQuestionSupport(
    normalizedQuestion,
    (result.tableConfig?.rows || []).map((row) => String(row.predictor ?? '')).filter(Boolean)
  );
  const hasPredictorMatch = (patterns: RegExp[]) => predictorTexts.some((predictor) => patterns.some((pattern) => pattern.test(predictor)));
  const subjectsUsed = Number(result.metrics.subjects_used ?? result.metrics.total_subjects);
  const eventSubjects = Number(result.metrics.event_subjects ?? result.metrics.event_of_interest_subjects);

  if (isLinkedSingleQuestion && requiresBackendExecution(normalizedQuestion) && !result.backendExecution) {
    details.push(
      'This linked-workspace single-question run required deterministic backend execution, but the saved result came from a generic local statistical path.'
    );
  }

  if (includesAny(normalizedQuestion, [/cumulative incidence/, /incidence/, /risk difference/])) {
    if (!includesAny(actualFamily, ['incidence', 'risk_difference', 'competing_risks'])) {
      details.push(`The executed analysis family was "${actualFamily}", not an incidence or risk-difference workflow.`);
    }
  }

  if (normalizedQuestion.includes('risk difference') && !hasMetric(evidenceText, ['risk_difference', 'risk difference'])) {
    details.push('The result does not contain a risk-difference estimate.');
  }

  if (
    includesAny(normalizedQuestion, [/\b95\s*%\s*ci\b/, /\bconfidence interval\b/, /\bci\b/]) &&
    !hasMetric(evidenceText, ['ci_lower_95', 'ci_upper_95', 'confidence interval', '95% ci'])
  ) {
    details.push('The result does not contain a 95% confidence interval.');
  }

  if (
    includesAny(normalizedQuestion, [/feature importance/, /strongest predictors/, /ranked feature importance/]) &&
    actualFamily !== 'feature_importance'
  ) {
    details.push(`The executed analysis family was "${actualFamily}", not feature importance.`);
  }

  if (normalizedQuestion.includes('partial dependence') && actualFamily !== 'partial_dependence') {
    details.push(`The executed analysis family was "${actualFamily}", not partial dependence.`);
  }

  if (includesAny(normalizedQuestion, [/threshold|cutoff|early warning/]) && actualFamily !== 'threshold_search') {
    details.push(`The executed analysis family was "${actualFamily}", not a threshold-search workflow.`);
  }

  if (
    includesAny(normalizedQuestion, [/time to (?:resolution|onset|event)/, /hazard|cox|kaplan|survival/]) &&
    !includesAny(actualFamily, ['cox', 'kaplan_meier', 'competing_risks'])
  ) {
    details.push(`The executed analysis family was "${actualFamily}", not a survival or competing-risks workflow.`);
  }

  if (mentionsDoseWeight(normalizedQuestion) && !hasPredictorMatch([/dose/, /weight/, /80kg/, /tier/, /ge80kg/, /\bex_/])) {
    details.push('The result does not contain a direct dose- or weight-tier predictor estimate.');
  }

  if (mentionsMitigation(normalizedQuestion) && !hasPredictorMatch([/^int\b/, /^int__/, /interaction/, /dose.*trt/, /trt.*dose/, /dose.*arm/, /arm.*dose/, /treatment.*dose/])) {
    details.push('The result does not contain an interpretable treatment-by-dose interaction estimate.');
  }

  for (const detail of supportSummary.details) {
    details.push(detail);
  }

  if (mentionsOnsetOrTimeToEvent(normalizedQuestion) && Number.isFinite(subjectsUsed) && Number.isFinite(eventSubjects) && subjectsUsed > 0 && eventSubjects >= subjectsUsed) {
    details.push('All included subjects experienced the modeled event, so the run does not look like a clean at-risk onset analysis.');
  }

  if (
    includesAny(normalizedQuestion, [/asian/, /\bwomen\b/, /\bfemale\b/, />=\s*\d+/, /week\s*\d+/, /grade\s*[>=]*\s*2/]) &&
    isLinkedSingleQuestion &&
    !result.backendExecution
  ) {
    details.push(
      'The question includes subgroup or endpoint-derivation constraints, but the saved result does not show backend execution that could validate those filters.'
    );
  }

  if (details.length > 0) {
    return {
      status: 'FAILED',
      summary: 'Autopilot did not answer the requested question with a matching executed analysis.',
      details,
    };
  }

  return {
    status: 'MATCHED',
    summary: 'The executed analysis family and reported outputs match the requested question at a high level.',
    details: [],
  };
};
