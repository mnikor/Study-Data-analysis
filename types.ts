
export enum DataType {
  RAW = 'RAW',
  MAPPING = 'MAPPING',
  STANDARDIZED = 'STANDARDIZED',
  DOCUMENT = 'DOCUMENT',
  COHORT_DEF = 'COHORT_DEF' // New: Saved RWE Cohort logic
}

export enum StudyType {
  RCT = 'RCT', // Randomized Controlled Trial (Blinded, Strict)
  RWE = 'RWE'  // Real World Evidence (Retrospective, Cohort-based)
}

export enum AnalysisMode {
  RAG = 'RAG',
  STUFFING = 'STUFFING',
  AGENT = 'AGENT'
}

export enum UsageMode {
  EXPLORATORY = 'EXPLORATORY', // Sandbox, internal use
  OFFICIAL = 'OFFICIAL',       // GxP, Pre-specified in SAP
  POST_HOC = 'POST_HOC'        // Retrospective, requires disclaimer
}

export enum ProvenanceType {
  INGESTION = 'INGESTION',
  MAPPING_SPEC = 'MAPPING_SPEC',
  TRANSFORMATION = 'TRANSFORMATION',
  ANALYSIS = 'ANALYSIS',
  STATISTICS = 'STATISTICS',
  CLEANING = 'CLEANING',
  BIAS_AUDIT = 'BIAS_AUDIT',
  DELETION = 'DELETION',       // High Risk: Removing Official Data
  SANDBOX_DISCARD = 'DISCARD', // Low Risk: Removing Exploratory Data
  COHORT_CREATION = 'COHORT_CREATION' // New: RWE specific
}

export enum StatTestType {
  T_TEST = 'T-Test',
  CHI_SQUARE = 'Chi-Square',
  ANOVA = 'ANOVA',
  REGRESSION = 'Linear Regression',
  CORRELATION = 'Correlation Analysis',
  KAPLAN_MEIER = 'Kaplan-Meier / Log-Rank',
  COX_PH = 'Cox Proportional Hazards'
}

export enum StatAnalysisStep {
  CONFIGURATION = 'CONFIGURATION',
  CODE_REVIEW = 'CODE_REVIEW',
  RESULTS = 'RESULTS'
}

export enum UserRole {
  ADMIN = 'ADMIN',
  PROGRAMMER = 'PROGRAMMER',
  STATISTICIAN = 'STATISTICIAN',
  MEDICAL_MONITOR = 'MEDICAL_MONITOR',
  AUDITOR = 'AUDITOR'
}

export interface Project {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  ownerId: string;
  studyType: StudyType;
  files: ClinicalFile[];
  provenance: ProvenanceRecord[];
  mappingSpecs: MappingSpec[];
  chatMessages: ChatMessage[];
  statSessions: AnalysisSession[];
}

export interface User {
  id: string;
  name: string;
  role: UserRole;
  avatar?: string;
  accessLabel?: string;
  authProvider?: 'POC' | 'SSO';
}

export type QCStatus = 'PASS' | 'WARN' | 'FAIL' | 'PENDING';

export interface QCIssue {
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  description: string;
  affectedRows?: string; // e.g. "Row 4, 10" or "Column 'AGE'"
  autoFixable?: boolean;
  remediationHint?: string;
}

export interface CleaningSuggestion {
  explanation: string;
  code: string;
}

export interface ClinicalFile {
  id: string;
  name: string;
  type: DataType;
  uploadDate: string;
  size: string;
  content?: string; // Simulated content for demo
  metadata?: Record<string, any>;
  qcStatus?: QCStatus;
  qcIssues?: QCIssue[];
  studyId?: string;
  studyName?: string;
  source?: 'LOCAL' | 'DATALAKE';
}

export interface MappingSpec {
  id: string;
  sourceDomain: string;
  targetDomain: string;
  mappings: { sourceCol: string; targetCol: string; transformation?: string }[];
}

// RWE Specific Types
export interface CohortFilter {
  id: string;
  field: string;
  operator: 'EQUALS' | 'NOT_EQUALS' | 'GREATER_THAN' | 'LESS_THAN' | 'GREATER_OR_EQUAL' | 'LESS_OR_EQUAL' | 'CONTAINS';
  value: string;
  description: string;
}

export interface AttritionStep {
  stepName: string;
  inputCount: number;
  excludedCount: number;
  remainingCount: number;
  reason: string;
}

export interface TransformationRun {
  id: string;
  timestamp: string;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  step: string;
  logs: string[];
}

export interface ProvenanceRecord {
  id: string;
  timestamp: string;
  userId: string;
  userRole?: string;
  actionType: ProvenanceType;
  details: string;
  inputs: string[]; // IDs of input files
  outputs?: string[];
  model?: string;
  signature?: string; // Digital signature (e.g., "Signed by John Doe")
  hash?: string; // SHA-256 hash of the record for tamper evidence
}

