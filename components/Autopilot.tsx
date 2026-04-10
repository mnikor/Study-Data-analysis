import React, { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bot,
  Download,
  ExternalLink,
  Table2,
  X,
} from 'lucide-react';
import {
  AnalysisPlanEntry,
  AnalysisSession,
  AutopilotDataScope,
  AutopilotExecutionMode,
  AutopilotMappingDecision,
  AutopilotReviewBundle,
  ClinicalFile,
  DataType,
  MappingSpec,
  ProvenanceRecord,
  ProvenanceType,
  QCIssue,
  ResultTable,
  StatAnalysisResult,
  StatTestType,
  StudyType,
  UsageMode,
  User,
} from '../types';
import {
  applyCleaning,
  buildDatasetReference,
  executeStatisticalCode,
  extractPreSpecifiedAnalysisPlan,
  generateClinicalCommentary,
  generateCleaningSuggestion,
  generateETLScript,
  generateMappingSuggestion,
  generateSASCode,
  generateStatisticalCode,
  runQualityCheck,
  runTransformation,
} from '../services/geminiService';
import { generateQuestionPlanningAssist, type QuestionPlanningAssist } from '../services/planningAssistService';
import {
  requestAnalysisPlan,
  type FastApiAnalysisSpec,
  type FastApiCapabilityResponse,
  type FastApiDatasetReference,
} from '../services/fastapiAnalysisService';
import { parseCsv } from '../utils/dataProcessing';
import { parseReferenceMapping } from '../utils/mappingReference';
import { planAnalysisFromQuestion } from '../utils/queryPlanner';
import { AutopilotAnalysisTask, buildAutopilotAnalysisSuite } from '../utils/autopilotPlanner';
import {
  applyBenjaminiHochbergAdjustments,
  buildExploratorySignalTasks,
  buildLinkedAnalysisWorkspace,
  LinkedWorkspaceBuildResult,
} from '../utils/linkedAnalysisWorkspace';
import { formatComparisonLabel } from '../utils/displayNames';
import { assessAutopilotQuestionMatch } from '../utils/autopilotQuestionMatch';
import { buildQuestionFileRecommendation, inferDatasetProfile, mapProfileKindToAnalysisRole } from '../utils/datasetProfile';
import { Chart } from './Chart';
import { AutopilotControlPanel } from './AutopilotControlPanel';
import { AutopilotPlanningHero } from './AutopilotPlanningHero';
import { AutopilotRunBrowser } from './AutopilotRunBrowser';
import { UiErrorBoundary } from './UiErrorBoundary';
import { AutopilotWorkspaceSection } from './AutopilotWorkspaceSection';
import { AutopilotWorkflowPanel } from './AutopilotWorkflowPanel';

type StepKey = 'qc' | 'cleaning' | 'mapping' | 'transform' | 'plan' | 'analysis';
type StepStatus = 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED' | 'SKIPPED';
type ResultDetailView = 'CHART' | 'TABLE';
type ExperienceMode = 'EXPLORE_FAST' | 'RUN_CONFIRMED';
const CURRENT_RUN_SENTINEL = '__CURRENT_RUN__';

interface StepState {
  status: StepStatus;
  detail: string;
}

interface AutopilotRunGroup {
  runId: string;
  runName: string;
  sessions: AnalysisSession[];
  datasetName: string;
  latestTimestamp: string;
  firstTimestamp: string;
  analysisCount: number;
  modeLabel: string;
  scopeLabel: string;
  workflowMode: UsageMode;
  questionPreview: string;
}

interface HypothesisDraft {
  id: string;
  question: string;
  enabled: boolean;
  suggestedTestType: StatTestType;
  suggestedVar1: string;
  suggestedVar2: string;
  rationale?: string;
}

type BackendAnalysisFamily = FastApiCapabilityResponse['analysis_family'];

interface PlannedAutopilotTask extends AutopilotAnalysisTask {
  backendSpec?: FastApiAnalysisSpec | null;
  backendPlannedFamily?: BackendAnalysisFamily | null;
  backendPlanExplanation?: string;
}

interface BackendPlanningPreflightState {
  status: 'idle' | 'loading' | 'ready' | 'missing_data' | 'unsupported' | 'error';
  summary: string;
  explanation: string;
  missingRoles: string[];
  sourceNames: string[];
  basis: 'current' | 'recommended' | null;
}

interface AutopilotProps {
  files: ClinicalFile[];
  onAddFile: (file: ClinicalFile) => void;
  onSaveSpec: (spec: MappingSpec) => void;
  onRecordProvenance: (record: ProvenanceRecord) => void;
  sessions: AnalysisSession[];
  setSessions: React.Dispatch<React.SetStateAction<AnalysisSession[]>>;
  setActiveSessionId: (id: string) => void;
  onOpenStatistics: (sessionId: string) => void;
  currentUser: User;
  studyType: StudyType;
}

const STEP_ORDER: Array<{ key: StepKey; label: string }> = [
  { key: 'qc', label: 'Quality Check' },
  { key: 'cleaning', label: 'Auto Cleaning' },
  { key: 'mapping', label: 'AI Mapping Spec' },
  { key: 'transform', label: 'Standardize Data' },
  { key: 'plan', label: 'Protocol/SAP Plan' },
  { key: 'analysis', label: 'Multi-Analysis Execution' },
];

const defaultStepState = (): Record<StepKey, StepState> => ({
  qc: { status: 'PENDING', detail: 'Waiting' },
  cleaning: { status: 'PENDING', detail: 'Waiting' },
  mapping: { status: 'PENDING', detail: 'Waiting' },
  transform: { status: 'PENDING', detail: 'Waiting' },
  plan: { status: 'PENDING', detail: 'Waiting' },
  analysis: { status: 'PENDING', detail: 'Waiting' },
});

const TARGET_DOMAIN_OPTIONS = [
  { value: 'DM', label: 'DM — Demographics / subject-level data' },
  { value: 'AE', label: 'AE — Adverse events' },
  { value: 'LB', label: 'LB — Labs' },
  { value: 'EX', label: 'EX — Exposure / dosing' },
  { value: 'DS', label: 'DS — Disposition / treatment status' },
];

const CUSTOM_TARGET_DOMAIN_VALUE = '__OTHER__';
const AUTOPILOT_ROLE_LABELS: Record<string, string> = {
  ADSL: 'Subject baseline',
  ADAE: 'Adverse events',
  ADLB: 'Labs',
  ADTTE: 'Time to event',
  ADEX: 'Exposure / dosing',
  DS: 'Disposition / adherence',
};

const recommendationConfidenceClass = (confidence?: string) =>
  confidence === 'High'
    ? 'bg-emerald-50 text-emerald-700'
    : confidence === 'Medium'
      ? 'bg-amber-50 text-amber-700'
      : 'bg-slate-100 text-slate-600';

const recommendationSupportStatusClass = (status?: 'READY' | 'PARTIAL' | 'MISSING') =>
  status === 'READY'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
    : status === 'PARTIAL'
      ? 'border-amber-200 bg-amber-50 text-amber-800'
      : 'border-red-200 bg-red-50 text-red-800';

const recommendationSupportCheckClass = (status?: 'MET' | 'PARTIAL' | 'MISSING') =>
  status === 'MET'
    ? 'text-emerald-700'
    : status === 'PARTIAL'
      ? 'text-amber-700'
      : 'text-red-700';

const deriveSavedStepState = (session: AnalysisSession | null): Record<StepKey, StepState> => {
  if (!session) return defaultStepState();

  const review = session.params.autopilotReview;
  if (!review) {
    return {
      qc: { status: 'DONE', detail: 'Saved result restored' },
      cleaning: { status: 'SKIPPED', detail: 'No saved cleaning summary' },
      mapping: { status: 'SKIPPED', detail: 'No saved mapping summary' },
      transform: { status: 'DONE', detail: `Saved ${session.params.fileName}` },
      plan: { status: 'SKIPPED', detail: 'No saved protocol summary' },
      analysis: { status: 'DONE', detail: 'Saved analysis result restored' },
    };
  }

  const qcFailed = review.qc.blockingIssueCount > 0 || review.qc.status === 'FAIL';
  const cleaningDetail =
    review.qc.autoFixSummary ||
    (review.qc.autoFixableIssueCount > 0 ? 'Auto-fix suggestions were prepared.' : 'No auto-cleaning was needed.');
  const questionMismatch =
    session.params.autopilotQuestionMatchStatus === 'FAILED'
      ? session.params.autopilotQuestionMatchSummary || 'Saved result did not match the original question.'
      : null;
  const partialQuestionMatch =
    session.params.autopilotQuestionMatchStatus === 'PARTIAL'
      ? session.params.autopilotQuestionMatchSummary || 'Saved result only partially answered the original question.'
      : null;

  return {
    qc: {
      status: qcFailed ? 'FAILED' : 'DONE',
      detail: `${review.qc.issueCount} issue(s), ${review.qc.autoFixableIssueCount} auto-fixable`,
    },
    cleaning: {
      status: review.qc.autoFixableIssueCount > 0 || review.qc.autoFixSummary ? 'DONE' : 'SKIPPED',
      detail: cleaningDetail,
    },
    mapping: {
      status: review.mapping ? 'DONE' : 'SKIPPED',
      detail: review.mapping
        ? `${review.mapping.mappedColumnCount} column(s) mapped to ${review.mapping.targetDomain}`
        : 'No saved mapping spec for this run',
    },
    transform: {
      status: 'DONE',
      detail: `Saved ${session.params.fileName}`,
    },
    plan: {
      status: review.protocol ? 'DONE' : 'SKIPPED',
      detail: review.protocol
        ? `${review.protocol.extractedPlanCount} protocol/SAP item(s) extracted`
        : review.analysisPlan.mode === 'SINGLE'
        ? 'Single-question run without protocol extraction'
        : 'No protocol/SAP document used',
    },
    analysis: {
      status: questionMismatch ? 'FAILED' : 'DONE',
      detail:
        questionMismatch ||
        partialQuestionMatch ||
        `${review.analysisPlan.tasks.length} task(s) completed${
          review.analysisPlan.multiplicityMethod ? ` with ${review.analysisPlan.multiplicityMethod}` : ''
        }`,
    },
  };
};

const normalize = (value: string) => value.trim().toLowerCase();
const baseName = (name: string) => name.replace(/\.[^/.]+$/, '');
const deriveSourceDomain = (name: string) => baseName(name).toUpperCase().replace(/[^A-Z0-9_]/g, '_');
const prettifyDatasetName = (name: string) => baseName(name).replace(/^raw_/i, '').replace(/^sdtm_/i, '').replace(/_/g, ' ');
const formatVariablesForDisplay = (left?: string, right?: string) => formatComparisonLabel(left, right);

const inferPrimaryClinicalDomain = (file: ClinicalFile | undefined): string => {
  if (!file) return 'DM';

  const name = file.name.toLowerCase();
  if (/(adae|adverse[_-]?events|\bae\b|rash|derm|safety)/i.test(name)) return 'AE';
  if (/(adlb|labs?|\blb\b|chemistry|hematology|anthro)/i.test(name)) return 'LB';
  if (/(adex|exposure|\bex\b|dose|dosing|treatment[_-]?administration)/i.test(name)) return 'EX';
  if (/(disposition|\bds\b|adherence|compliance|discontinuation|persist)/i.test(name)) return 'DS';
  if (/(adsl|demographics|\bdm\b|baseline|subjects?|comorbidit)/i.test(name)) return 'DM';

  try {
    const { headers } = parseCsv(file.content);
    const upperHeaders = headers.map((header) => header.toUpperCase());
    const hasAny = (candidates: string[]) =>
      candidates.some((candidate) => upperHeaders.some((header) => header === candidate || header.includes(candidate)));

    if (hasAny(['AETERM', 'AEDECOD', 'AETOXGR', 'AESTDY'])) return 'AE';
    if (hasAny(['PARAM', 'PARAMCD', 'LBTEST', 'LBTESTCD', 'AVAL', 'RESULT', 'VALUE'])) return 'LB';
    if (hasAny(['EXDOSE', 'DOSE', 'EXSTDY', 'EXENDY'])) return 'EX';
    if (hasAny(['DSTERM', 'DSDECOD', 'DSSTDY', 'DSDY'])) return 'DS';
    if (hasAny(['AGE', 'SEX', 'RACE', 'ARM', 'TRT01A'])) return 'DM';
  } catch {
    return 'DM';
  }

  return 'DM';
};

const isIssueAutoFixable = (issue: QCIssue): boolean => {
  if (typeof issue.autoFixable === 'boolean') return issue.autoFixable;
  return !/missing critical columns|failed to parse dataset/i.test(issue.description);
};

type ResolvedMappingDecision = AutopilotMappingDecision;

const mergeMappings = (
  sourceColumns: string[],
  aiMappings: MappingSpec['mappings'],
  referenceMappings: MappingSpec['mappings']
) => {
  const sourceByNorm = new Map(sourceColumns.map((col) => [normalize(col), col]));

  const mapBySource = (rows: MappingSpec['mappings'], origin: ResolvedMappingDecision['origin']) => {
    const mapped = new Map<string, ResolvedMappingDecision>();
    rows.forEach((row) => {
      const source = sourceByNorm.get(normalize(row.sourceCol));
      if (!source || !row.targetCol?.trim()) return;
      mapped.set(normalize(source), {
        sourceCol: source,
        targetCol: row.targetCol.trim(),
        transformation: row.transformation?.trim() || '',
        origin,
      });
    });
    return mapped;
  };

  const referenceBySource = mapBySource(referenceMappings, 'REFERENCE');
  const aiBySource = mapBySource(aiMappings, 'AI');

  return sourceColumns.map<ResolvedMappingDecision>((sourceCol) => {
    const preferred = referenceBySource.get(normalize(sourceCol)) || aiBySource.get(normalize(sourceCol));
    return preferred
      ? { sourceCol, targetCol: preferred.targetCol, transformation: preferred.transformation || '', origin: preferred.origin }
      : { sourceCol, targetCol: sourceCol, transformation: '', origin: 'IDENTITY' };
  });
};

const planEntriesToTasks = (entries: AnalysisPlanEntry[]): PlannedAutopilotTask[] =>
  entries.slice(0, 4).map((entry) => ({
    id: entry.id,
    label: entry.name,
    question: entry.rationale || entry.name,
    testType: entry.testType,
    var1: entry.var1,
    var2: entry.var2,
    covariates: entry.covariates,
    imputationMethod: entry.imputationMethod,
    applyPSM: entry.applyPSM,
    rationale: entry.rationale,
  }));

const formatTimestamp = (timestamp: string) =>
  new Date(timestamp).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

const formatMetricLabel = (value: string) => value.replace(/_/g, ' ');

const mapBackendFamilyToStatTestType = (family: BackendAnalysisFamily): StatTestType => {
  switch (family) {
    case 'kaplan_meier':
      return StatTestType.KAPLAN_MEIER;
    case 'cox':
    case 'mixed_model':
    case 'competing_risks':
      return StatTestType.COX_PH;
    case 'logistic_regression':
    case 'feature_importance':
    case 'partial_dependence':
    case 'threshold_search':
      return StatTestType.REGRESSION;
    case 'incidence':
    case 'risk_difference':
      return StatTestType.CHI_SQUARE;
    default:
      return StatTestType.REGRESSION;
  }
};

const humanizeBackendFamily = (family: BackendAnalysisFamily | null | undefined) => {
  switch (family) {
    case 'incidence':
      return 'Incidence comparison';
    case 'risk_difference':
      return 'Risk difference';
    case 'logistic_regression':
      return 'Logistic regression';
    case 'kaplan_meier':
      return 'Kaplan-Meier';
    case 'cox':
      return 'Cox proportional hazards';
    case 'mixed_model':
      return 'Repeated-measures model';
    case 'threshold_search':
      return 'Threshold search';
    case 'competing_risks':
      return 'Competing risks';
    case 'feature_importance':
      return 'Feature importance';
    case 'partial_dependence':
      return 'Partial dependence';
    default:
      return null;
  }
};

const sessionAnalysisLabel = (session: AnalysisSession) =>
  humanizeBackendFamily(session.backendExecution?.analysisFamily) || session.params.testType;

