
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
  STUFFING = 'STUFFING'
}

export enum UsageMode {
  EXPLORATORY = 'EXPLORATORY', // Sandbox, internal use
  OFFICIAL = 'OFFICIAL',       // GxP, Pre-specified in SAP
  POST_HOC = 'POST_HOC'        // Retrospective, requires disclaimer
}

export enum ProvenanceType {
  INGESTION = 'INGESTION',
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
  ANOVA = 'ANOVA',
  REGRESSION = 'Linear Regression',
  CORRELATION = 'Correlation Analysis'
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
}

export type QCStatus = 'PASS' | 'WARN' | 'FAIL' | 'PENDING';

export interface QCIssue {
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  description: string;
  affectedRows?: string; // e.g. "Row 4, 10" or "Column 'AGE'"
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
  operator: 'EQUALS' | 'NOT_EQUALS' | 'GREATER_THAN' | 'LESS_THAN' | 'CONTAINS';
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

export interface AnalysisResponse {
  answer: string;
  chartConfig?: ChartConfiguration;
  keyInsights?: string[];
}

export interface StatAnalysisResult {
  metrics: Record<string, string | number>;
  interpretation: string;
  chartConfig: ChartConfiguration;
  executedCode: string;
  sasCode?: string; // NEW: Stores generated SAS code
}

export interface AnalysisSession extends StatAnalysisResult {
  id: string;
  timestamp: string;
  name: string;
  usageMode: UsageMode; // Track if this was Exploratory or Official
  params: {
    fileId: string;
    fileName: string;
    testType: StatTestType;
    var1: string;
    var2: string;
  };
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  content: string;
  timestamp: string;
  citations?: { sourceId: string; snippet: string }[];
  chartConfig?: ChartConfiguration;
  keyInsights?: string[];
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