export interface ChartConfiguration {
  data: any[];
  layout: any;
}

export interface ResultTable {
  title?: string;
  columns: string[];
  rows: Array<Record<string, string | number>>;
}

export interface ResponseModeBadge {
  label: string;
  tone: 'summary' | 'deterministic' | 'blocked' | 'fallback';
  detail?: string;
  autoRouted?: boolean;
}

export interface AnalysisResponse {
  answer: string;
  chartConfig?: ChartConfiguration;
  tableConfig?: ResultTable;
  keyInsights?: string[];
  citations?: { sourceId: string; snippet: string }[];
  agentRun?: AnalysisAgentRun;
  responseModeBadge?: ResponseModeBadge;
}

export interface AnalysisAgentStep {
  id: string;
  title: string;
  status: 'completed' | 'failed' | 'skipped';
  summary: string;
  details: string[];
  code?: string | null;
  chart?: ChartConfiguration;
  table?: ResultTable | null;
  provenance?: {
    sourceNames: string[];
    columnsUsed: string[];
    derivedColumns: string[];
    cohortFiltersApplied: string[];
    joinKeys: string[];
    note?: string | null;
  } | null;
}

export interface AnalysisAgentUserSummary {
  bottomLine: string;
  evidencePoints: string[];
  potentialHypotheses: string[];
  recommendedFollowUp: string[];
  limitations: string[];
  nextStep?: string | null;
  contextNote?: string | null;
}

export interface AnalysisAgentPlanBrief {
  analysisFamily:
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
  targetDefinition?: string | null;
  endpointLabel?: string | null;
  treatmentVariable?: string | null;
  subgroupFactors: string[];
  requiredRoles: string[];
  missingRoles: string[];
  selectedSources: string[];
  selectedRoles: Record<string, string>;
  timeWindowDays?: number | null;
  gradeThreshold?: number | null;
  termFilters: string[];
  cohortFilters: string[];
  interactionTerms: string[];
  requestedOutputs: string[];
  notes: string[];
  assessment?: {
    supportLevel: 'supported' | 'partial' | 'unsupported';
    blockerStage: 'none' | 'selection' | 'planner' | 'data' | 'method';
    blockerReason?: string | null;
    recommendedNextStep?: string | null;
    fallbackOption?: string | null;
    dataRequirements: string[];
    methodConstraints: string[];
  } | null;
}

export interface AnalysisAgentRun {
  runId: string;
  question: string;
  createdAt?: string | null;
  status: 'executable' | 'missing_data' | 'unsupported';
  missingRoles: string[];
  executed: boolean;
  analysisFamily:
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
  selectedSources: string[];
  selectedRoles: Record<string, string>;
  workspaceId?: string | null;
  steps: AnalysisAgentStep[];
  userSummary?: AnalysisAgentUserSummary | null;
  warnings: string[];
}

export interface AnalysisAgentRunSummary {
  runId: string;
  question: string;
  createdAt?: string | null;
  status: 'executable' | 'missing_data' | 'unsupported';
  missingRoles: string[];
  executed: boolean;
  analysisFamily:
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
  selectedSources: string[];
}

export interface StatAnalysisResult {
  metrics: Record<string, string | number>;
  interpretation: string;
  chartConfig: ChartConfiguration;
  tableConfig?: ResultTable;
  executedCode: string;
  sasCode?: string; // NEW: Stores generated SAS code
  backendExecution?: {
    engine: 'FASTAPI';
    analysisFamily:
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
    workspaceId?: string | null;
    sourceNames?: string[];
    receipt?: {
      sourceNames: string[];
      derivedColumns: string[];
      rowCount?: number | null;
      columnCount?: number | null;
      subjectIdentifier?: string | null;
      treatmentVariable?: string | null;
      outcomeVariable?: string | null;
      timeVariable?: string | null;
      eventVariable?: string | null;
      endpointLabel?: string | null;
      targetDefinition?: string | null;
      cohortFiltersApplied: string[];
    };
  };
  aiCommentary?: {
    source: 'AI' | 'FALLBACK';
    summary: string;
    limitations: string[];
    caution?: string;
    sections?: {
      status?: string;
      directAnswer?: string;
      population?: string;
      endpointDefinition?: string;
      mainFindings?: string;
      interactionFindings?: string;
      modelStrength?: string;
      nextSteps?: string[];
    };
  };
}

export type AutopilotExecutionMode = 'PACK' | 'SINGLE';
export type AutopilotDataScope = 'SINGLE_DATASET' | 'LINKED_WORKSPACE';

export interface AnalysisConcept {
  label: string;
  sourceColumn: string;
  terms: string[];
  matchCounts?: Record<string, number>;
}