const sessionVariableSummary = (session: AnalysisSession) => {
  const receipt = session.backendExecution?.receipt;
  const primary =
    receipt?.treatmentVariable ||
    receipt?.outcomeVariable ||
    session.params.var1;
  const candidateSecondary = receipt?.timeVariable || receipt?.eventVariable || receipt?.outcomeVariable || session.params.var2;
  const secondary = candidateSecondary && candidateSecondary !== primary ? candidateSecondary : session.params.var2;
  return formatVariablesForDisplay(primary, secondary);
};

const sessionCardTitle = (session: AnalysisSession) =>
  sessionVariableSummary(session) || sessionAnalysisLabel(session) || session.params.autopilotQuestion || session.name;

const backendFamiliesAreCompatible = (
  planned: BackendAnalysisFamily | null | undefined,
  executed: BackendAnalysisFamily | null | undefined
) => {
  if (!planned || !executed) return false;
  if (planned === executed) return true;
  const incidenceFamily = new Set<BackendAnalysisFamily>(['incidence', 'risk_difference']);
  return incidenceFamily.has(planned) && incidenceFamily.has(executed);
};

const BACKEND_PLANNING_QUERY_HINTS =
  /time to resolution|resolution|earlier onset|time to onset|time to first|cumulative incidence|risk difference|predictors?|feature importance|partial dependence|mixed model|threshold|competing risk|hazard|kaplan|cox|survival|dose|dosing|weight|mitigat|differ by arm|interaction|recovery/i;

const shouldPreferBackendPlanning = (question: string, scope: AutopilotDataScope) =>
  scope === 'LINKED_WORKSPACE' || BACKEND_PLANNING_QUERY_HINTS.test(question);

const buildAutopilotPlanError = (
  question: string,
  planStatus: 'executable' | 'missing_data' | 'unsupported',
  explanation: string,
  missingRoles: string[]
) => {
  if (missingRoles.length > 0) {
    return `This question cannot be planned yet because the data is still missing ${missingRoles.join(', ')}. ${explanation}`.trim();
  }
  if (planStatus === 'unsupported') {
    return `Autopilot could not translate this question into a supported deterministic analysis yet. ${explanation}`.trim();
  }
  return explanation || `Autopilot could not build a valid analysis plan for: ${question}`;
};

const buildBackendPlanningDatasetRefs = (sourceFiles: ClinicalFile[]): FastApiDatasetReference[] =>
  sourceFiles
    .filter((file) => (file.type === DataType.RAW || file.type === DataType.STANDARDIZED) && Boolean(file.content))
    .map((file) => {
      const reference = buildDatasetReference(file);
      if (reference.role) return reference;
      const profile = inferDatasetProfile(file);
      return {
        ...reference,
        role: mapProfileKindToAnalysisRole(profile.kind),
      };
    });

const buildBackendPlannedTask = async (
  question: string,
  sourceFiles: ClinicalFile[]
): Promise<PlannedAutopilotTask> => {
  const datasetRefs = buildBackendPlanningDatasetRefs(sourceFiles);

  const plan = await requestAnalysisPlan(question, datasetRefs);
  if (plan.status !== 'executable' || !plan.spec) {
    throw new Error(buildAutopilotPlanError(question, plan.status, plan.explanation, plan.missing_roles));
  }

  const spec = plan.spec;
  const primaryVariable =
    spec.treatment_variable ||
    spec.subject_variable ||
    spec.outcome_variable ||
    spec.repeated_measure_variable ||
    spec.endpoint_label ||
    spec.target_definition ||
    'analysis target';
  const secondaryVariable =
    spec.time_variable ||
    spec.repeated_time_variable ||
    spec.event_variable ||
    (spec.outcome_variable && spec.outcome_variable !== primaryVariable ? spec.outcome_variable : '') ||
    '';
  const familyLabel = humanizeBackendFamily(spec.analysis_family) || spec.analysis_family;

  return {
    id: crypto.randomUUID(),
    label: `${familyLabel}: ${formatVariablesForDisplay(primaryVariable, secondaryVariable)}`,
    question: question.trim(),
    testType: mapBackendFamilyToStatTestType(spec.analysis_family),
    var1: primaryVariable,
    var2: secondaryVariable,
    covariates: spec.covariates,
    rationale: plan.explanation || spec.notes[0],
    backendSpec: spec,
    backendPlannedFamily: spec.analysis_family,
    backendPlanExplanation: plan.explanation,
  };
};

const buildQuestionTask = async (
  analysisFile: ClinicalFile,
  question: string,
  customSynonymsList: string[],
  sourceFiles: ClinicalFile[],
  scope: AutopilotDataScope
): Promise<PlannedAutopilotTask> => {
  if (shouldPreferBackendPlanning(question, scope)) {
    return buildBackendPlannedTask(question, sourceFiles);
  }

  const planned = planAnalysisFromQuestion(analysisFile, question, customSynonymsList);
  return {
    id: crypto.randomUUID(),
    label: `${planned.testType}: ${planned.var1} vs ${planned.var2}`,
    question: question.trim(),
    testType: planned.testType,
    var1: planned.var1,
    var2: planned.var2,
    concept: planned.concept,
    rationale: planned.explanation,
  };
};

const getModeLabel = (mode: AutopilotExecutionMode | null | undefined) => (mode === 'SINGLE' ? 'One question' : 'Analysis pack');
const getScopeLabel = (scope: AutopilotDataScope | null | undefined) =>
  scope === 'LINKED_WORKSPACE' ? 'Linked workspace' : 'Single dataset';
const getWorkflowLabel = (mode: UsageMode | null | undefined) => {
  if (mode === UsageMode.OFFICIAL) return 'Run Confirmed';
  if (mode === UsageMode.POST_HOC) return 'Post hoc';
  return 'Explore Fast';
};
const getWorkflowBadgeClass = (mode: UsageMode | null | undefined) => {
  if (mode === UsageMode.OFFICIAL) return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (mode === UsageMode.POST_HOC) return 'border-amber-200 bg-amber-50 text-amber-700';
  return 'border-blue-200 bg-blue-50 text-blue-700';
};

const buildDefaultRunName = (
  mode: AutopilotExecutionMode,
  datasetName: string,
  isConfirmedRun: boolean,
  question?: string,
  scope: AutopilotDataScope = 'SINGLE_DATASET',
  sourceCount = 1
) => {
  const sourceLabel = prettifyDatasetName(datasetName);
  const linkedLabel =
    scope === 'LINKED_WORKSPACE'
      ? `${sourceLabel}${sourceCount > 1 ? ` + ${sourceCount - 1} linked` : ''}`
      : sourceLabel;
  if (mode === 'SINGLE') {
    return question?.trim() ? `Single: ${question.trim()}` : `Single Analysis - ${linkedLabel}`;
  }
  if (scope === 'LINKED_WORKSPACE') {
    return `Linked Analysis Pack - ${linkedLabel}`;
  }
  return isConfirmedRun ? `Run Confirmed - ${sourceLabel}` : `Analysis Pack - ${sourceLabel}`;
};

const getQuestionMatchBadgeClass = (status: AnalysisSession['params']['autopilotQuestionMatchStatus']) => {
  if (status === 'FAILED') return 'border-red-200 bg-red-50 text-red-700';
  if (status === 'PARTIAL') return 'border-amber-200 bg-amber-50 text-amber-800';
  return 'border-emerald-200 bg-emerald-50 text-emerald-700';
};

const renderTableCell = (value: string | number | undefined) => {
  if (value == null || value === '') return '—';
  return String(value);
};

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const slugifyFileName = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'autopilot-report';

const FOCUS_STOP_WORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'from',
  'into',
  'that',
  'this',
  'what',
  'which',
  'does',
  'would',
  'could',
  'should',
  'have',
  'has',
  'had',
  'are',
  'was',
  'were',
  'using',
  'among',
  'across',
  'between',
  'than',
  'into',
  'then',
  'when',
  'only',
  'over',
  'best',
  'most',
  'show',
  'find',
  'explore',
  'analysis',
  'question',
  'questions',
  'dataset',
  'datasets',
  'data',
  'pack',
]);

const tokenizeFocus = (value: string) =>
  Array.from(
    new Set(
      value
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .map((token) => token.trim())
        .filter((token) => token.length > 2 && !FOCUS_STOP_WORDS.has(token))
    )
  );

const rankTasksByFocus = (tasks: AutopilotAnalysisTask[], focusQuestion: string): AutopilotAnalysisTask[] => {
  const focusTokens = tokenizeFocus(focusQuestion);
  if (focusTokens.length === 0) return tasks;

  return [...tasks]
    .map((task, index) => {
      const haystack = [task.question, task.rationale, task.label, task.var1, task.var2]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      const overlap = focusTokens.reduce((score, token) => (haystack.includes(token) ? score + 1 : score), 0);
      return { task, index, overlap };
    })
    .sort((a, b) => {
      if (b.overlap !== a.overlap) return b.overlap - a.overlap;
      return a.index - b.index;
    })
    .map(({ task }) => task);
};

const taskToHypothesisDraft = (task: AutopilotAnalysisTask): HypothesisDraft => ({
  id: task.id,
  question: task.question,
  enabled: true,
  suggestedTestType: task.testType,
  suggestedVar1: task.var1,
  suggestedVar2: task.var2,
  rationale: task.rationale,
});

const renderHtmlDataTable = (table?: ResultTable) => {
  if (!table || table.rows.length === 0) return '';

  const header = table.columns
    .map(
      (column) =>
        `<th style="padding:12px 14px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#64748b;border-bottom:1px solid #dbe3ec;background:#f8fafc;">${escapeHtml(
          formatMetricLabel(column)
        )}</th>`
    )
    .join('');

  const rows = table.rows
    .map(
      (row) => `<tr>${table.columns
        .map(
          (column) =>
            `<td style="padding:12px 14px;border-bottom:1px solid #edf2f7;color:#1f2937;vertical-align:top;">${escapeHtml(
              renderTableCell(row[column])
            )}</td>`
        )
        .join('')}</tr>`
    )
    .join('');

  return `
    <div style="margin-top:24px;border:1px solid #dbe3ec;border-radius:18px;overflow:hidden;background:#ffffff;">
      <div style="padding:14px 18px;border-bottom:1px solid #dbe3ec;background:#f8fafc;font-weight:700;color:#1f2937;">
        ${escapeHtml(table.title || 'Result Table')}
      </div>
      <div style="overflow:auto;">
        <table style="width:100%;border-collapse:collapse;font-size:14px;">
          <thead><tr>${header}</tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>
  `;
};

const buildMetricsMarkup = (metrics: Record<string, string | number>) =>
  Object.entries(metrics)
    .map(
      ([key, value]) => `
        <div style="border:1px solid #dbe3ec;border-radius:14px;background:#f8fafc;padding:14px 16px;">
          <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#64748b;font-weight:700;">${escapeHtml(
            formatMetricLabel(key)
          )}</div>
          <div style="margin-top:6px;font-size:16px;font-weight:700;color:#1f2937;word-break:break-word;">${escapeHtml(
            String(value)
          )}</div>
        </div>
      `
    )
    .join('');

const renderReviewBundleMarkup = (review: AutopilotReviewBundle | null) => {
  if (!review) return '';

  const mappingRows =
    review.mapping?.decisions
      .slice(0, 20)
      .map(
        (decision) => `
          <tr>
            <td style="padding:10px 12px;border-bottom:1px solid #edf2f7;color:#1f2937;font-weight:600;">${escapeHtml(decision.sourceCol)}</td>
            <td style="padding:10px 12px;border-bottom:1px solid #edf2f7;color:#334155;">${escapeHtml(decision.targetCol)}</td>
            <td style="padding:10px 12px;border-bottom:1px solid #edf2f7;color:#334155;">${escapeHtml(decision.origin)}</td>
            <td style="padding:10px 12px;border-bottom:1px solid #edf2f7;color:#334155;">${escapeHtml(decision.transformation || 'Identity')}</td>
          </tr>
        `
      )
      .join('') || '';

  const planRows = review.analysisPlan.tasks
    .map(
      (task) => `
        <div style="border:1px solid #dbe3ec;border-radius:14px;background:#f8fafc;padding:14px 16px;margin-top:10px;">
          <div style="font-size:15px;font-weight:700;color:#1f2937;">${escapeHtml(task.question)}</div>
          <div style="margin-top:6px;font-size:12px;color:#64748b;">${escapeHtml(task.testType)} | ${escapeHtml(
        formatVariablesForDisplay(task.var1, task.var2)
      )}</div>
          ${task.rationale ? `<div style="margin-top:8px;font-size:14px;color:#334155;">${escapeHtml(task.rationale)}</div>` : ''}
        </div>
      `
    )
    .join('');

  return `
    <div style="margin-top:28px;border:1px solid #dbe3ec;border-radius:18px;background:#ffffff;padding:22px;">
      <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.08em;color:#64748b;font-weight:700;">Review AI Decisions</div>

      <div style="margin-top:18px;border:1px solid #dbe3ec;border-radius:16px;padding:18px;background:#f8fafc;">
        <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;">
          <div>
            <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.08em;color:#64748b;font-weight:700;">Workflow Classification</div>
            <div style="margin-top:8px;font-size:14px;color:#334155;">${escapeHtml(review.workflow.rationale)}</div>
          </div>
          <div style="padding:8px 12px;border-radius:999px;background:#eff6ff;border:1px solid #bfdbfe;color:#1d4ed8;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;">
            ${escapeHtml(getWorkflowLabel(review.workflow.usageMode))}
          </div>
        </div>
      </div>

      <div style="margin-top:18px;display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;">
        <div style="border:1px solid #dbe3ec;border-radius:14px;background:#f8fafc;padding:14px 16px;">
          <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#64748b;font-weight:700;">Source File</div>
          <div style="margin-top:6px;font-size:15px;font-weight:700;color:#1f2937;word-break:break-word;">${escapeHtml(review.qc.sourceFileName)}</div>
        </div>
        <div style="border:1px solid #dbe3ec;border-radius:14px;background:#f8fafc;padding:14px 16px;">
          <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#64748b;font-weight:700;">QC Status</div>
          <div style="margin-top:6px;font-size:15px;font-weight:700;color:#1f2937;">${escapeHtml(review.qc.status)}</div>
        </div>
        <div style="border:1px solid #dbe3ec;border-radius:14px;background:#f8fafc;padding:14px 16px;">
          <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#64748b;font-weight:700;">Issues Reviewed</div>
          <div style="margin-top:6px;font-size:15px;font-weight:700;color:#1f2937;">${review.qc.issueCount}</div>
        </div>
        <div style="border:1px solid #dbe3ec;border-radius:14px;background:#f8fafc;padding:14px 16px;">
          <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#64748b;font-weight:700;">Auto-fixable Issues</div>
          <div style="margin-top:6px;font-size:15px;font-weight:700;color:#1f2937;">${review.qc.autoFixableIssueCount}</div>
        </div>
      </div>

      ${
        review.mapping
          ? `
        <div style="margin-top:18px;">
          <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.08em;color:#64748b;font-weight:700;">Mapping Decisions</div>
          <div style="margin-top:6px;font-size:14px;color:#64748b;">${escapeHtml(
            `${review.mapping.sourceDomain} -> ${review.mapping.targetDomain} | ${review.mapping.mappedColumnCount} columns`
          )}</div>
          <div style="margin-top:10px;border:1px solid #dbe3ec;border-radius:16px;overflow:hidden;">
            <table style="width:100%;border-collapse:collapse;font-size:14px;">
              <thead>
                <tr>
                  <th style="padding:10px 12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#64748b;border-bottom:1px solid #dbe3ec;background:#f8fafc;">Source</th>
                  <th style="padding:10px 12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#64748b;border-bottom:1px solid #dbe3ec;background:#f8fafc;">Target</th>
                  <th style="padding:10px 12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#64748b;border-bottom:1px solid #dbe3ec;background:#f8fafc;">Origin</th>
                  <th style="padding:10px 12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#64748b;border-bottom:1px solid #dbe3ec;background:#f8fafc;">Transformation</th>
                </tr>
              </thead>
              <tbody>${mappingRows}</tbody>
            </table>
          </div>
          ${
            review.mapping.decisions.length > 20
              ? `<div style="margin-top:8px;font-size:12px;color:#64748b;">Showing 20 of ${review.mapping.decisions.length} mapping decisions.</div>`
              : ''
          }
        </div>
      `
          : ''
      }

      ${
        review.workspace
          ? `
        <div style="margin-top:18px;">
          <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.08em;color:#64748b;font-weight:700;">Linked Workspace Preview</div>
          <div style="margin-top:6px;font-size:14px;color:#64748b;">Join key: ${escapeHtml(review.workspace.joinKey)} | ${
              review.workspace.rowCount
            } subjects | ${review.workspace.columnCount} columns</div>
        </div>
      `
          : ''
      }

      <div style="margin-top:18px;">
        <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.08em;color:#64748b;font-weight:700;">Planned Analyses</div>
        ${planRows}
      </div>
    </div>
  `;
};

const buildPlotMarkup = (chartConfig: StatAnalysisResult['chartConfig'], plotId: string) => {
  const dataJson = JSON.stringify(chartConfig.data || []);
  const layoutJson = JSON.stringify({
    ...chartConfig.layout,
    paper_bgcolor: chartConfig.layout?.paper_bgcolor || '#ffffff',
    plot_bgcolor: chartConfig.layout?.plot_bgcolor || '#ffffff',
  });

  return `
    <div style="margin-top:24px;border:1px solid #dbe3ec;border-radius:18px;padding:16px;background:#ffffff;">
      <div id="${plotId}" style="width:100%;height:460px;"></div>
    </div>
    <script src="https://cdn.plot.ly/plotly-2.27.0.min.js"></script>
    <script>
      Plotly.newPlot('${plotId}', ${dataJson}, ${layoutJson}, { responsive: true, displayModeBar: false, displaylogo: false });
    </script>
  `;
};

export const Autopilot: React.FC<AutopilotProps> = ({
  files,
  onAddFile,
  onSaveSpec,
  onRecordProvenance,
  sessions,
  setSessions,
  setActiveSessionId,
  onOpenStatistics,
  currentUser,
  studyType,
}) => {
  const [selectedSourceId, setSelectedSourceId] = useState('');
  const [selectedReferenceId, setSelectedReferenceId] = useState('');
  const [selectedProtocolId, setSelectedProtocolId] = useState('');
  const [targetDomain, setTargetDomain] = useState('DM');
  const [experienceMode, setExperienceMode] = useState<ExperienceMode>('EXPLORE_FAST');
  const [analysisMode, setAnalysisMode] = useState<AutopilotExecutionMode>('SINGLE');
  const [analysisScope, setAnalysisScope] = useState<AutopilotDataScope>('LINKED_WORKSPACE');
  const [analysisQuestion, setAnalysisQuestion] = useState('');
  const [packFocusQuestion, setPackFocusQuestion] = useState('');
  const [customSynonyms, setCustomSynonyms] = useState('');
  const [generateSasDraft, setGenerateSasDraft] = useState(false);
  const [selectedSupportingIds, setSelectedSupportingIds] = useState<string[]>([]);
  const [proposedHypotheses, setProposedHypotheses] = useState<HypothesisDraft[]>([]);
  const [hypothesisGenerationError, setHypothesisGenerationError] = useState<string | null>(null);

  const [isRunning, setIsRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [runLog, setRunLog] = useState<string[]>([]);
  const runLogRef = useRef<string[]>([]);
  const [stepState, setStepState] = useState<Record<StepKey, StepState>>(defaultStepState());
  const [selectedRunId, setSelectedRunId] = useState('');
  const [selectedResultId, setSelectedResultId] = useState('');
  const [resultDetailView, setResultDetailView] = useState<ResultDetailView>('CHART');
  const [isCreatingNewAnalysis, setIsCreatingNewAnalysis] = useState(false);
  const [showWorkflowPanels, setShowWorkflowPanels] = useState(false);
  const [isEditingRunName, setIsEditingRunName] = useState(false);
  const [runNameDraft, setRunNameDraft] = useState('');
  const [renameError, setRenameError] = useState<string | null>(null);
  const [planningAssist, setPlanningAssist] = useState<QuestionPlanningAssist | null>(null);
  const [isPlanningAssistLoading, setIsPlanningAssistLoading] = useState(false);
  const [planningAssistError, setPlanningAssistError] = useState<string | null>(null);
  const [backendPlanningPreflight, setBackendPlanningPreflight] = useState<BackendPlanningPreflightState>({
    status: 'idle',
    summary: '',
    explanation: '',
    missingRoles: [],
    sourceNames: [],
    basis: null,
  });

  const sourceFiles = useMemo(
    () => files.filter((f) => f.type === DataType.RAW || f.type === DataType.STANDARDIZED || f.type === DataType.COHORT_DEF),
    [files]
  );
  const referenceFiles = useMemo(() => files.filter((f) => f.type === DataType.MAPPING), [files]);
  const protocolFiles = useMemo(() => files.filter((f) => f.type === DataType.DOCUMENT), [files]);

  const selectedSource = sourceFiles.find((f) => f.id === selectedSourceId);
  const selectedReference = referenceFiles.find((f) => f.id === selectedReferenceId);
  const selectedProtocol = protocolFiles.find((f) => f.id === selectedProtocolId);
  const supportingSourceFiles = useMemo(
    () => sourceFiles.filter((file) => file.id !== selectedSourceId),
    [sourceFiles, selectedSourceId]
  );
  const selectedSupportingFiles = useMemo(
    () => supportingSourceFiles.filter((file) => selectedSupportingIds.includes(file.id)),
    [supportingSourceFiles, selectedSupportingIds]
  );
  const selectedTargetDomainOption = TARGET_DOMAIN_OPTIONS.some((option) => option.value === targetDomain)
    ? targetDomain
    : CUSTOM_TARGET_DOMAIN_VALUE;
  const suggestedTargetDomain = useMemo(() => inferPrimaryClinicalDomain(selectedSource), [selectedSource]);
  const activeAutopilotPrompt = analysisMode === 'SINGLE' ? analysisQuestion.trim() : packFocusQuestion.trim();
  const deferredAutopilotPrompt = useDeferredValue(activeAutopilotPrompt);
  const sourceFileProfiles = useMemo(
    () => new Map(sourceFiles.map((file) => [file.id, inferDatasetProfile(file)])),
    [sourceFiles]
  );
  const autopilotRecommendation = useMemo(
    () =>
      deferredAutopilotPrompt
        ? buildQuestionFileRecommendation(deferredAutopilotPrompt, sourceFiles, sourceFileProfiles)
        : null,
    [deferredAutopilotPrompt, sourceFiles, sourceFileProfiles]
  );
  const recommendedSourceFile = useMemo(() => {
    if (!autopilotRecommendation) return null;
    return (
      autopilotRecommendation.selectedByRole.ADSL ||
      autopilotRecommendation.selectedByRole.ADAE ||
      autopilotRecommendation.selectedByRole.ADTTE ||
      autopilotRecommendation.selectedByRole.ADEX ||
      autopilotRecommendation.selectedByRole.ADLB ||
      autopilotRecommendation.selectedByRole.DS ||
      null
    );
  }, [autopilotRecommendation]);
  const recommendedSupportingFiles = useMemo(() => {
    if (!autopilotRecommendation || !recommendedSourceFile) return [];
    return Object.values(autopilotRecommendation.selectedByRole)
      .filter((file): file is ClinicalFile => Boolean(file))
      .filter((file) => file.id !== recommendedSourceFile.id);
  }, [autopilotRecommendation, recommendedSourceFile]);
  const recommendedExecutionFiles = useMemo(() => {
    if (!autopilotRecommendation || !recommendedSourceFile) return [];
    return [recommendedSourceFile, ...recommendedSupportingFiles];
  }, [autopilotRecommendation, recommendedSourceFile, recommendedSupportingFiles]);
  const preflightExecutionFiles = useMemo(() => {
    if (
      analysisMode !== 'SINGLE' ||
      !deferredAutopilotPrompt ||
      !shouldPreferBackendPlanning(deferredAutopilotPrompt, analysisScope)
    ) {
      return { files: [] as ClinicalFile[], basis: null as BackendPlanningPreflightState['basis'] };
    }

    if (selectedSource) {
      return {
        files: analysisScope === 'LINKED_WORKSPACE' ? [selectedSource, ...selectedSupportingFiles] : [selectedSource],
        basis: 'current' as const,
      };
    }

    if (recommendedExecutionFiles.length > 0) {
      return {
        files: recommendedExecutionFiles,
        basis: 'recommended' as const,
      };
    }

    return { files: [] as ClinicalFile[], basis: null as BackendPlanningPreflightState['basis'] };
  }, [
    deferredAutopilotPrompt,
    analysisMode,
    analysisScope,
    recommendedExecutionFiles,
    selectedSource,
    selectedSupportingFiles,
  ]);
  const applyRecommendedAutopilotFiles = () => {
    if (!recommendedSourceFile) return;
    setSelectedSourceId(recommendedSourceFile.id);
    setSelectedSupportingIds(recommendedSupportingFiles.map((file) => file.id));
  };
  const handleGeneratePlanningAssist = async () => {
    if (!activeAutopilotPrompt || sourceFiles.length === 0 || isPlanningAssistLoading) return;
    setIsPlanningAssistLoading(true);
    setPlanningAssistError(null);
    try {
      const assist = await generateQuestionPlanningAssist(
        activeAutopilotPrompt,
        sourceFiles,
        backendPlanningPreflight.status !== 'idle'
          ? {
              status: backendPlanningPreflight.status,
              summary: backendPlanningPreflight.summary,
              explanation: backendPlanningPreflight.explanation,
              missingRoles: backendPlanningPreflight.missingRoles,
              sourceNames: backendPlanningPreflight.sourceNames,
            }
          : null
      );
      if (!assist) {
        setPlanningAssistError('AI planning assist could not propose advice from the current files.');
        setPlanningAssist(null);
      } else {
        setPlanningAssist(assist);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'AI planning assist failed.';
      setPlanningAssistError(message);
      setPlanningAssist(null);
    } finally {
      setIsPlanningAssistLoading(false);
    }
  };
  const enabledHypotheses = useMemo(
    () => proposedHypotheses.filter((hypothesis) => hypothesis.enabled && hypothesis.question.trim()),
    [proposedHypotheses]
  );

  useEffect(() => {
    setPlanningAssist(null);
    setPlanningAssistError(null);
  }, [activeAutopilotPrompt, sourceFiles]);

  useEffect(() => {
    let cancelled = false;

    const resetPreflight = () => {
      if (cancelled) return;
      setBackendPlanningPreflight({
        status: 'idle',
        summary: '',
        explanation: '',
        missingRoles: [],
        sourceNames: [],
        basis: null,
      });
    };

    if (
      analysisMode !== 'SINGLE' ||
      !deferredAutopilotPrompt ||
      !shouldPreferBackendPlanning(deferredAutopilotPrompt, analysisScope) ||
      preflightExecutionFiles.files.length === 0
    ) {
      resetPreflight();
      return () => {
        cancelled = true;
      };
    }

    const sourceNames = preflightExecutionFiles.files.map((file) => file.name);
    const datasetRefs = buildBackendPlanningDatasetRefs(preflightExecutionFiles.files);

    if (datasetRefs.length === 0) {
      setBackendPlanningPreflight({
        status: 'error',
        summary: 'Backend preflight could not inspect the selected files.',
        explanation: 'The selected files do not expose tabular content that can be sent to the deterministic planner.',
        missingRoles: [],
        sourceNames,
        basis: preflightExecutionFiles.basis,
      });
      return () => {
        cancelled = true;
      };
    }

    setBackendPlanningPreflight({
      status: 'loading',
      summary: 'Checking deterministic readiness against the backend planner.',
      explanation: '',
      missingRoles: [],
      sourceNames,
      basis: preflightExecutionFiles.basis,
    });

    const runPreflight = async () => {
      try {
        const plan = await requestAnalysisPlan(deferredAutopilotPrompt, datasetRefs);
        if (cancelled) return;

        setBackendPlanningPreflight({
          status: plan.status === 'executable' ? 'ready' : plan.status,
          summary:
            plan.status === 'executable'
              ? 'The backend planner says this question is executable with the selected datasets.'
              : buildAutopilotPlanError(deferredAutopilotPrompt, plan.status, plan.explanation, plan.missing_roles),
          explanation: plan.explanation,
          missingRoles: plan.missing_roles,
          sourceNames,
          basis: preflightExecutionFiles.basis,
        });
      } catch (error) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : 'Backend planning preflight failed.';
        setBackendPlanningPreflight({
          status: 'error',
          summary: 'Backend planning preflight failed.',
          explanation: message,
          missingRoles: [],
          sourceNames,
          basis: preflightExecutionFiles.basis,
        });
      }
    };

    runPreflight();

    return () => {
      cancelled = true;
    };
  }, [deferredAutopilotPrompt, analysisMode, analysisScope, preflightExecutionFiles]);

  useEffect(() => {
    if (!selectedSource) {
      setTargetDomain('DM');
      return;
    }
    setTargetDomain(suggestedTargetDomain);
  }, [selectedSourceId, selectedSource, suggestedTargetDomain]);

  useEffect(() => {
    if (experienceMode !== 'RUN_CONFIRMED') return;
    if (analysisMode !== 'PACK') setAnalysisMode('PACK');
    if (analysisScope !== 'SINGLE_DATASET') setAnalysisScope('SINGLE_DATASET');
  }, [experienceMode, analysisMode, analysisScope]);

  useEffect(() => {
    setProposedHypotheses([]);
    setHypothesisGenerationError(null);
  }, [
    selectedSourceId,
    selectedSupportingIds.join('|'),
    analysisMode,
    analysisScope,
    experienceMode,
    customSynonyms,
    packFocusQuestion,
  ]);

  const confirmedBlockingReason = useMemo(() => {
    if (experienceMode !== 'RUN_CONFIRMED') return null;
    if (!selectedProtocol) return 'Run Confirmed requires a Protocol or SAP document.';
    if (analysisScope !== 'SINGLE_DATASET') return 'Run Confirmed currently supports single-dataset protocol-driven runs only.';
    if (analysisMode !== 'PACK') return 'Run Confirmed only supports Analysis Pack mode.';
    return null;
  }, [experienceMode, selectedProtocol, analysisScope, analysisMode]);

  const hypothesisGenerationBlockingReason = useMemo(() => {
    if (analysisMode !== 'PACK') return null;
    if (!selectedSource) return 'Select a source dataset first.';
    if (analysisScope === 'LINKED_WORKSPACE' && selectedSupportingFiles.length === 0) {
      return 'Select at least one supporting dataset for linked workspace mode.';
    }
    return null;
  }, [analysisMode, analysisScope, selectedSource, selectedSupportingFiles.length]);

  const backendPlanningBlockingReason = useMemo(() => {
    if (
      analysisMode !== 'SINGLE' ||
      !deferredAutopilotPrompt ||
      !shouldPreferBackendPlanning(deferredAutopilotPrompt, analysisScope) ||
      preflightExecutionFiles.basis !== 'current'
    ) {
      return null;
    }

    if (backendPlanningPreflight.status === 'missing_data' || backendPlanningPreflight.status === 'unsupported') {
      return backendPlanningPreflight.summary;
    }

    return null;
  }, [
    deferredAutopilotPrompt,
    analysisMode,
    analysisScope,
    backendPlanningPreflight,
    preflightExecutionFiles.basis,
  ]);

  const runMode = useMemo(() => {
    if (experienceMode === 'RUN_CONFIRMED') {
      return {
        label: 'Run Confirmed pack',
        helper:
          'Controlled protocol/SAP-driven mode. Autopilot will extract pre-specified analyses, save them as reviewed sessions, and block free-form exploratory execution.',
        button: 'Run Confirmed Pack',
      };
    }
    if (analysisScope === 'LINKED_WORKSPACE') {
      if (analysisMode === 'SINGLE') {
        return {
          label: 'Linked one-question analysis',
          helper: 'Autopilot will build a subject-level workspace from the selected datasets and answer one focused cross-domain question.',
          button: 'Run Linked Analysis',
        };
      }
      return {
        label: 'Linked exploratory analysis pack',
        helper: 'Autopilot will join the selected datasets by subject, propose distinct cross-domain hypotheses, and run the approved exploratory analyses.',
        button: 'Run Linked Analysis Pack',
      };
    }
    if (analysisMode === 'SINGLE') {
      return {
        label: 'Single targeted analysis',
        helper: 'Use one plain-language question when you want a single focused analysis instead of a saved pack.',
        button: 'Run One Analysis',
      };
    }
    if (selectedProtocol) {
      return {
        label: 'Protocol-driven analysis pack',
        helper: 'Autopilot will try to extract several pre-specified analyses from the selected document and save them together as one run.',
        button: 'Run Protocol Analysis Pack',
      };
    }
    return {
      label: 'Autopilot analysis pack',
      helper: 'Autopilot will propose several distinct clinically relevant hypotheses, let you review them, and save the approved analyses as one reusable run.',
      button: 'Run Analysis Pack',
    };
  }, [analysisMode, analysisScope, experienceMode, selectedProtocol]);

  const autopilotRuns = useMemo<AutopilotRunGroup[]>(() => {
    const grouped = new Map<string, AnalysisSession[]>();

    sessions
      .filter((session) => session.params.autopilotRunId || session.name.toLowerCase().includes('autopilot'))
      .forEach((session) => {
        const runId = session.params.autopilotRunId || `legacy-${session.id}`;
        const existing = grouped.get(runId);
        if (existing) existing.push(session);
        else grouped.set(runId, [session]);
      });

    return Array.from(grouped.entries())
      .map(([runId, runSessions]) => {
        const ordered = [...runSessions].sort((a, b) => {
          const indexDiff = (a.params.autopilotResultIndex ?? 999) - (b.params.autopilotResultIndex ?? 999);
          if (indexDiff !== 0) return indexDiff;
          return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
        });
        const byTime = [...runSessions].sort(
          (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        );
        const first = ordered[0];
        const latest = byTime[0];
        const mode = first.params.autopilotMode || (ordered.length > 1 ? 'PACK' : 'SINGLE');
        const sourceName = first.params.autopilotSourceName || first.params.fileName;
        const runName =
          first.params.autopilotRunName ||
          buildDefaultRunName(
            mode,
            sourceName,
            first.usageMode === UsageMode.OFFICIAL,
            first.params.autopilotQuestion || undefined,
            first.params.autopilotDataScope || 'SINGLE_DATASET',
            first.params.autopilotSourceNames?.length || 1
          );

        return {
          runId,
          runName,
          sessions: ordered,
          datasetName: sourceName,
          latestTimestamp: latest.timestamp,
          firstTimestamp: ordered[0].timestamp,
          analysisCount: ordered.length,
          modeLabel: getModeLabel(mode),
          scopeLabel: getScopeLabel(first.params.autopilotDataScope),
          workflowMode: first.usageMode,
          questionPreview:
            first.params.autopilotQuestionMatchStatus === 'FAILED'
              ? `${first.params.autopilotQuestionMatchSummary || 'Question mismatch'} ${first.params.autopilotQuestion || first.name}`
              : first.params.autopilotQuestion || first.name,
        };
      })
      .sort((a, b) => new Date(b.latestTimestamp).getTime() - new Date(a.latestTimestamp).getTime());
  }, [sessions]);

  const selectedRun =
    selectedRunId === CURRENT_RUN_SENTINEL
      ? null
      : autopilotRuns.find((run) => run.runId === selectedRunId) || (!selectedRunId ? autopilotRuns[0] || null : null);
  const selectedRunResults = selectedRun?.sessions || [];
  const selectedResult = selectedRunResults.find((session) => session.id === selectedResultId) || selectedRunResults[0] || null;
  const activeResultTable = selectedResult?.tableConfig;
  const activeReview = selectedResult?.params.autopilotReview || null;
  const hasUnsavedFailedAttempt = !isRunning && Boolean(runError) && runLog.length > 0;
  const displayedStepState = useMemo(
    () => (isRunning || hasUnsavedFailedAttempt ? stepState : deriveSavedStepState(selectedResult)),
    [hasUnsavedFailedAttempt, isRunning, stepState, selectedResult]
  );
  const displayedRunLog = useMemo(() => {
    if (isRunning || hasUnsavedFailedAttempt) return runLog;

    const persistedLog = selectedRunResults.reduce<string[]>((best, session) => {
      const candidate = session.params.autopilotExecutionLog || [];
      return candidate.length > best.length ? candidate : best;
    }, []);
    if (persistedLog.length > 0) return persistedLog;

    if (!selectedRun || !selectedResult) return [];

    const review = selectedResult.params.autopilotReview;
    const fallbackLog = [
      `[Saved] Restored run "${selectedRun.runName}".`,
      `[Saved] ${selectedRun.analysisCount} analysis result(s) saved on ${formatTimestamp(selectedRun.latestTimestamp)}.`,
    ];

    if (review) {
      fallbackLog.push(
        `[Saved] QC: ${review.qc.status} with ${review.qc.issueCount} issue(s) and ${review.qc.autoFixableIssueCount} auto-fixable finding(s).`
      );
      if (review.mapping) {
        fallbackLog.push(
          `[Saved] Mapping: ${review.mapping.mappedColumnCount} column(s) mapped to ${review.mapping.targetDomain}.`
        );
      }
      if (review.workspace) {
        fallbackLog.push(
          `[Saved] Workspace: ${review.workspace.rowCount} row(s), ${review.workspace.columnCount} column(s), join key ${review.workspace.joinKey}.`
        );
      }
      if (review.protocol) {
        fallbackLog.push(
          `[Saved] Protocol/SAP: ${review.protocol.extractedPlanCount} plan item(s) extracted from ${review.protocol.documentName}.`
        );
      }
      fallbackLog.push(`[Saved] Analysis plan: ${review.analysisPlan.tasks.length} task(s) were completed.`);
    }

    return fallbackLog;
  }, [hasUnsavedFailedAttempt, isRunning, runLog, selectedRun, selectedResult, selectedRunResults]);
  const failureLogPreview = useMemo(() => {
    if (!hasUnsavedFailedAttempt) return [];
    return displayedRunLog.slice(-5);
  }, [displayedRunLog, hasUnsavedFailedAttempt]);

  const updateStep = (key: StepKey, status: StepStatus, detail: string) => {
    setStepState((prev) => ({ ...prev, [key]: { status, detail } }));
  };

  const appendLog = (line: string) => {
    const ts = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const entry = `[${ts}] ${line}`;
    runLogRef.current = [...runLogRef.current, entry];
    setRunLog(runLogRef.current);
  };

  const buildDefaultQuestion = () =>
    studyType === StudyType.RWE
      ? 'Assess clinically relevant differences between cohorts.'
      : 'Run clinically meaningful baseline and safety analyses for this dataset.';

  useEffect(() => {
    if (isRunning) return;

    if (autopilotRuns.length === 0) {
      setSelectedRunId('');
      setSelectedResultId('');
      setIsCreatingNewAnalysis(true);
      return;
    }

    setSelectedRunId((prev) => {
      if (prev === CURRENT_RUN_SENTINEL) return prev;
      return autopilotRuns.some((run) => run.runId === prev) ? prev : autopilotRuns[0].runId;
    });
  }, [autopilotRuns, isRunning]);

  useEffect(() => {
    if (!selectedRun) {
      setSelectedResultId('');
      setRunNameDraft('');
      setIsEditingRunName(false);
      return;
    }

    setSelectedResultId((prev) =>
      selectedRun.sessions.some((session) => session.id === prev) ? prev : selectedRun.sessions[0].id
    );
    setRunNameDraft(selectedRun.runName);
    setIsEditingRunName(false);
    setRenameError(null);
  }, [selectedRun]);

  useEffect(() => {
    setSelectedSupportingIds((prev) => prev.filter((id) => id !== selectedSourceId));
  }, [selectedSourceId]);

  const toggleSupportingFile = (fileId: string) => {
    setSelectedSupportingIds((prev) =>
      prev.includes(fileId) ? prev.filter((id) => id !== fileId) : [...prev, fileId]
    );
  };

  const selectAllSupportingFiles = () => {
    setSelectedSupportingIds(supportingSourceFiles.map((file) => file.id));
  };

  const clearSupportingFiles = () => {
    setSelectedSupportingIds([]);
  };

  const generatePackHypotheses = () => {
    if (!selectedSource) {
      setHypothesisGenerationError('Select a source dataset first.');
      return;
    }

    if (analysisScope === 'LINKED_WORKSPACE' && selectedSupportingFiles.length === 0) {
      setHypothesisGenerationError('Select at least one supporting dataset before generating linked-workspace hypotheses.');
      return;
    }

    try {
      const customSynonymList = customSynonyms
        .split(',')
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean);

      const planningFile =
        analysisScope === 'LINKED_WORKSPACE'
          ? buildLinkedAnalysisWorkspace(selectedSource, selectedSupportingFiles, customSynonymList).workspaceFile
          : selectedSource;

      const rawTasks =
        analysisScope === 'LINKED_WORKSPACE'
          ? buildExploratorySignalTasks(planningFile, 6)
          : buildAutopilotAnalysisSuite(planningFile, customSynonymList);

      const rankedTasks = rankTasksByFocus(rawTasks, packFocusQuestion).slice(0, 6);
      if (rankedTasks.length === 0) {
        setHypothesisGenerationError('Autopilot could not propose distinct hypotheses from the currently selected data.');
        setProposedHypotheses([]);
        return;
      }

      setProposedHypotheses(rankedTasks.map(taskToHypothesisDraft));
      setHypothesisGenerationError(null);
      setRunError(null);
    } catch (error: any) {
      setProposedHypotheses([]);
      setHypothesisGenerationError(error?.message || 'Autopilot could not generate hypotheses from the selected files.');
    }
  };

  const toggleHypothesisEnabled = (id: string) => {
    setProposedHypotheses((prev) =>
      prev.map((hypothesis) => (hypothesis.id === id ? { ...hypothesis, enabled: !hypothesis.enabled } : hypothesis))
    );
  };

  const updateHypothesisQuestion = (id: string, question: string) => {
    setProposedHypotheses((prev) =>
      prev.map((hypothesis) => (hypothesis.id === id ? { ...hypothesis, question } : hypothesis))
    );
  };

  const startNewAnalysis = () => {
    setIsCreatingNewAnalysis(true);
    setRunError(null);
    setSelectedRunId(CURRENT_RUN_SENTINEL);
    setSelectedResultId('');
    setShowWorkflowPanels(false);
    setProposedHypotheses([]);
    setHypothesisGenerationError(null);
  };

  const closeNewAnalysis = () => {
    if (isRunning || autopilotRuns.length === 0) return;
    setIsCreatingNewAnalysis(false);
    setRunError(null);
    setSelectedRunId((prev) => (prev === CURRENT_RUN_SENTINEL ? autopilotRuns[0]?.runId || '' : prev));
  };

  useEffect(() => {
    if (selectedResult?.tableConfig && resultDetailView === 'TABLE') return;
    if (!selectedResult?.tableConfig && resultDetailView === 'TABLE') {
      setResultDetailView('CHART');
    }
  }, [selectedResult, resultDetailView]);

  const handleSaveRunName = () => {
    if (!selectedRun) return;
    const trimmed = runNameDraft.trim();
    if (!trimmed) {
      setRenameError('Run name cannot be empty.');
      return;
    }

    setSessions((prev) =>
      prev.map((session) =>
        session.params.autopilotRunId === selectedRun.runId
          ? {
              ...session,
              params: {
                ...session.params,
                autopilotRunName: trimmed,
              },
            }
          : session
      )
    );

    onRecordProvenance({
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      userId: currentUser.name,
      userRole: currentUser.role,
      actionType: ProvenanceType.STATISTICS,
      details: `Renamed Autopilot run to ${trimmed}.`,
      inputs: selectedRun.sessions.map((session) => session.id),
      outputs: selectedRun.sessions.map((session) => session.id),
    });

    setIsEditingRunName(false);
    setRenameError(null);
  };

  const handleDeleteRun = (runId: string) => {
    const runToDelete = autopilotRuns.find((run) => run.runId === runId);
    if (!runToDelete) return;

    const confirmed = window.confirm(
      `Delete the Autopilot run "${runToDelete.runName}"?\n\nThis will remove ${runToDelete.analysisCount} saved analysis result${runToDelete.analysisCount === 1 ? '' : 's'} from the workspace.`
    );
    if (!confirmed) return;

    const runSessionIds = new Set(runToDelete.sessions.map((session) => session.id));

    setSessions((prev) => prev.filter((session) => !runSessionIds.has(session.id)));
    setSelectedResultId((prev) => (runSessionIds.has(prev) ? '' : prev));
    setSelectedRunId((prev) => (prev === runId ? '' : prev));

    onRecordProvenance({
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      userId: currentUser.name,
      userRole: currentUser.role,
      actionType: ProvenanceType.STATISTICS,
      details: `Deleted Autopilot run ${runToDelete.runName}.`,
      inputs: runToDelete.sessions.map((session) => session.id),
      outputs: [],
    });
  };

  const downloadHtmlReport = (fileName: string, html: string) => {
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const buildResultExportHtml = (run: AutopilotRunGroup, session: AnalysisSession) => {
    const title = `Evidence CoPilot | ${run.runName}`;
    const plotId = `plot-${session.id}`;
    const variables = sessionVariableSummary(session);
    const analysisLabel = sessionAnalysisLabel(session);
    const linkedSources = session.params.autopilotSourceNames?.length ? session.params.autopilotSourceNames.join(', ') : session.params.autopilotSourceName || '';
    const questionMatchStatus = session.params.autopilotQuestionMatchStatus;
    const questionMismatch = questionMatchStatus === 'FAILED';
    const questionPartial = questionMatchStatus === 'PARTIAL';

    return `
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>${escapeHtml(title)}</title>
          <style>
            body { margin: 0; background: #eef2f5; color: #18212b; font-family: Aptos, "Segoe UI", sans-serif; }
            .page { max-width: 1240px; margin: 0 auto; padding: 40px 32px 56px; }
            .brand { display: flex; align-items: center; gap: 18px; }
            .brand img { width: 280px; height: auto; display: block; }
            .hero { margin-top: 28px; background: #ffffff; border: 1px solid #d7dee7; border-radius: 24px; padding: 28px; box-shadow: 0 18px 50px rgba(15, 23, 42, 0.06); }
            .eyebrow { font-size: 11px; text-transform: uppercase; letter-spacing: 0.12em; color: #64748b; font-weight: 700; }
            .title { margin-top: 10px; font-size: 34px; line-height: 1.15; font-weight: 800; color: #0f172a; }
            .subtitle { margin-top: 10px; font-size: 15px; color: #475569; }
            .question { margin-top: 18px; border: 1px solid #dbeafe; background: #eff6ff; color: #1e3a8a; border-radius: 16px; padding: 16px 18px; font-size: 15px; }
            .section { margin-top: 22px; background: #ffffff; border: 1px solid #d7dee7; border-radius: 20px; padding: 22px; box-shadow: 0 10px 32px rgba(15, 23, 42, 0.05); }
            .section-title { font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: #64748b; font-weight: 700; margin-bottom: 14px; }
            .grid { display: grid; gap: 14px; }
            .grid.meta { grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); }
            .grid.summary { grid-template-columns: minmax(0, 1.5fr) minmax(280px, 0.9fr); align-items: start; }
            .card { border: 1px solid #dbe3ec; border-radius: 16px; background: #f8fafc; padding: 14px 16px; }
            .card-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: #64748b; font-weight: 700; }
            .card-value { margin-top: 6px; font-size: 15px; line-height: 1.5; color: #1f2937; font-weight: 700; word-break: break-word; }
            .body-copy { font-size: 16px; line-height: 1.8; color: #1f2937; }
            .muted { color: #64748b; }
            .badge { display: inline-flex; padding: 8px 12px; border-radius: 999px; border: 1px solid #bfdbfe; background: #eff6ff; color: #1d4ed8; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; }
            .footer { margin-top: 28px; border-top: 1px solid #d7dee7; padding-top: 18px; font-size: 12px; color: #94a3b8; text-align: center; }
            ul { margin: 0; padding-left: 20px; }
            li { margin-bottom: 8px; }
            @media print {
              body { background: #ffffff; }
              .page { padding: 16px; }
              .hero, .section { box-shadow: none; break-inside: avoid; }
            }
          </style>
        </head>
        <body>
          <div class="page">
            <div class="brand">
              <img src="${escapeHtml(`${window.location.origin}/ECP%20Logo.png`)}" alt="Evidence CoPilot" />
            </div>

            <div class="hero">
              <div class="eyebrow">Autopilot Result Export</div>
              <div class="title">${escapeHtml(run.runName)}</div>
              <div class="subtitle">${escapeHtml(analysisLabel)} | ${escapeHtml(variables)}</div>
              <div style="margin-top:16px;"><span class="badge">${escapeHtml(getWorkflowLabel(session.usageMode))}</span></div>
              ${
                session.params.autopilotQuestion
                  ? `<div class="question">${escapeHtml(session.params.autopilotQuestion)}</div>`
                  : ''
              }
              ${
                session.params.autopilotQuestionMatchSummary
                  ? `<div style="margin-top:14px;border:1px solid ${
                      questionMismatch ? '#fecaca' : questionPartial ? '#fde68a' : '#bbf7d0'
                    };background:${questionMismatch ? '#fef2f2' : questionPartial ? '#fffbeb' : '#f0fdf4'};color:${questionMismatch ? '#991b1b' : questionPartial ? '#92400e' : '#166534'};border-radius:14px;padding:12px 14px;font-size:14px;">${escapeHtml(
                      session.params.autopilotQuestionMatchSummary
                    )}</div>`
                  : ''
              }
            </div>

            <div class="section">
              <div class="section-title">Run Details</div>
              <div class="grid meta">
                <div class="card"><div class="card-label">Source Dataset</div><div class="card-value">${escapeHtml(
                  session.params.autopilotSourceName || run.datasetName
                )}</div></div>
                <div class="card"><div class="card-label">Scope</div><div class="card-value">${escapeHtml(
                  getScopeLabel(session.params.autopilotDataScope)
                )}</div></div>
                <div class="card"><div class="card-label">Saved</div><div class="card-value">${escapeHtml(
                  formatTimestamp(session.timestamp)
                )}</div></div>
                <div class="card"><div class="card-label">Standardized Dataset</div><div class="card-value">${escapeHtml(
                  session.params.fileName
                )}</div></div>
                ${
                  linkedSources
                    ? `<div class="card" style="grid-column:1/-1;"><div class="card-label">Linked Source Datasets</div><div class="card-value">${escapeHtml(
                        linkedSources
                      )}</div></div>`
                    : ''
                }
              </div>
            </div>

            ${
              session.backendExecution?.receipt
                ? `
              <div class="section">
                <div class="section-title">Executed Analysis Receipt</div>
                <div class="grid meta">
                  ${
                    session.backendExecution.receipt.endpointLabel
                      ? `<div class="card"><div class="card-label">Endpoint</div><div class="card-value">${escapeHtml(
                          session.backendExecution.receipt.endpointLabel
                        )}</div></div>`
                      : ''
                  }
                  ${
                    session.backendExecution.receipt.targetDefinition
                      ? `<div class="card"><div class="card-label">Target Definition</div><div class="card-value">${escapeHtml(
                          session.backendExecution.receipt.targetDefinition
                        )}</div></div>`
                      : ''
                  }
                  ${
                    session.backendExecution.receipt.treatmentVariable
                      ? `<div class="card"><div class="card-label">Grouping Variable</div><div class="card-value">${escapeHtml(
                          session.backendExecution.receipt.treatmentVariable
                        )}</div></div>`
                      : ''
                  }
                  ${
                    session.backendExecution.receipt.timeVariable
                      ? `<div class="card"><div class="card-label">Time Variable</div><div class="card-value">${escapeHtml(
                          session.backendExecution.receipt.timeVariable
                        )}</div></div>`
                      : ''
                  }
                  ${
                    session.backendExecution.receipt.eventVariable
                      ? `<div class="card"><div class="card-label">Event Variable</div><div class="card-value">${escapeHtml(
                          session.backendExecution.receipt.eventVariable
                        )}</div></div>`
                      : session.backendExecution.receipt.outcomeVariable
                        ? `<div class="card"><div class="card-label">Outcome Variable</div><div class="card-value">${escapeHtml(
                            session.backendExecution.receipt.outcomeVariable
                          )}</div></div>`
                        : ''
                  }
                  ${
                    session.backendExecution.receipt.outcomeVariable &&
                    session.backendExecution.receipt.eventVariable &&
                    session.backendExecution.receipt.outcomeVariable !== session.backendExecution.receipt.eventVariable
                      ? `<div class="card"><div class="card-label">Derived Outcome Flag</div><div class="card-value">${escapeHtml(
                          session.backendExecution.receipt.outcomeVariable
                        )}</div></div>`
                      : ''
                  }
                  ${
                    session.backendExecution.receipt.cohortFiltersApplied.length > 0
                      ? `<div class="card" style="grid-column:1/-1;"><div class="card-label">Cohort Filters</div><div class="card-value">${escapeHtml(
                          session.backendExecution.receipt.cohortFiltersApplied.join(', ')
                        )}</div></div>`
                      : ''
                  }
                </div>
              </div>
            `
                : ''
            }

            ${
              session.chartConfig
                ? `<div class="section"><div class="section-title">Visualization</div>${buildPlotMarkup(session.chartConfig, plotId)}</div>`
                : ''
            }

            ${
              session.aiCommentary
                ? `
              <div class="section">
                <div class="section-title">Metrics</div>
                <div class="grid meta">${buildMetricsMarkup(session.metrics)}</div>
              </div>
            `
                : `
              <div class="section">
                <div class="section-title">Summary</div>
                <div class="grid summary">
                  <div class="card" style="background:#ffffff;">
                    <div class="card-label">Statistical Interpretation</div>
                    <div class="body-copy" style="margin-top:8px;">${escapeHtml(session.interpretation)}</div>
                  </div>
                  <div>
                    <div class="section-title" style="margin-bottom:10px;">Metrics</div>
                    <div class="grid meta">${buildMetricsMarkup(session.metrics)}</div>
                  </div>
                </div>
              </div>
            `
            }

            ${
              session.aiCommentary
                ? `
              <div class="section">
                <div class="section-title">AI Clinical Commentary</div>
                ${
                  session.aiCommentary.sections?.status
                    ? `<div style="margin-bottom:16px;border:1px solid #dbeafe;background:#eff6ff;color:#1e3a8a;border-radius:14px;padding:12px 14px;font-size:14px;"><strong>Status:</strong> ${escapeHtml(
                        session.aiCommentary.sections.status
                      )}</div>`
                    : ''
                }
                ${
                  session.aiCommentary.sections?.directAnswer
                    ? `<div style="margin-top:6px;"><div class="card-label">Direct Answer</div><div class="body-copy" style="margin-top:8px;">${escapeHtml(
                        session.aiCommentary.sections.directAnswer
                      )}</div></div>`
                    : ''
                }
                ${
                  session.aiCommentary.sections?.population
                    ? `<div style="margin-top:16px;"><div class="card-label">Analysis Population</div><div class="body-copy" style="margin-top:8px;">${escapeHtml(
                        session.aiCommentary.sections.population
                      )}</div></div>`
                    : ''
                }
                ${
                  session.aiCommentary.sections?.endpointDefinition
                    ? `<div style="margin-top:16px;"><div class="card-label">Endpoint Definition</div><div class="body-copy" style="margin-top:8px;">${escapeHtml(
                        session.aiCommentary.sections.endpointDefinition
                      )}</div></div>`
                    : ''
                }
                ${
                  session.aiCommentary.sections?.mainFindings
                    ? `<div style="margin-top:16px;"><div class="card-label">Main Findings</div><div class="body-copy" style="margin-top:8px;">${escapeHtml(
                        session.aiCommentary.sections.mainFindings
                      )}</div></div>`
                    : `<div class="body-copy">${escapeHtml(session.aiCommentary.summary)}</div>`
                }
                ${
                  session.aiCommentary.sections?.interactionFindings
                    ? `<div style="margin-top:16px;"><div class="card-label">Arm Interaction Findings</div><div class="body-copy" style="margin-top:8px;">${escapeHtml(
                        session.aiCommentary.sections.interactionFindings
                      )}</div></div>`
                    : ''
                }
                ${
                  session.aiCommentary.sections?.modelStrength
                    ? `<div style="margin-top:16px;"><div class="card-label">Model Strength</div><div class="body-copy" style="margin-top:8px;">${escapeHtml(
                        session.aiCommentary.sections.modelStrength
                      )}</div></div>`
                    : ''
                }
                ${
                  session.aiCommentary.sections?.nextSteps && session.aiCommentary.sections.nextSteps.length > 0
                    ? `<div style="margin-top:16px;"><div class="card-label">What to Do Next</div><ul style="margin-top:10px;" class="muted">${session.aiCommentary.sections.nextSteps
                        .map((item) => `<li>${escapeHtml(item)}</li>`)
                        .join('')}</ul></div>`
                    : ''
                }
                ${
                  !session.aiCommentary.sections?.mainFindings
                    ? ''
                    : `<div style="margin-top:16px;"><div class="card-label">Summary</div><div class="body-copy" style="margin-top:8px;">${escapeHtml(
                        session.aiCommentary.summary
                      )}</div></div>`
                }
                ${
                  session.aiCommentary.limitations.length
                    ? `<div style="margin-top:16px;"><div class="card-label">Limitations</div><ul style="margin-top:10px;" class="muted">${session.aiCommentary.limitations
                        .map((item) => `<li>${escapeHtml(item)}</li>`)
                        .join('')}</ul></div>`
                    : ''
                }
                ${
                  session.aiCommentary.caution
                    ? `<div style="margin-top:16px;border:1px solid #fde68a;background:#fffbeb;color:#92400e;border-radius:14px;padding:12px 14px;font-size:14px;">${escapeHtml(
                        session.aiCommentary.caution
                      )}</div>`
                    : ''
                }
              </div>
            `
                : ''
            }

            ${
              session.params.autopilotQuestionMatchDetails && session.params.autopilotQuestionMatchDetails.length > 0
                ? `
              <div class="section">
                <div class="section-title">Question Match Review</div>
                <ul class="muted">${session.params.autopilotQuestionMatchDetails
                  .map((item) => `<li>${escapeHtml(item)}</li>`)
                  .join('')}</ul>
              </div>
            `
                : ''
            }

            ${renderHtmlDataTable(session.tableConfig)}
            ${renderReviewBundleMarkup(session.params.autopilotReview || null)}

            <div class="footer">
              Exported from Evidence CoPilot on ${escapeHtml(new Date().toLocaleString())}
            </div>
          </div>
        </body>
      </html>
    `;
  };

  const buildRunExportHtml = (run: AutopilotRunGroup) => {
    const sessionMarkup = run.sessions
      .map((session, index) => {
        const variables = sessionVariableSummary(session);
        const analysisLabel = sessionAnalysisLabel(session);
        const keyMetrics = Object.entries(session.metrics)
          .slice(0, 4)
          .map(
            ([key, value]) => `
              <div style="border:1px solid #dbe3ec;border-radius:12px;background:#f8fafc;padding:10px 12px;">
                <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:#64748b;font-weight:700;">${escapeHtml(
                  formatMetricLabel(key)
                )}</div>
                <div style="margin-top:4px;font-size:14px;font-weight:700;color:#1f2937;">${escapeHtml(String(value))}</div>
              </div>
            `
          )
          .join('');

        return `
          <div style="border:1px solid #d7dee7;border-radius:18px;background:#ffffff;padding:20px;margin-top:18px;">
            <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;">
              <div>
                <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#64748b;font-weight:700;">Analysis ${index + 1}</div>
                <div style="margin-top:8px;font-size:22px;line-height:1.3;font-weight:800;color:#0f172a;">${escapeHtml(
                  session.params.autopilotQuestion || session.name
                )}</div>
                ${
                  session.params.autopilotQuestionMatchSummary
                    ? `<div style="margin-top:10px;border:1px solid ${
                        session.params.autopilotQuestionMatchStatus === 'FAILED' ? '#fecaca' : '#bbf7d0'
                      };background:${
                        session.params.autopilotQuestionMatchStatus === 'FAILED' ? '#fef2f2' : '#f0fdf4'
                      };color:${
                        session.params.autopilotQuestionMatchStatus === 'FAILED' ? '#991b1b' : '#166534'
                      };border-radius:12px;padding:10px 12px;font-size:13px;">${escapeHtml(
                        session.params.autopilotQuestionMatchSummary
                      )}</div>`
                    : ''
                }
                <div style="margin-top:6px;font-size:14px;color:#64748b;">${escapeHtml(analysisLabel)} | ${escapeHtml(
        variables
      )}</div>
              </div>
              <div style="padding:8px 12px;border-radius:999px;background:#eff6ff;border:1px solid #bfdbfe;color:#1d4ed8;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;">
                ${escapeHtml(getWorkflowLabel(session.usageMode))}
              </div>
            </div>
            <div style="margin-top:16px;font-size:15px;line-height:1.75;color:#1f2937;">${escapeHtml(session.interpretation)}</div>
            <div style="margin-top:16px;display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;">${keyMetrics}</div>
          </div>
        `;
      })
      .join('');

    return `
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>${escapeHtml(`Evidence CoPilot | ${run.runName}`)}</title>
          <style>
            body { margin:0; background:#eef2f5; color:#18212b; font-family:Aptos, "Segoe UI", sans-serif; }
            .page { max-width:1240px; margin:0 auto; padding:40px 32px 56px; }
            .hero, .section { background:#ffffff; border:1px solid #d7dee7; border-radius:22px; box-shadow:0 14px 40px rgba(15,23,42,0.05); }
            .hero { padding:28px; }
            .section { padding:24px; margin-top:22px; }
            .eyebrow { font-size:11px; text-transform:uppercase; letter-spacing:0.12em; color:#64748b; font-weight:700; }
            .title { margin-top:10px; font-size:36px; line-height:1.15; font-weight:800; color:#0f172a; }
            .subtitle { margin-top:10px; font-size:15px; color:#475569; }
            .brand img { width:280px; height:auto; display:block; }
            .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:14px; margin-top:18px; }
            .card { border:1px solid #dbe3ec; border-radius:16px; background:#f8fafc; padding:14px 16px; }
            .card-label { font-size:11px; text-transform:uppercase; letter-spacing:0.08em; color:#64748b; font-weight:700; }
            .card-value { margin-top:6px; font-size:15px; font-weight:700; color:#1f2937; word-break:break-word; }
            .footer { margin-top:28px; border-top:1px solid #d7dee7; padding-top:18px; font-size:12px; color:#94a3b8; text-align:center; }
          </style>
        </head>
        <body>
          <div class="page">
            <div class="brand"><img src="${escapeHtml(`${window.location.origin}/ECP%20Logo.png`)}" alt="Evidence CoPilot" /></div>
            <div class="hero">
              <div class="eyebrow">Autopilot Run Export</div>
              <div class="title">${escapeHtml(run.runName)}</div>
              <div class="subtitle">${escapeHtml(run.modeLabel)} | ${escapeHtml(run.scopeLabel)} | ${escapeHtml(
      prettifyDatasetName(run.datasetName)
    )}</div>
              <div class="grid">
                <div class="card"><div class="card-label">Analyses</div><div class="card-value">${run.analysisCount}</div></div>
                <div class="card"><div class="card-label">Workflow</div><div class="card-value">${escapeHtml(
                  getWorkflowLabel(run.workflowMode)
                )}</div></div>
                <div class="card"><div class="card-label">Updated</div><div class="card-value">${escapeHtml(
                  formatTimestamp(run.latestTimestamp)
                )}</div></div>
                <div class="card"><div class="card-label">Question Preview</div><div class="card-value">${escapeHtml(
                  run.questionPreview
                )}</div></div>
              </div>
            </div>

            <div class="section">
              <div class="eyebrow">Saved Analyses</div>
              ${sessionMarkup}
            </div>

            <div class="footer">
              Exported from Evidence CoPilot on ${escapeHtml(new Date().toLocaleString())}
            </div>
          </div>
        </body>
      </html>
    `;
  };

  const handleExportSelectedResult = () => {
    if (!selectedRun || !selectedResult) return;
    const fileName = `${slugifyFileName(selectedRun.runName)}-${slugifyFileName(
      formatVariablesForDisplay(selectedResult.params.var1, selectedResult.params.var2) || selectedResult.id
    )}.html`;
    downloadHtmlReport(fileName, buildResultExportHtml(selectedRun, selectedResult));
  };

  const handleExportRun = () => {
    if (!selectedRun) return;
    const fileName = `${slugifyFileName(selectedRun.runName)}-run-summary.html`;
    downloadHtmlReport(fileName, buildRunExportHtml(selectedRun));
  };

  const renderResultTable = (table: ResultTable | undefined) => {
    if (!table || table.rows.length === 0) {
      return (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-sm text-slate-500">
          No tabular summary is available for this result.
        </div>
      );
    }

    return (
      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden min-w-0">
        <div className="px-4 py-3 border-b border-slate-200 bg-slate-50">
          <div className="text-sm font-semibold text-slate-800">{table.title || 'Result Table'}</div>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                {table.columns.map((column) => (
                  <th
                    key={column}
                    className="px-4 py-3 text-left text-[11px] uppercase tracking-wide font-semibold text-slate-500 whitespace-nowrap"
                  >
                    {formatMetricLabel(column)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row, rowIndex) => (
                <tr key={rowIndex} className="border-b border-slate-100 last:border-b-0">
                  {table.columns.map((column) => (
                    <td key={column} className="px-4 py-3 text-slate-700 align-top whitespace-pre-wrap">
                      {renderTableCell(row[column])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  const renderDecisionReview = (review: AutopilotReviewBundle | null) => {
    if (!review) {
      return (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-6 text-sm text-slate-500">
          No saved AI decision review is available for this result.
        </div>
      );
    }

    const mappingPreview = review.mapping?.decisions.slice(0, 12) || [];
    const workflowMode = review.workflow?.usageMode || UsageMode.EXPLORATORY;
    const workflowRationale =
      review.workflow?.rationale ||
      'This saved run was created before execution-path classification was added, so it defaults to Explore Fast review mode.';
    const workflowGuardrails =
      review.workflow?.guardrails ||
      ['Review the saved mappings, joins, and planned analyses before reusing this run in a formal workflow.'];

    return (
      <div className="space-y-4">
        <div className="rounded-2xl border border-slate-200 p-4 bg-white">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div>
              <div className="text-xs uppercase tracking-wide text-slate-500 font-semibold">Workflow Classification</div>
              <div className="text-sm text-slate-500 mt-1">
                Autopilot stores whether this run was created as Explore Fast or Run Confirmed so users can review it in the right context.
              </div>
            </div>
            <span
              className={`inline-flex rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-wide ${getWorkflowBadgeClass(
                workflowMode
              )}`}
            >
              {getWorkflowLabel(workflowMode)}
            </span>
          </div>
          <div className="text-sm text-slate-800">{workflowRationale}</div>
          {workflowGuardrails.length > 0 && (
            <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
              <div className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold mb-2">Guardrails</div>
              <ul className="space-y-1 text-sm text-slate-700 list-disc pl-5">
                {workflowGuardrails.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-slate-200 p-4 bg-white">
          <div className="text-xs uppercase tracking-wide text-slate-500 font-semibold mb-3">QC And Data Handling</div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 text-sm">
            <div className="rounded-xl bg-slate-50 border border-slate-200 px-3 py-3">
              <div className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">Source File</div>
              <div className="mt-1 font-medium text-slate-800 break-words">{review.qc.sourceFileName}</div>
            </div>
            <div className="rounded-xl bg-slate-50 border border-slate-200 px-3 py-3">
              <div className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">QC Status</div>
              <div className="mt-1 font-medium text-slate-800">{review.qc.status}</div>
            </div>
            <div className="rounded-xl bg-slate-50 border border-slate-200 px-3 py-3">
              <div className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">Issues Reviewed</div>
              <div className="mt-1 font-medium text-slate-800">{review.qc.issueCount}</div>
            </div>
            <div className="rounded-xl bg-slate-50 border border-slate-200 px-3 py-3">
              <div className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">Auto-fixable Issues</div>
              <div className="mt-1 font-medium text-slate-800">{review.qc.autoFixableIssueCount}</div>
            </div>
          </div>
          {review.qc.autoFixSummary && (
            <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {review.qc.autoFixSummary}
            </div>
          )}
        </div>

        {review.mapping && (
          <div className="rounded-2xl border border-slate-200 p-4 bg-white">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div>
                <div className="text-xs uppercase tracking-wide text-slate-500 font-semibold">Mapping Decisions</div>
                <div className="text-sm text-slate-500 mt-1">
                  {`${review.mapping.sourceDomain} -> ${review.mapping.targetDomain} | ${review.mapping.mappedColumnCount} columns`}
                </div>
              </div>
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                {review.mapping.transformedColumnCount} transformed
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 border-y border-slate-200">
                  <tr>
                    <th className="px-3 py-2 text-left text-[11px] uppercase tracking-wide font-semibold text-slate-500">Source</th>
                    <th className="px-3 py-2 text-left text-[11px] uppercase tracking-wide font-semibold text-slate-500">Target</th>
                    <th className="px-3 py-2 text-left text-[11px] uppercase tracking-wide font-semibold text-slate-500">Origin</th>
                    <th className="px-3 py-2 text-left text-[11px] uppercase tracking-wide font-semibold text-slate-500">Transformation</th>
                  </tr>
                </thead>
                <tbody>
                  {mappingPreview.map((decision, index) => (
                    <tr key={`${decision.sourceCol}-${index}`} className="border-b border-slate-100">
                      <td className="px-3 py-2 font-medium text-slate-800">{decision.sourceCol}</td>
                      <td className="px-3 py-2 text-slate-700">{decision.targetCol}</td>
                      <td className="px-3 py-2">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                            decision.origin === 'REFERENCE'
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : decision.origin === 'AI'
                              ? 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                              : 'bg-slate-100 text-slate-600 border border-slate-200'
                          }`}
                        >
                          {decision.origin}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-slate-700">{decision.transformation || 'Identity'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {review.mapping.decisions.length > mappingPreview.length && (
              <div className="mt-2 text-xs text-slate-500">
                Showing {mappingPreview.length} of {review.mapping.decisions.length} mapping decisions.
              </div>
            )}
          </div>
        )}

        {review.workspace && (
          <div className="rounded-2xl border border-slate-200 p-4 bg-white">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div>
                <div className="text-xs uppercase tracking-wide text-slate-500 font-semibold">Linked Workspace Preview</div>
                <div className="text-sm text-slate-500 mt-1">
                  Join key: {review.workspace.joinKey} | {review.workspace.rowCount} subjects | {review.workspace.columnCount} columns
                </div>
              </div>
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                {review.workspace.sourceNames.length} dataset{review.workspace.sourceNames.length === 1 ? '' : 's'}
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm mb-3">
              <div className="rounded-xl bg-slate-50 border border-slate-200 px-3 py-3">
                <div className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">Included Datasets</div>
                <div className="mt-1 text-slate-800 break-words">{review.workspace.sourceNames.join(', ')}</div>
              </div>
              <div className="rounded-xl bg-slate-50 border border-slate-200 px-3 py-3">
                <div className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">Skipped Datasets</div>
                <div className="mt-1 text-slate-800 break-words">
                  {review.workspace.skippedFiles.length > 0 ? review.workspace.skippedFiles.join(', ') : 'None'}
                </div>
              </div>
            </div>
            {review.workspace.derivedColumns.length > 0 && (
              <div className="rounded-xl bg-slate-50 border border-slate-200 px-3 py-3 mb-3">
                <div className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">Derived Columns</div>
                <div className="mt-1 text-slate-800 break-words">
                  {review.workspace.derivedColumns.slice(0, 12).join(', ')}
                  {review.workspace.derivedColumns.length > 12 ? ` and ${review.workspace.derivedColumns.length - 12} more` : ''}
                </div>
              </div>
            )}
            {review.workspace.notes.length > 0 && (
              <div className="rounded-xl border border-indigo-100 bg-indigo-50 px-3 py-3 mb-3">
                <div className="text-[11px] uppercase tracking-wide text-indigo-700 font-semibold mb-1">Join Notes</div>
                <ul className="space-y-1 text-sm text-indigo-900 list-disc pl-5">
                  {review.workspace.notes.map((note, index) => (
                    <li key={index}>{note}</li>
                  ))}
                </ul>
              </div>
            )}
            {review.workspace.previewTable && renderResultTable(review.workspace.previewTable)}
          </div>
        )}

        {review.protocol && (
          <div className="rounded-2xl border border-slate-200 p-4 bg-white">
            <div className="text-xs uppercase tracking-wide text-slate-500 font-semibold mb-3">Protocol Or SAP Extraction</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm mb-3">
              <div className="rounded-xl bg-slate-50 border border-slate-200 px-3 py-3">
                <div className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">Document</div>
                <div className="mt-1 font-medium text-slate-800 break-words">{review.protocol.documentName}</div>
              </div>
              <div className="rounded-xl bg-slate-50 border border-slate-200 px-3 py-3">
                <div className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">Extracted Items</div>
                <div className="mt-1 font-medium text-slate-800">{review.protocol.extractedPlanCount}</div>
              </div>
            </div>
            {review.protocol.notes.length > 0 && (
              <div className="rounded-xl border border-indigo-100 bg-indigo-50 px-3 py-3 mb-3">
                <div className="text-[11px] uppercase tracking-wide text-indigo-700 font-semibold mb-1">Extraction Notes</div>
                <ul className="space-y-1 text-sm text-indigo-900 list-disc pl-5">
                  {review.protocol.notes.map((note, index) => (
                    <li key={index}>{note}</li>
                  ))}
                </ul>
              </div>
            )}
            {review.protocol.planItems.length > 0 && (
              <div className="space-y-2">
                {review.protocol.planItems.map((item, index) => (
                  <div key={`${item.name}-${index}`} className="rounded-xl bg-slate-50 border border-slate-200 px-3 py-3">
                    <div className="text-sm font-semibold text-slate-800">{item.name}</div>
                    <div className="text-xs text-slate-500 mt-1">
                      {item.testType} | {formatVariablesForDisplay(item.var1, item.var2)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="rounded-2xl border border-slate-200 p-4 bg-white">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div>
              <div className="text-xs uppercase tracking-wide text-slate-500 font-semibold">Planned Analyses</div>
              <div className="text-sm text-slate-500 mt-1">
                {getScopeLabel(review.analysisPlan.scope)} | {getModeLabel(review.analysisPlan.mode)}
              </div>
            </div>
            {review.analysisPlan.multiplicityMethod && (
              <div className="text-[11px] font-semibold uppercase tracking-wide text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-1">
                {review.analysisPlan.multiplicityMethod}
              </div>
            )}
          </div>
          <div className="space-y-2">
            {review.analysisPlan.tasks.map((task, index) => (
              <div key={`${task.question}-${index}`} className="rounded-xl bg-slate-50 border border-slate-200 px-3 py-3">
                <div className="text-sm font-semibold text-slate-800">{task.question}</div>
                <div className="text-xs text-slate-500 mt-1">
                  {task.testType} | {formatVariablesForDisplay(task.var1, task.var2)}
                </div>
                {task.rationale && <div className="text-sm text-slate-600 mt-2">{task.rationale}</div>}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  const runAutopilot = async () => {
    if (!selectedSource) {
      setRunError('Select a source dataset first.');
      return;
    }

    if (experienceMode === 'RUN_CONFIRMED' && confirmedBlockingReason) {
      setRunError(confirmedBlockingReason);
      return;
    }

    if (analysisScope === 'LINKED_WORKSPACE' && selectedSupportingFiles.length === 0) {
      setRunError('Select at least one supporting dataset for linked workspace mode.');
      return;
    }

    if (analysisMode === 'SINGLE' && !analysisQuestion.trim()) {
      setRunError('Enter a plain-language analysis question in Single Question mode.');
      return;
    }

    if (experienceMode !== 'RUN_CONFIRMED' && analysisMode === 'PACK' && enabledHypotheses.length === 0) {
      setRunError('Generate and select at least one proposed hypothesis before running the analysis pack.');
      return;
    }

    setRunError(null);
    runLogRef.current = [];
    setRunLog([]);
    setSelectedRunId(CURRENT_RUN_SENTINEL);
    setSelectedResultId('');
    setStepState(defaultStepState());
    setIsRunning(true);
    setIsEditingRunName(false);

    try {
      let workingFile = selectedSource;
      let transformedFile = selectedSource;
      let analysisFile = selectedSource;
      let mappingSpec: MappingSpec | null = null;
      let resolvedMappingDecisions: ResolvedMappingDecision[] = [];
      let extractedPlanEntries: AnalysisPlanEntry[] = [];
      let extractedPlanNotes: string[] = [];
      let linkedWorkspaceInfo:
        | LinkedWorkspaceBuildResult
        | null = null;
      let qcResultSummary: {
        status: 'PASS' | 'WARN' | 'FAIL' | 'PENDING';
        issueCount: number;
        autoFixableIssueCount: number;
        blockingIssueCount: number;
        autoFixSummary?: string;
      } | null = null;
      const customSynonymList = customSynonyms
        .split(',')
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean);

      updateStep('qc', 'RUNNING', `Checking ${workingFile.name}`);
      appendLog(`Starting quality control on ${workingFile.name}.`);
      const qcResult = await runQualityCheck(workingFile);
      const blockingIssues = qcResult.issues.filter((issue) => issue.severity === 'HIGH' && !isIssueAutoFixable(issue));
      qcResultSummary = {
        status: qcResult.status,
        issueCount: qcResult.issues.length,
        autoFixableIssueCount: qcResult.issues.filter((issue) => isIssueAutoFixable(issue)).length,
        blockingIssueCount: blockingIssues.length,
      };
      if (blockingIssues.length > 0) {
        updateStep('qc', 'FAILED', blockingIssues[0].description);
        updateStep('cleaning', 'SKIPPED', 'Manual remediation required.');
        throw new Error(`Autopilot stopped due to non-auto-fixable issue: ${blockingIssues[0].description}`);
      }
      updateStep('qc', 'DONE', `${qcResult.status} (${qcResult.issues.length} issue(s))`);
      appendLog(`QC finished with status ${qcResult.status}.`);

      const autoFixableIssues = qcResult.issues.filter((issue) => isIssueAutoFixable(issue));
      if (autoFixableIssues.length > 0) {
        updateStep('cleaning', 'RUNNING', `Applying ${autoFixableIssues.length} issue fix(es)`);
        appendLog(`Generating cleaning suggestion for ${autoFixableIssues.length} fixable issue(s).`);
        const suggestion = await generateCleaningSuggestion(workingFile, autoFixableIssues);
        const cleanedContent = await applyCleaning(workingFile, suggestion.code);
        if (!cleanedContent.trim()) {
          updateStep('cleaning', 'FAILED', 'Cleaning returned empty dataset');
          throw new Error('Auto-cleaning removed all records. Review source data.');
        }
        const cleanedQc = await runQualityCheck({ ...workingFile, content: cleanedContent });
        const cleanedFile: ClinicalFile = {
          id: crypto.randomUUID(),
          name: `${baseName(workingFile.name)}_cleaned.csv`,
          type: workingFile.type,
          uploadDate: new Date().toISOString(),
          size: `${(cleanedContent.length / 1024).toFixed(1)} KB`,
          content: cleanedContent,
          qcStatus: cleanedQc.status,
          qcIssues: cleanedQc.issues,
          metadata: { ...(workingFile.metadata || {}), generatedBy: 'AUTOPILOT_CLEANING' },
        };
        onAddFile(cleanedFile);
        onRecordProvenance({
          id: crypto.randomUUID(),
          timestamp: new Date().toISOString(),
          userId: currentUser.name,
          userRole: currentUser.role,
          actionType: ProvenanceType.CLEANING,
          details: `Autopilot cleaned ${workingFile.name}.`,
          inputs: [workingFile.id],
          outputs: [cleanedFile.id],
        });
        workingFile = cleanedFile;
        qcResultSummary.autoFixSummary = `Autopilot applied cleaning to ${autoFixableIssues.length} fixable issue(s) and saved ${cleanedFile.name}.`;
        updateStep('cleaning', 'DONE', `Saved ${cleanedFile.name}`);
        appendLog(`Saved cleaned dataset as ${cleanedFile.name}.`);
      } else {
        updateStep('cleaning', 'SKIPPED', 'No auto-fixable issues detected');
      }

      updateStep('mapping', 'RUNNING', 'Building mapping specification');
      appendLog('Preparing mapping rules.');
      const { headers: sourceColumns } = parseCsv(workingFile.content);
      if (sourceColumns.length === 0) {
        updateStep('mapping', 'FAILED', 'No parsable columns in source dataset');
        throw new Error('Source dataset has no parsable columns for mapping.');
      }

      const parsedReference = selectedReference ? parseReferenceMapping(selectedReference) : null;
      if (selectedReference && !parsedReference) {
        appendLog(`Reference file ${selectedReference.name} could not be parsed. Continuing without it.`);
      } else if (parsedReference) {
        appendLog(`Loaded ${parsedReference.mappings.length} mapping row(s) from reference ${selectedReference?.name}.`);
      }

      let aiSuggestion: MappingSpec['mappings'] = [];
      try {
        const aiSpec = await generateMappingSuggestion(sourceColumns, targetDomain.trim().toUpperCase() || 'DM');
        aiSuggestion = aiSpec.mappings || [];
        appendLog(`AI suggested ${aiSuggestion.length} mapping row(s).`);
      } catch (e: any) {
        appendLog(`AI mapping unavailable (${e?.message || 'unknown'}). Falling back to deterministic identity mapping.`);
      }

      const merged = mergeMappings(sourceColumns, aiSuggestion, parsedReference?.mappings || []);
      resolvedMappingDecisions = merged;
      const nonIdentity = merged.filter((mapping) => normalize(mapping.sourceCol) !== normalize(mapping.targetCol)).length;
      mappingSpec = {
        id: crypto.randomUUID(),
        sourceDomain: deriveSourceDomain(workingFile.name),
        targetDomain: targetDomain.trim().toUpperCase() || parsedReference?.targetDomain || 'DM',
        mappings: merged.map(({ sourceCol, targetCol, transformation }) => ({ sourceCol, targetCol, transformation })),
      };
      onSaveSpec(mappingSpec);
      updateStep('mapping', 'DONE', `${merged.length} columns mapped (${nonIdentity} transformed)`);
      appendLog(`Saved mapping spec ${mappingSpec.sourceDomain} -> ${mappingSpec.targetDomain}.`);

      updateStep('transform', 'RUNNING', 'Generating ETL code and transforming');
      appendLog('Generating ETL script and running deterministic transformation.');
      const etlScript = await generateETLScript(workingFile, mappingSpec);
      const transformedCsv = await runTransformation(workingFile, mappingSpec, etlScript);
      const parsedTransformed = parseCsv(transformedCsv);
      if (parsedTransformed.headers.length === 0 || parsedTransformed.rows.length === 0) {
        updateStep('transform', 'FAILED', 'Transformation produced empty output');
        throw new Error('Transformation produced no usable rows.');
      }
      const standardizedFile: ClinicalFile = {
        id: crypto.randomUUID(),
        name: `sdtm_${mappingSpec.targetDomain.toLowerCase()}_${Date.now()}.csv`,
        type: DataType.STANDARDIZED,
        uploadDate: new Date().toISOString(),
        size: `${(transformedCsv.length / 1024).toFixed(1)} KB`,
        content: transformedCsv,
        metadata: { generatedBy: 'AUTOPILOT_TRANSFORMATION', mappingSpecId: mappingSpec.id },
      };
      onAddFile(standardizedFile);
      onRecordProvenance({
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        userId: currentUser.name,
        userRole: currentUser.role,
        actionType: ProvenanceType.TRANSFORMATION,
        details: `Autopilot transformed ${workingFile.name} using ${mappingSpec.sourceDomain} -> ${mappingSpec.targetDomain}.`,
        inputs: [workingFile.id, mappingSpec.id],
        outputs: [standardizedFile.id],
      });
      transformedFile = standardizedFile;
      analysisFile = standardizedFile;
      updateStep('transform', 'DONE', `${parsedTransformed.rows.length} rows, ${parsedTransformed.headers.length} columns`);
      appendLog(`Standardized dataset saved as ${standardizedFile.name}.`);

      if (analysisScope === 'LINKED_WORKSPACE') {
        updateStep('transform', 'RUNNING', 'Building linked analysis workspace');
        appendLog(`Building linked analysis workspace with ${selectedSupportingFiles.length} supporting dataset(s).`);
        linkedWorkspaceInfo = buildLinkedAnalysisWorkspace(transformedFile, selectedSupportingFiles, customSynonymList);
        if (linkedWorkspaceInfo.sourceNames.length < 2) {
          updateStep('transform', 'FAILED', 'No supporting datasets could be linked by subject');
          throw new Error('Linked workspace mode requires at least one supporting dataset with a shared subject identifier.');
        }

        analysisFile = linkedWorkspaceInfo.workspaceFile;
        onAddFile(analysisFile);
        onRecordProvenance({
          id: crypto.randomUUID(),
          timestamp: new Date().toISOString(),
          userId: currentUser.name,
          userRole: currentUser.role,
          actionType: ProvenanceType.TRANSFORMATION,
          details: `Autopilot built linked workspace ${analysisFile.name} from ${linkedWorkspaceInfo.sourceNames.join(', ')}.`,
          inputs: [transformedFile.id, ...selectedSupportingFiles.map((file) => file.id)],
          outputs: [analysisFile.id],
        });
        linkedWorkspaceInfo.notes.forEach((note) => appendLog(note));
        updateStep(
          'transform',
          'DONE',
          `Linked workspace: ${linkedWorkspaceInfo.sourceNames.length} datasets, ${parseCsv(analysisFile.content).rows.length} subjects`
        );
        appendLog(`Linked workspace saved as ${analysisFile.name}.`);
      }

      if (analysisMode === 'PACK' && selectedProtocol) {
        updateStep('plan', 'RUNNING', `Extracting analysis plan from ${selectedProtocol.name}`);
        appendLog(`Extracting pre-specified analysis from ${selectedProtocol.name}.`);
        const extracted = await extractPreSpecifiedAnalysisPlan(selectedProtocol, analysisFile);
        extractedPlanEntries = extracted.plan;
        extractedPlanNotes = extracted.notes;
        updateStep(
          'plan',
          'DONE',
          extracted.plan.length > 0
            ? `Extracted ${extracted.plan.length} plan item(s)`
            : 'No explicit plan item matched dataset columns'
        );
        if (extracted.notes.length > 0) {
          appendLog(`Plan notes: ${extracted.notes.join(' | ')}`);
        }
        if (experienceMode === 'RUN_CONFIRMED' && extracted.plan.length === 0) {
          updateStep('plan', 'FAILED', 'No extractable pre-specified analysis matched this dataset');
          throw new Error(
            'Run Confirmed requires at least one extractable pre-specified analysis item from the selected Protocol/SAP.'
          );
        }
      } else {
        if (analysisMode === 'PACK' && experienceMode !== 'RUN_CONFIRMED') {
          updateStep('plan', 'DONE', `${enabledHypotheses.length} reviewed hypothesis${enabledHypotheses.length === 1 ? '' : 'es'} selected`);
        } else {
          updateStep('plan', 'SKIPPED', analysisMode === 'SINGLE' ? 'Single Question mode selected' : 'No Protocol/SAP selected');
        }
      }

      updateStep('analysis', 'RUNNING', 'Selecting clinically meaningful analyses');
      const rawLinkedSourceFiles =
        analysisScope === 'LINKED_WORKSPACE'
          ? [workingFile, ...selectedSupportingFiles]
          : [analysisFile];
      const recommendedLinkedExecutionFiles =
        analysisScope === 'LINKED_WORKSPACE' &&
        analysisMode === 'SINGLE' &&
        shouldPreferBackendPlanning(activeAutopilotPrompt, analysisScope) &&
        recommendedExecutionFiles.length > 0
          ? recommendedExecutionFiles
          : null;
      const getPlanningSourceFilesForQuestion = (question: string) =>
        analysisScope === 'LINKED_WORKSPACE' && shouldPreferBackendPlanning(question, analysisScope)
          ? rawLinkedSourceFiles
          : analysisScope === 'LINKED_WORKSPACE'
            ? [transformedFile, ...selectedSupportingFiles]
            : [analysisFile];
      const createdSessions: AnalysisSession[] = [];
      const rejectedAnalyses: string[] = [];
      const contextDocs = selectedProtocol ? [selectedProtocol] : [];
      let tasks: PlannedAutopilotTask[] = [];
      if (analysisMode === 'PACK' && experienceMode !== 'RUN_CONFIRMED') {
        for (const hypothesis of enabledHypotheses) {
          try {
            const plannedTask = await buildQuestionTask(
              analysisFile,
              hypothesis.question,
              customSynonymList,
              getPlanningSourceFilesForQuestion(hypothesis.question),
              analysisScope
            );
            tasks.push({
              ...plannedTask,
              id: hypothesis.id,
              rationale: hypothesis.rationale || plannedTask.rationale,
            });
          } catch (e: any) {
            const message = e?.message || 'Unknown planning error';
            appendLog(`Skipped hypothesis planning: ${message}`);
            rejectedAnalyses.push(message);
          }
        }
      } else if (analysisMode === 'PACK' && extractedPlanEntries.length > 0) {
        tasks = planEntriesToTasks(extractedPlanEntries);
      } else if (analysisMode === 'SINGLE') {
        tasks = [
          await buildQuestionTask(
            analysisFile,
            analysisQuestion,
            customSynonymList,
            getPlanningSourceFilesForQuestion(analysisQuestion),
            analysisScope
          ),
        ];
      } else if (analysisScope === 'LINKED_WORKSPACE') {
        tasks = buildExploratorySignalTasks(analysisFile);
      } else {
        tasks = buildAutopilotAnalysisSuite(analysisFile, customSynonymList);
      }

      if (tasks.length === 0) {
        updateStep('analysis', 'FAILED', 'No valid analyses could be planned');
        throw new Error('Autopilot could not derive any useful analyses from the selected dataset.');
      }

      appendLog(`Prepared ${tasks.length} clinically relevant analysis question(s).`);
      const usageModeForRun = experienceMode === 'RUN_CONFIRMED' ? UsageMode.OFFICIAL : UsageMode.EXPLORATORY;
      const runId = crypto.randomUUID();
      const runName = buildDefaultRunName(
        analysisMode,
        selectedSource.name,
        experienceMode === 'RUN_CONFIRMED',
        analysisMode === 'SINGLE' ? analysisQuestion : undefined,
        analysisScope,
        analysisScope === 'LINKED_WORKSPACE' ? linkedWorkspaceInfo?.sourceNames.length || 1 : 1
      );
      for (let index = 0; index < tasks.length; index += 1) {
        const task = tasks[index];
        appendLog(`Running analysis ${index + 1}/${tasks.length}: ${task.question}`);
        try {
          const generatedCode = await generateStatisticalCode(
            analysisFile,
            task.testType,
            task.var1,
            task.var2,
            contextDocs,
            task.covariates || [],
            task.imputationMethod || 'None',
            Boolean(task.applyPSM)
          );

          let sasCode = '';
          if (generateSasDraft) {
            sasCode = await generateSASCode(
              analysisFile,
              task.testType,
              task.var1,
              task.var2,
              generatedCode,
              task.covariates || [],
              task.imputationMethod || 'None',
              Boolean(task.applyPSM)
            );
          }

          const executionSourceFiles =
            analysisScope === 'LINKED_WORKSPACE' && task.backendPlannedFamily
              ? recommendedLinkedExecutionFiles || rawLinkedSourceFiles
              : analysisScope === 'LINKED_WORKSPACE'
                ? [transformedFile, ...selectedSupportingFiles]
                : [analysisFile];
          if (analysisScope === 'LINKED_WORKSPACE' && task.backendPlannedFamily) {
            appendLog(
              'Using cleaned source datasets directly for backend execution because this question needs row-level analysis rather than the linked workspace summary.'
            );
            if (recommendedLinkedExecutionFiles && recommendedLinkedExecutionFiles.length > 0) {
              appendLog(
                `Using the recommended dataset subset for this question: ${recommendedLinkedExecutionFiles
                  .map((file) => file.name)
                  .join(', ')}.`
              );
            }
          }

          const result = await executeStatisticalCode(
            generatedCode,
            analysisFile,
            task.testType,
            task.var1,
            task.var2,
            task.concept || null,
            {
              question: task.question,
              sourceFiles: executionSourceFiles,
              covariates: task.covariates || [],
              imputationMethod: task.imputationMethod,
              applyPSM: Boolean(task.applyPSM),
              backendSpec: task.backendSpec || null,
            }
          );
          if (task.backendPlannedFamily) {
            const executedFamily = result.backendExecution?.analysisFamily || null;
            if (!backendFamiliesAreCompatible(task.backendPlannedFamily, executedFamily)) {
              const plannedFamilyLabel = humanizeBackendFamily(task.backendPlannedFamily) || task.backendPlannedFamily;
              const executedFamilyLabel = humanizeBackendFamily(executedFamily) || executedFamily || 'local fallback';
              const mismatchMessage = `Planned ${plannedFamilyLabel}, but the executed result was ${executedFamilyLabel}. Autopilot will not save a mismatched run.`;
              appendLog(`Rejected analysis ${index + 1}: ${mismatchMessage}`);
              rejectedAnalyses.push(mismatchMessage);
              continue;
            }
          }
          const questionMatch = assessAutopilotQuestionMatch(task.question, result, {
            analysisScope,
            analysisMode,
            testType: task.testType,
            var1: task.var1,
            var2: task.var2,
          });
          const allowPartialExploratoryAnswer = experienceMode !== 'RUN_CONFIRMED' && questionMatch.status === 'FAILED';
          const effectiveQuestionMatch =
            allowPartialExploratoryAnswer && questionMatch.status === 'FAILED'
              ? {
                  status: 'PARTIAL' as const,
                  summary:
                    analysisMode === 'SINGLE'
                      ? `Partial exploratory answer only. ${questionMatch.details[0] || 'This run only partially answered the requested question.'}`
                      : 'Partial exploratory answer only. This saved result is informative but does not fully answer the requested question.',
                  details: questionMatch.details,
                }
              : questionMatch;
          if (questionMatch.status === 'FAILED' && !allowPartialExploratoryAnswer) {
            appendLog(`Rejected analysis ${index + 1}: ${questionMatch.summary}`);
            questionMatch.details.forEach((detail) => appendLog(`  - ${detail}`));
            rejectedAnalyses.push(
              questionMatch.details.length > 0
                ? `${questionMatch.summary} ${questionMatch.details[0]}`
                : questionMatch.summary
            );
            continue;
          }
          if (effectiveQuestionMatch.status === 'PARTIAL') {
            appendLog(`Saved analysis ${index + 1} as a partial exploratory answer.`);
            effectiveQuestionMatch.details.forEach((detail) => appendLog(`  - ${detail}`));
          }
          const enrichedResult: StatAnalysisResult = { ...result, sasCode: sasCode || undefined };

          createdSessions.push({
            id: crypto.randomUUID(),
            timestamp: new Date().toISOString(),
            name: `Autopilot - ${task.label}`,
            usageMode: usageModeForRun,
            params: {
              fileId: analysisFile.id,
              fileName: analysisFile.name,
              testType: task.testType,
              var1: task.var1,
              var2: task.var2,
              covariates: task.covariates,
              imputationMethod: task.imputationMethod,
              applyPSM: task.applyPSM,
              concept: task.concept || null,
              contextDocIds: contextDocs.map((doc) => doc.id),
              selectedPlanDocId: selectedProtocol?.id || null,
              preSpecifiedPlan: extractedPlanEntries,
              preSpecifiedPlanNotes: extractedPlanNotes,
              enforcePreSpecifiedPlan: usageModeForRun === UsageMode.OFFICIAL && extractedPlanEntries.length > 0,
              sourceWorkflow: 'AUTOPILOT',
              preSpecifiedPlanId: extractedPlanEntries[index]?.id || null,
              autopilotRunId: runId,
              autopilotRunName: runName,
              autopilotMode: analysisMode,
              autopilotSourceName: selectedSource.name,
              autopilotSourceNames:
                analysisScope === 'LINKED_WORKSPACE'
                  ? linkedWorkspaceInfo?.sourceNames || [selectedSource.name]
                  : [selectedSource.name],
              autopilotQuestion: task.question,
              autopilotResultIndex: index,
              autopilotDataScope: analysisScope,
              autopilotWorkspaceFileId: analysisScope === 'LINKED_WORKSPACE' ? analysisFile.id : null,
              autopilotWorkspaceFileName: analysisScope === 'LINKED_WORKSPACE' ? analysisFile.name : null,
              backendAnalysisFamily: result.backendExecution?.analysisFamily || null,
              backendWorkspaceId: result.backendExecution?.workspaceId || null,
              backendSourceNames: result.backendExecution?.sourceNames || null,
              autopilotQuestionMatchStatus: effectiveQuestionMatch.status,
              autopilotQuestionMatchSummary: effectiveQuestionMatch.summary,
              autopilotQuestionMatchDetails: effectiveQuestionMatch.details,
            },
            ...enrichedResult,
          });
        } catch (e: any) {
          appendLog(`Skipped analysis ${index + 1}: ${e?.message || 'Unknown execution error'}`);
        }
      }

      if (createdSessions.length === 0) {
        updateStep('analysis', 'FAILED', 'All planned analyses failed');
        throw new Error(
          analysisMode === 'SINGLE'
            ? rejectedAnalyses.length > 0
              ? `Autopilot could not produce a valid answer for this question. ${rejectedAnalyses[0]}`
              : 'Autopilot could not execute an analysis that actually matched the requested question. Refine the question or use datasets that support the requested endpoint and estimands.'
            : 'Autopilot could not complete any planned analysis successfully.'
        );
      }

      const reviewBundle: AutopilotReviewBundle = {
        workflow: {
          usageMode: usageModeForRun,
          rationale:
            usageModeForRun === UsageMode.OFFICIAL
              ? `Autopilot classified this run as Run Confirmed because it was executed in protocol-driven analysis-pack mode with ${extractedPlanEntries.length} extracted plan item(s).`
              : analysisScope === 'LINKED_WORKSPACE'
              ? 'Autopilot classified this run as Explore Fast because linked-workspace signal search is hypothesis-generating and may surface cross-domain associations that require follow-up.'
              : 'Autopilot classified this run as Explore Fast because it was generated from dataset structure or a free-text question rather than a locked pre-specified analysis plan.',
          guardrails:
            usageModeForRun === UsageMode.OFFICIAL
              ? [
                  'Treat extracted Protocol/SAP items as reviewed execution instructions and document any deviation before using this run externally.',
                  'Promote these saved sessions into Statistical Analysis when you need final sign-off or downstream reporting.',
                ]
              : [
                  'Explore Fast results are hypothesis-generating and should be validated before external reporting.',
                  analysisScope === 'LINKED_WORKSPACE'
                    ? 'Multiple cross-domain hypotheses can inflate false positives; adjusted p-values are shown where applicable.'
                    : 'Single-dataset exploratory findings should be promoted into Statistical Analysis for controlled reruns when needed.',
                ],
        },
        qc: {
          sourceFileName: selectedSource.name,
          status: qcResultSummary?.status || 'PENDING',
          issueCount: qcResultSummary?.issueCount || 0,
          autoFixableIssueCount: qcResultSummary?.autoFixableIssueCount || 0,
          blockingIssueCount: qcResultSummary?.blockingIssueCount || 0,
          autoFixSummary: qcResultSummary?.autoFixSummary,
        },
        mapping: mappingSpec
          ? {
              sourceDomain: mappingSpec.sourceDomain,
              targetDomain: mappingSpec.targetDomain,
              mappedColumnCount: resolvedMappingDecisions.length,
              transformedColumnCount: resolvedMappingDecisions.filter(
                (mapping) => normalize(mapping.sourceCol) !== normalize(mapping.targetCol)
              ).length,
              decisions: resolvedMappingDecisions,
            }
          : undefined,
        protocol: selectedProtocol
          ? {
              documentName: selectedProtocol.name,
              extractedPlanCount: extractedPlanEntries.length,
              notes:
                extractedPlanNotes.length > 0
                  ? extractedPlanNotes
                  : extractedPlanEntries.length > 0
                  ? [`Applied ${extractedPlanEntries.length} extracted plan item(s).`]
                  : ['No protocol/SAP analysis item could be matched to dataset columns.'],
              planItems: extractedPlanEntries.map((entry) => ({
                name: entry.name,
                testType: entry.testType,
                var1: entry.var1,
                var2: entry.var2,
              })),
            }
          : undefined,
        workspace: linkedWorkspaceInfo
          ? {
              joinKey: linkedWorkspaceInfo.joinKey,
              sourceNames: linkedWorkspaceInfo.sourceNames,
              skippedFiles: linkedWorkspaceInfo.skippedFiles,
              rowCount: linkedWorkspaceInfo.rowCount,
              columnCount: linkedWorkspaceInfo.columnCount,
              derivedColumns: linkedWorkspaceInfo.derivedColumns,
              notes: linkedWorkspaceInfo.notes,
              previewTable: linkedWorkspaceInfo.previewTable,
            }
          : undefined,
        analysisPlan: {
          mode: analysisMode,
          scope: analysisScope,
          multiplicityMethod: analysisScope === 'LINKED_WORKSPACE' && createdSessions.length > 1 ? 'Benjamini-Hochberg FDR' : undefined,
          tasks: tasks.map((task) => ({
            question: task.question,
            testType: task.testType,
            var1: task.var1,
            var2: task.var2,
            rationale: task.rationale,
          })),
        },
      };

      const adjustedSessions =
        analysisScope === 'LINKED_WORKSPACE' && createdSessions.length > 1
          ? applyBenjaminiHochbergAdjustments(createdSessions)
          : createdSessions;

      updateStep('analysis', 'DONE', `${createdSessions.length} of ${tasks.length} analyses completed`);
      if (analysisScope === 'LINKED_WORKSPACE' && createdSessions.some((session) => session.metrics.adjusted_p_value)) {
        appendLog('Applied Benjamini-Hochberg FDR adjustment across exploratory linked-workspace results.');
      }
      appendLog(`Autopilot completed successfully. ${createdSessions.length} analysis session(s) saved.`);
      const persistedExecutionLog = [...runLogRef.current];

      const finalSessions = await Promise.all(
        adjustedSessions.map(async (session) => ({
          ...session,
          params: {
            ...session.params,
            autopilotReview: reviewBundle,
            autopilotExecutionLog: persistedExecutionLog,
          },
          aiCommentary: await generateClinicalCommentary(session, {
            question: session.params.autopilotQuestion || '',
            dataScope: analysisScope,
            sourceNames:
              analysisScope === 'LINKED_WORKSPACE'
                ? linkedWorkspaceInfo?.sourceNames || [selectedSource.name]
                : [selectedSource.name],
            sourceDatasetName: selectedSource.name,
            var1: session.params.var1,
            var2: session.params.var2,
            testType: session.params.testType,
          }),
        }))
      );

      setSessions((prev) => [...finalSessions.slice().reverse(), ...prev]);
      setActiveSessionId(finalSessions[0].id);
      setSelectedRunId(runId);
      setSelectedResultId(finalSessions[0].id);
      setResultDetailView('CHART');
      setRunNameDraft(runName);
      setIsCreatingNewAnalysis(false);

      onRecordProvenance({
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        userId: currentUser.name,
        userRole: currentUser.role,
        actionType: ProvenanceType.STATISTICS,
        details: `Autopilot ran ${finalSessions.length} analysis(es) on ${analysisFile.name}${analysisScope === 'LINKED_WORKSPACE' ? ' using a linked workspace' : ''}.`,
        inputs: [
          selectedSource.id,
          analysisFile.id,
          ...(analysisScope === 'LINKED_WORKSPACE' ? selectedSupportingFiles.map((file) => file.id) : []),
          ...(selectedProtocol ? [selectedProtocol.id] : []),
          ...(selectedReference ? [selectedReference.id] : []),
        ],
        outputs: finalSessions.map((session) => session.id),
      });

    } catch (e: any) {
      const message = e?.message || 'Autopilot failed.';
      appendLog(`ERROR: ${message}`);
      setRunError(message);
      setShowWorkflowPanels(true);
    } finally {
      setIsRunning(false);
    }
  };

  const hasAutopilotSessions = sessions.some((session) => session.params.autopilotRunId);
  const reviewMode = Boolean(selectedRun || isRunning || runError || hasAutopilotSessions);
  const logHeightClass = reviewMode ? 'h-40' : 'h-56';
  const showControlPanels =
    !reviewMode || isCreatingNewAnalysis || isRunning || Boolean(runError) || showWorkflowPanels;

  const runBrowserSection = (
      <AutopilotRunBrowser
        runs={autopilotRuns}
        selectedRunId={selectedRun?.runId ?? null}
        showWorkflowPanels={showWorkflowPanels}
        isCreatingNewAnalysis={isCreatingNewAnalysis}
      isRunning={isRunning}
      formatTimestamp={formatTimestamp}
      onSelectRun={(runId) => {
        setSelectedRunId(runId);
        setSelectedResultId('');
        setIsCreatingNewAnalysis(false);
      }}
        onToggleWorkflowPanels={() => setShowWorkflowPanels((prev) => !prev)}
        onStartNewAnalysis={startNewAnalysis}
        onCloseNewAnalysis={closeNewAnalysis}
        onDeleteRun={handleDeleteRun}
      />
  );

  const controlPanels = (
    <div className="space-y-6">
      <UiErrorBoundary title="Planning Panel Error">
        <AutopilotPlanningHero
          analysisMode={analysisMode}
          analysisQuestion={analysisQuestion}
          defaultQuestion={buildDefaultQuestion()}
          packFocusQuestion={packFocusQuestion}
          activeAutopilotPrompt={activeAutopilotPrompt}
          sourceFilesCount={sourceFiles.length}
          autopilotRecommendation={autopilotRecommendation}
          recommendedSupportingFiles={recommendedSupportingFiles}
          planningAssist={planningAssist}
          planningAssistError={planningAssistError}
          isPlanningAssistLoading={isPlanningAssistLoading}
          backendPlanningPreflight={backendPlanningPreflight}
          roleLabels={AUTOPILOT_ROLE_LABELS}
          recommendationConfidenceClass={recommendationConfidenceClass}
          recommendationSupportStatusClass={recommendationSupportStatusClass}
          recommendationSupportCheckClass={recommendationSupportCheckClass}
          onSetAnalysisQuestion={setAnalysisQuestion}
          onSetPackFocusQuestion={setPackFocusQuestion}
          onApplyRecommendedAutopilotFiles={applyRecommendedAutopilotFiles}
          onGeneratePlanningAssist={handleGeneratePlanningAssist}
        />
      </UiErrorBoundary>

      <div className="grid grid-cols-1 xl:grid-cols-[320px_minmax(0,1fr)] 2xl:grid-cols-[340px_minmax(0,1fr)] gap-6 items-start">
        <AutopilotControlPanel
          experienceMode={experienceMode}
          analysisScope={analysisScope}
          analysisMode={analysisMode}
          runMode={runMode}
          selectedProtocol={selectedProtocol}
          confirmedBlockingReason={confirmedBlockingReason}
          proposedHypotheses={proposedHypotheses}
          enabledHypothesesCount={enabledHypotheses.length}
          hypothesisGenerationBlockingReason={hypothesisGenerationBlockingReason}
          hypothesisGenerationError={hypothesisGenerationError}
          backendPlanningBlockingReason={backendPlanningBlockingReason}
          sourceFiles={sourceFiles}
          selectedSourceId={selectedSourceId}
          recommendedSourceFile={recommendedSourceFile}
          supportingSourceFiles={supportingSourceFiles}
          selectedSupportingIds={selectedSupportingIds}
          referenceFiles={referenceFiles}
          selectedReferenceId={selectedReferenceId}
          protocolFiles={protocolFiles}
          selectedProtocolId={selectedProtocolId}
          selectedTargetDomainOption={selectedTargetDomainOption}
          targetDomain={targetDomain}
          suggestedTargetDomain={suggestedTargetDomain}
          customSynonyms={customSynonyms}
          generateSasDraft={generateSasDraft}
          isRunning={isRunning}
          runDisabled={
            isRunning ||
            !selectedSource ||
            (analysisScope === 'LINKED_WORKSPACE' && selectedSupportingFiles.length === 0) ||
            (analysisMode === 'PACK' && experienceMode !== 'RUN_CONFIRMED' && enabledHypotheses.length === 0) ||
            Boolean(confirmedBlockingReason) ||
            Boolean(backendPlanningBlockingReason)
          }
          targetDomainOptions={TARGET_DOMAIN_OPTIONS}
          customTargetDomainValue={CUSTOM_TARGET_DOMAIN_VALUE}
          formatVariablesForDisplay={formatVariablesForDisplay}
          onSetExperienceMode={setExperienceMode}
          onSetAnalysisScope={setAnalysisScope}
          onSetAnalysisMode={setAnalysisMode}
          onGeneratePackHypotheses={generatePackHypotheses}
          onToggleHypothesisEnabled={toggleHypothesisEnabled}
          onUpdateHypothesisQuestion={updateHypothesisQuestion}
          onSetSelectedSourceId={setSelectedSourceId}
          onSelectAllSupportingFiles={selectAllSupportingFiles}
          onClearSupportingFiles={clearSupportingFiles}
          onToggleSupportingFile={toggleSupportingFile}
          onSetSelectedReferenceId={setSelectedReferenceId}
          onSetSelectedProtocolId={setSelectedProtocolId}
          onSetTargetDomain={setTargetDomain}
          onSetCustomSynonyms={setCustomSynonyms}
          onSetGenerateSasDraft={setGenerateSasDraft}
          onRunAutopilot={runAutopilot}
        />

        <UiErrorBoundary title="Workflow Panel Error">
          <AutopilotWorkflowPanel
            steps={STEP_ORDER.map((step) => ({
              key: step.key,
              label: step.label,
              status: displayedStepState[step.key].status,
              detail: displayedStepState[step.key].detail,
            }))}
            reviewMode={reviewMode}
            runError={runError}
            failureLogPreview={failureLogPreview}
            displayedRunLog={displayedRunLog}
            logHeightClass={logHeightClass}
          />
        </UiErrorBoundary>
      </div>
    </div>
  );

  const workspaceSection = (
    <AutopilotWorkspaceSection
      sessionCount={sessions.filter((session) => session.params.autopilotRunId).length}
      selectedRun={selectedRun ?? null}
      selectedRunResults={selectedRunResults}
      selectedResult={selectedResult ?? null}
      selectedResultId={selectedResultId}
      isEditingRunName={isEditingRunName}
      runNameDraft={runNameDraft}
      renameError={renameError}
      isRunning={isRunning}
      runError={runError}
      resultDetailView={resultDetailView}
      activeResultTable={activeResultTable}
      activeReview={activeReview}
      detailContent={
        selectedResult && resultDetailView === 'CHART' ? (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 min-w-0">
            <Chart
              data={selectedResult.chartConfig.data}
              layout={selectedResult.chartConfig.layout}
              className="h-[36rem] min-h-[36rem] 2xl:h-[40rem] 2xl:min-h-[40rem]"
            />
          </div>
        ) : (
          renderResultTable(activeResultTable)
        )
      }
      formatTimestamp={formatTimestamp}
      sessionCardTitle={sessionCardTitle}
      sessionAnalysisLabel={sessionAnalysisLabel}
      sessionVariableSummary={sessionVariableSummary}
      getWorkflowBadgeClass={getWorkflowBadgeClass}
      getWorkflowLabel={getWorkflowLabel}
      getQuestionMatchBadgeClass={getQuestionMatchBadgeClass}
      formatMetricLabel={formatMetricLabel}
      getScopeLabel={getScopeLabel}
      renderDecisionReview={renderDecisionReview}
      onSelectResult={(sessionId) => {
        setSelectedResultId(sessionId);
        setResultDetailView('CHART');
      }}
      onSetRunNameDraft={setRunNameDraft}
      onStartEditingRunName={() => setIsEditingRunName(true)}
      onCancelEditingRunName={() => {
        if (selectedRun) {
          setRunNameDraft(selectedRun.runName);
        }
        setIsEditingRunName(false);
        setRenameError(null);
      }}
      onSaveRunName={handleSaveRunName}
      onSetResultDetailView={setResultDetailView}
      onExportSelectedResult={handleExportSelectedResult}
      onExportRun={handleExportRun}
      onOpenStatistics={() => selectedResult && onOpenStatistics(selectedResult.id)}
    />
  );

  return (
    <div className="p-8 h-full overflow-y-auto bg-slate-50">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-slate-800 flex items-center">
          <Bot className="w-6 h-6 mr-3 text-indigo-600" />
          AI Autopilot
        </h2>
        <p className="text-slate-500">
          Use Explore Fast for low-friction signal finding. Use Run Confirmed when you need a protocol-driven pack with tighter execution guardrails.
        </p>
      </div>

      <div className="space-y-6">
        {reviewMode ? (
          <>
            {runBrowserSection}
            {!isCreatingNewAnalysis && workspaceSection}
            {showControlPanels && controlPanels}
          </>
        ) : (
          <>
            {controlPanels}
            {workspaceSection}
          </>
        )}
      </div>
    </div>
  );
};