export interface AnalysisPlanEntry {
  id: string;
  name: string;
  testType: StatTestType;
  var1: string;
  var2: string;
  covariates?: string[];
  imputationMethod?: string;
  applyPSM?: boolean;
  rationale?: string;
}

export interface AutopilotMappingDecision {
  sourceCol: string;
  targetCol: string;
  transformation?: string;
  origin: 'REFERENCE' | 'AI' | 'IDENTITY';
}

export interface AutopilotReviewBundle {
  workflow: {
    usageMode: UsageMode;
    rationale: string;
    guardrails: string[];
  };
  qc: {
    sourceFileName: string;
    status: QCStatus;
    issueCount: number;
    autoFixableIssueCount: number;
    blockingIssueCount: number;
    autoFixSummary?: string;
  };
  mapping?: {
    sourceDomain: string;
    targetDomain: string;
    mappedColumnCount: number;
    transformedColumnCount: number;
    decisions: AutopilotMappingDecision[];
  };
  protocol?: {
    documentName: string;
    extractedPlanCount: number;
    notes: string[];
    planItems: Array<{
      name: string;
      testType: StatTestType;
      var1: string;
      var2: string;
    }>;
  };
  workspace?: {
    joinKey: string;
    sourceNames: string[];
    skippedFiles: string[];
    rowCount: number;
    columnCount: number;
    derivedColumns: string[];
    notes: string[];
    previewTable?: ResultTable;
  };
  analysisPlan: {
    mode: AutopilotExecutionMode;
    scope: AutopilotDataScope;
    multiplicityMethod?: string;
    tasks: Array<{
      question: string;
      testType: StatTestType;
      var1: string;
      var2: string;
      rationale?: string;
    }>;
  };
}

export interface AnalysisSession extends StatAnalysisResult {
  id: string;
  timestamp: string;
  name: string;
  usageMode: UsageMode; // Track if this was Exploratory or Official
  params: {
    fileId: string;
    fileName: string;
    supportingFileIds?: string[];
    supportingFileNames?: string[];
    testType: StatTestType;
    var1: string;
    var2: string;
    covariates?: string[];
    imputationMethod?: string;
    applyPSM?: boolean;
    concept?: AnalysisConcept | null;
    contextDocIds?: string[];
    selectedPlanDocId?: string | null;
    preSpecifiedPlan?: AnalysisPlanEntry[];
    preSpecifiedPlanNotes?: string[];
    enforcePreSpecifiedPlan?: boolean;
    sourceWorkflow?: 'AUTOPILOT' | 'STATISTICS';
    sourceSessionId?: string | null;
    preSpecifiedPlanId?: string | null;
    autopilotRunId?: string | null;
    autopilotRunName?: string | null;
    autopilotMode?: AutopilotExecutionMode | null;
    autopilotSourceName?: string | null;
    autopilotSourceNames?: string[] | null;
    analysisQuestion?: string | null;
    autopilotQuestion?: string | null;
    autopilotResultIndex?: number | null;
    autopilotDataScope?: AutopilotDataScope | null;
    autopilotWorkspaceFileId?: string | null;
    autopilotWorkspaceFileName?: string | null;
    backendAnalysisFamily?:
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
      | 'unknown'
      | null;
    backendWorkspaceId?: string | null;
    backendSourceNames?: string[] | null;
    autopilotAdjustedPValue?: string | null;
    autopilotMultiplicityMethod?: string | null;
    autopilotReview?: AutopilotReviewBundle | null;
    autopilotExecutionLog?: string[] | null;
    autopilotQuestionMatchStatus?: 'MATCHED' | 'PARTIAL' | 'FAILED' | null;
    autopilotQuestionMatchSummary?: string | null;
    autopilotQuestionMatchDetails?: string[] | null;
  };
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  content: string;
  timestamp: string;
  citations?: {
    sourceId: string;
    snippet: string;
    kind?: 'DOCUMENT' | 'TABULAR_PROFILE' | 'TABULAR_ROWS';
    title?: string;
  }[];
  chartConfig?: ChartConfiguration;
  tableConfig?: ResultTable;
  keyInsights?: string[];
  agentRun?: AnalysisAgentRun;
  responseModeBadge?: ResponseModeBadge;
}

export interface StatSuggestion {
  testType: StatTestType;
  var1: string;
  var2: string;
  reason: string;
}

// --- BIAS AUDIT TYPES ---

export interface BiasMetric {
  category: string; // e.g., "Gender Balance", "Age Representation", "Site Variance"
  score: number; // 0-100 (100 is perfectly fair/representative)
  status: 'OPTIMAL' | 'WARN' | 'CRITICAL';
  finding: string; // e.g. "Females under-represented by 20%"
}

export interface BiasReport {
  overallFairnessScore: number;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  demographicAnalysis: BiasMetric[];
  siteAnomalies: { siteId: string; issue: string; deviation: string }[];
  recommendations: string[];
  narrativeAnalysis: string;
}
