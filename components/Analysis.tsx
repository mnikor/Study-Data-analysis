import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Send, Bot, User, FileText, CheckSquare, Search, BookOpen, Lightbulb, TrendingUp, AlertTriangle, Sparkles, Download, GitMerge, Users, Activity, Cpu, ChevronDown, ChevronRight } from 'lucide-react';
import { ClinicalFile, DataType, ChatMessage, AnalysisMode, ProvenanceRecord, ProvenanceType, AnalysisAgentRunSummary, AnalysisAgentRun, AnalysisAgentPlanBrief } from '../types';
import { generateAnalysis } from '../services/geminiService';
import { exportAnalysisAgentRun, getAnalysisAgentRun, listAnalysisAgentRuns, planAnalysisAgent, type FastApiAgentPlanResponse, type FastApiAgentRunResponse } from '../services/fastapiAnalysisService';
import { buildDatasetReference } from '../services/executionBridge';
import {
  generateQuestionPlanningAssist,
  generateExplorationQuestionSuggestions,
  type ExplorationQuestionSuggestion,
  type QuestionPlanningAssist,
} from '../services/planningAssistService';
import { Chart } from './Chart';
import { buildChatQuickActions, ChatQuickActionIcon } from '../utils/chatQuickActions';
import { InfoTooltip } from './InfoTooltip';
import { buildQuestionFileRecommendation, inferDatasetProfile, type AnalysisRole } from '../utils/datasetProfile';
import { resolveChatAnalysisContext } from '../utils/chatAnalysisResolver';

interface AnalysisProps {
  files: ClinicalFile[];
  onRecordProvenance: (record: ProvenanceRecord) => void;
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
}

const QUICK_ACTION_ICONS: Record<ChatQuickActionIcon, React.ComponentType<{ className?: string }>> = {
  OVERVIEW: Lightbulb,
  PROTOCOL: FileText,
  SAFETY: AlertTriangle,
  LABS: TrendingUp,
  EXPOSURE: TrendingUp,
  BIOMARKER: Sparkles,
  LINKED: GitMerge,
  DEMOGRAPHICS: Users,
  TIME_TO_EVENT: Activity,
};

const INLINE_TOKEN_REGEX = /(\*\*[^*]+\*\*|`[^`]+`)/g;

const renderInlineTokens = (text: string): React.ReactNode[] =>
  text.split(INLINE_TOKEN_REGEX).filter(Boolean).map((token, index) => {
    if (token.startsWith('**') && token.endsWith('**')) {
      return <strong key={index} className="font-semibold text-slate-900">{token.slice(2, -2)}</strong>;
    }
    if (token.startsWith('`') && token.endsWith('`')) {
      return <code key={index} className="rounded bg-slate-100 px-1.5 py-0.5 text-[0.92em] text-slate-700">{token.slice(1, -1)}</code>;
    }
    return token;
  });

const escapeHtml = (text: string): string =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const formatInlineHtml = (text: string): string =>
  escapeHtml(text).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/`([^`]+)`/g, '<code>$1</code>');

const renderFormattedMessage = (content: string): React.ReactNode[] => {
  const lines = content.split('\n');
  const blocks: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trim();

    if (!line) {
      i += 1;
      continue;
    }

    const headingMatch = line.match(/^(#{1,4})\s+(.*)$/);
    if (headingMatch) {
      const level = Math.min(headingMatch[1].length, 4);
      const headingText = headingMatch[2].trim();
      const className =
        level === 1 ? 'text-xl font-bold text-slate-900 mt-1' :
        level === 2 ? 'text-lg font-bold text-slate-900 mt-1' :
        'text-base font-semibold text-slate-900 mt-1';
      blocks.push(
        <div key={`heading-${i}`} className={className}>
          {renderInlineTokens(headingText)}
        </div>
      );
      i += 1;
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length) {
        const current = lines[i].trim();
        if (!current) break;
        const bulletMatch = current.match(/^[-*]\s+(.*)$/);
        if (bulletMatch) {
          items.push(bulletMatch[1]);
          i += 1;
          continue;
        }
        if (items.length > 0) {
          items[items.length - 1] += ` ${current}`;
          i += 1;
          continue;
        }
        break;
      }

      blocks.push(
        <ul key={`list-${i}`} className="my-3 list-disc space-y-2 pl-5 text-sm text-slate-800">
          {items.map((item, index) => (
            <li key={index} className="leading-relaxed">{renderInlineTokens(item)}</li>
          ))}
        </ul>
      );
      continue;
    }

    const paragraphLines: string[] = [line];
    i += 1;
    while (i < lines.length) {
      const current = lines[i].trim();
      if (!current) {
        i += 1;
        break;
      }
      if (/^(#{1,4})\s+/.test(current) || /^[-*]\s+/.test(current)) break;
      paragraphLines.push(current);
      i += 1;
    }

    blocks.push(
      <p key={`paragraph-${i}`} className="my-3 text-sm leading-relaxed text-slate-800">
        {renderInlineTokens(paragraphLines.join(' '))}
      </p>
    );
  }

  return blocks;
};

const formatMessageAsHtml = (content: string): string => {
  const lines = content.split('\n');
  const htmlBlocks: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trim();

    if (!line) {
      i += 1;
      continue;
    }

    const headingMatch = line.match(/^(#{1,4})\s+(.*)$/);
    if (headingMatch) {
      const level = Math.min(headingMatch[1].length + 1, 5);
      htmlBlocks.push(`<h${level}>${formatInlineHtml(headingMatch[2].trim())}</h${level}>`);
      i += 1;
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length) {
        const current = lines[i].trim();
        if (!current) break;
        const bulletMatch = current.match(/^[-*]\s+(.*)$/);
        if (bulletMatch) {
          items.push(bulletMatch[1]);
          i += 1;
          continue;
        }
        if (items.length > 0) {
          items[items.length - 1] += ` ${current}`;
          i += 1;
          continue;
        }
        break;
      }
      htmlBlocks.push(`<ul>${items.map((item) => `<li>${formatInlineHtml(item)}</li>`).join('')}</ul>`);
      continue;
    }

    const paragraphLines: string[] = [line];
    i += 1;
    while (i < lines.length) {
      const current = lines[i].trim();
      if (!current) {
        i += 1;
        break;
      }
      if (/^(#{1,4})\s+/.test(current) || /^[-*]\s+/.test(current)) break;
      paragraphLines.push(current);
      i += 1;
    }

    htmlBlocks.push(`<p>${formatInlineHtml(paragraphLines.join(' '))}</p>`);
  }

  return htmlBlocks.join('');
};

const ROLE_LABELS: Record<AnalysisRole, string> = {
  ADSL: 'Subject baseline',
  ADAE: 'Adverse events',
  ADLB: 'Labs',
  ADTTE: 'Time to event',
  ADEX: 'Exposure / dosing',
  DS: 'Disposition / adherence',
};

const confidenceBadgeClass = (confidence?: string) =>
  confidence === 'High'
    ? 'bg-emerald-50 text-emerald-700'
    : confidence === 'Medium'
      ? 'bg-amber-50 text-amber-700'
      : 'bg-slate-100 text-slate-600';

const supportStatusClass = (status?: 'READY' | 'PARTIAL' | 'MISSING') =>
  status === 'READY'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
    : status === 'PARTIAL'
      ? 'border-amber-200 bg-amber-50 text-amber-800'
      : 'border-red-200 bg-red-50 text-red-800';

const supportCheckClass = (status?: 'MET' | 'PARTIAL' | 'MISSING') =>
  status === 'MET'
    ? 'text-emerald-700'
    : status === 'PARTIAL'
      ? 'text-amber-700'
      : 'text-red-700';

const suggestionSupportClass = (status?: 'READY' | 'PARTIAL' | 'MISSING') =>
  status === 'READY'
    ? 'bg-emerald-50 text-emerald-700'
    : status === 'PARTIAL'
      ? 'bg-amber-50 text-amber-700'
      : 'bg-red-50 text-red-700';

const formatAgentRunTimestamp = (value?: string | null) => {
  if (!value) return 'Saved run';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Saved run';
  return parsed.toLocaleString();
};

interface InsightSections {
  directAnswer: string;
  supportingPoints: string[];
  potentialHypotheses: string[];
  recommendedFollowUp: string[];
  limitations: string[];
  contextNotes: string[];
  nextSteps: string[];
}

const splitInsightSections = (insights?: string[]) => {
  if (!insights || insights.length === 0) {
    return null;
  }

  const contextNotes = insights.filter((insight) => /^Applied cohort filters:/i.test(insight));
  const nextSteps = insights.filter((insight) => /^What to do next:/i.test(insight));
  const analyticPoints = insights.filter(
    (insight) => !/^Applied cohort filters:/i.test(insight) && !/^What to do next:/i.test(insight)
  );

  const directAnswer = analyticPoints[0] || insights[0];
  const supportingPoints = analyticPoints.slice(1);

  return {
    directAnswer,
    supportingPoints,
    potentialHypotheses: [],
    recommendedFollowUp: [],
    limitations: [],
    contextNotes,
    nextSteps,
  };
};

const normalizeAgentRun = (run?: Partial<AnalysisAgentRun> | null): AnalysisAgentRun | null => {
  if (!run || !run.runId) return null;
  return {
    runId: run.runId,
    question: run.question || '',
    createdAt: run.createdAt || null,
    status: run.status || 'unsupported',
    missingRoles: Array.isArray(run.missingRoles) ? run.missingRoles : [],
    executed: Boolean(run.executed),
    analysisFamily: run.analysisFamily || 'unknown',
    selectedSources: Array.isArray(run.selectedSources) ? run.selectedSources : [],
    selectedRoles: run.selectedRoles || {},
    workspaceId: run.workspaceId || null,
    userSummary: run.userSummary
      ? {
          bottomLine: run.userSummary.bottomLine || '',
          evidencePoints: Array.isArray(run.userSummary.evidencePoints) ? run.userSummary.evidencePoints : [],
          potentialHypotheses: Array.isArray(run.userSummary.potentialHypotheses) ? run.userSummary.potentialHypotheses : [],
          recommendedFollowUp: Array.isArray(run.userSummary.recommendedFollowUp) ? run.userSummary.recommendedFollowUp : [],
          limitations: Array.isArray(run.userSummary.limitations) ? run.userSummary.limitations : [],
          nextStep: run.userSummary.nextStep || null,
          contextNote: run.userSummary.contextNote || null,
        }
      : null,
    steps: Array.isArray(run.steps)
      ? run.steps.map((step) => ({
          id: step?.id || crypto.randomUUID(),
          title: step?.title || 'Agent step',
          status: step?.status || 'skipped',
          summary: step?.summary || '',
          details: Array.isArray(step?.details) ? step.details : [],
          code: step?.code || null,
          chart: step?.chart || undefined,
          table: step?.table
            ? {
                title: step.table.title || '',
                columns: Array.isArray(step.table.columns) ? step.table.columns : [],
                rows: Array.isArray(step.table.rows) ? step.table.rows : [],
              }
            : null,
          provenance: step?.provenance
            ? {
                sourceNames: Array.isArray(step.provenance.sourceNames) ? step.provenance.sourceNames : [],
                columnsUsed: Array.isArray(step.provenance.columnsUsed) ? step.provenance.columnsUsed : [],
                derivedColumns: Array.isArray(step.provenance.derivedColumns) ? step.provenance.derivedColumns : [],
                cohortFiltersApplied: Array.isArray(step.provenance.cohortFiltersApplied) ? step.provenance.cohortFiltersApplied : [],
                joinKeys: Array.isArray(step.provenance.joinKeys) ? step.provenance.joinKeys : [],
                note: step.provenance.note || null,
              }
            : null,
        }))
      : [],
    warnings: Array.isArray(run.warnings) ? run.warnings : [],
  };
};

const renderAgentStepProvenance = (
  provenance?: AnalysisAgentRun['steps'][number]['provenance'],
  variant: 'default' | 'compact' = 'default'
) => {
  if (!provenance) return null;

  const items: Array<{ label: string; value: string | null }> = [
    { label: 'Sources', value: provenance.sourceNames.length > 0 ? provenance.sourceNames.join(', ') : null },
    { label: 'Variables', value: provenance.columnsUsed.length > 0 ? provenance.columnsUsed.join(', ') : null },
    { label: 'Derived', value: provenance.derivedColumns.length > 0 ? provenance.derivedColumns.join(', ') : null },
    { label: 'Filters', value: provenance.cohortFiltersApplied.length > 0 ? provenance.cohortFiltersApplied.join(', ') : null },
    { label: 'Join logic', value: provenance.joinKeys.length > 0 ? provenance.joinKeys.join(', ') : null },
    { label: 'Note', value: provenance.note || null },
  ].filter((item) => item.value);

  if (items.length === 0) return null;

  return (
    <div className={`mt-3 rounded-lg border border-slate-200 ${variant === 'compact' ? 'bg-slate-50 px-3 py-2' : 'bg-white px-3 py-3'}`}>
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Step Provenance</div>
      <div className="space-y-2">
        {items.map((item) => (
          <div key={`${item.label}-${item.value}`} className={`${variant === 'compact' ? 'text-[11px]' : 'text-xs'} leading-relaxed text-slate-600`}>
            <span className="font-semibold text-slate-700">{item.label}:</span> {item.value}
          </div>
        ))}
      </div>
    </div>
  );
};

const responseBadgeClass = (tone?: 'summary' | 'deterministic' | 'blocked' | 'fallback') => {
  switch (tone) {
    case 'deterministic':
      return 'border-emerald-200 bg-emerald-50 text-emerald-700';
    case 'blocked':
      return 'border-amber-200 bg-amber-50 text-amber-800';
    case 'fallback':
      return 'border-rose-200 bg-rose-50 text-rose-700';
    case 'summary':
    default:
      return 'border-slate-200 bg-slate-50 text-slate-700';
  }
};

const formatAnalysisFamilyLabel = (family?: AnalysisAgentPlanBrief['analysisFamily']) => {
  switch (family) {
    case 'risk_difference':
      return 'Risk difference';
    case 'logistic_regression':
      return 'Logistic regression';
    case 'kaplan_meier':
      return 'Kaplan-Meier';
    case 'mixed_model':
      return 'Mixed model';
    case 'threshold_search':
      return 'Threshold search';
    case 'competing_risks':
      return 'Competing risks';
    case 'feature_importance':
      return 'Feature importance';
    case 'partial_dependence':
      return 'Partial dependence';
    case 'cox':
      return 'Cox model';
    case 'incidence':
      return 'Incidence';
    case 'unknown':
    default:
      return 'Unknown';
  }
};

const formatCapabilityStageLabel = (stage?: 'none' | 'selection' | 'planner' | 'data' | 'method') => {
  switch (stage) {
    case 'selection':
      return 'File selection';
    case 'planner':
      return 'Question classification';
    case 'data':
      return 'Data readiness';
    case 'method':
      return 'Method support';
    case 'none':
    default:
      return 'Ready';
  }
};

export const Analysis: React.FC<AnalysisProps> = ({ files, onRecordProvenance, messages, setMessages }) => {
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [mode, setMode] = useState<AnalysisMode>(AnalysisMode.AGENT);
  const [selectedFileIds, setSelectedFileIds] = useState<Set<string>>(new Set());
  const [planningAssist, setPlanningAssist] = useState<QuestionPlanningAssist | null>(null);
  const [isPlanningAssistLoading, setIsPlanningAssistLoading] = useState(false);
  const [planningAssistError, setPlanningAssistError] = useState<string | null>(null);
  const [explorationSuggestions, setExplorationSuggestions] = useState<ExplorationQuestionSuggestion[]>([]);
  const [isExplorationSuggestionsLoading, setIsExplorationSuggestionsLoading] = useState(false);
  const [explorationSuggestionsError, setExplorationSuggestionsError] = useState<string | null>(null);
  const [pendingSuggestedQuestion, setPendingSuggestedQuestion] = useState<ExplorationQuestionSuggestion | null>(null);
  const [recentAgentRuns, setRecentAgentRuns] = useState<AnalysisAgentRunSummary[]>([]);
  const [isAgentRunsLoading, setIsAgentRunsLoading] = useState(false);
  const [agentRunsError, setAgentRunsError] = useState<string | null>(null);
  const [activeAgentRunId, setActiveAgentRunId] = useState<string | null>(null);
  const [expandedBlockedRunIds, setExpandedBlockedRunIds] = useState<Set<string>>(new Set());
  const [selectedAgentRunDetail, setSelectedAgentRunDetail] = useState<AnalysisAgentRun | null>(null);
  const [selectedAgentStepId, setSelectedAgentStepId] = useState<string | null>(null);
  const [isAgentDetailLoading, setIsAgentDetailLoading] = useState(false);
  const [agentDetailError, setAgentDetailError] = useState<string | null>(null);
  const [agentPlanBrief, setAgentPlanBrief] = useState<AnalysisAgentPlanBrief | null>(null);
  const [agentPlanStatus, setAgentPlanStatus] = useState<FastApiAgentPlanResponse['status'] | null>(null);
  const [agentPlanExplanation, setAgentPlanExplanation] = useState<string | null>(null);
  const [isAgentPlanBriefLoading, setIsAgentPlanBriefLoading] = useState(false);
  const [agentPlanBriefError, setAgentPlanBriefError] = useState<string | null>(null);
  const [isAgentToolsOpen, setIsAgentToolsOpen] = useState(false);
  const [agentToolsTab, setAgentToolsTab] = useState<'brief' | 'runs'>('brief');
  const [isContextDrawerOpen, setIsContextDrawerOpen] = useState(false);
  const [isSourcesDrawerOpen, setIsSourcesDrawerOpen] = useState(false);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const agentPlanRequestIdRef = useRef(0);
  const docs = useMemo(
    () => files.filter(f => f.type === DataType.DOCUMENT || f.type === DataType.RAW || f.type === DataType.STANDARDIZED),
    [files]
  );
  const fileProfiles = useMemo(
    () => new Map(docs.map((doc) => [doc.id, inferDatasetProfile(doc)])),
    [docs]
  );

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const selectedContextFiles = useMemo(
    () => files.filter((f) => selectedFileIds.has(f.id)),
    [files, selectedFileIds]
  );
  const selectedSourceKey = useMemo(
    () => Array.from(selectedFileIds).sort().join('|'),
    [selectedFileIds]
  );
  const agentDatasetFiles = useMemo(
    () => docs.filter((file) => (file.type === DataType.RAW || file.type === DataType.STANDARDIZED) && Boolean(file.content)),
    [docs]
  );
  const quickActions = useMemo(
    () => buildChatQuickActions(selectedContextFiles, docs),
    [selectedContextFiles, docs]
  );
  const inputPlaceholder = useMemo(() => {
    if (selectedContextFiles.length === 0) {
      return 'Select one or more sources, then ask what they can support or which workflow to use next...';
    }
    if (selectedContextFiles.some((file) => file.type === DataType.DOCUMENT)) {
      return 'Ask what the selected protocol or SAP requires, whether the data supports it, or what to review next...';
    }
    return 'Ask about the selected sources, realistic analyses, joins, safety findings, or what deserves follow-up...';
  }, [selectedContextFiles]);
  const recommendation = useMemo(
    () => (input.trim() ? buildQuestionFileRecommendation(input, docs, fileProfiles) : null),
    [input, docs, fileProfiles]
  );
  const recommendedFileIds = useMemo(() => {
    const selected = Object.values(recommendation?.selectedByRole || {}).filter(Boolean) as ClinicalFile[];
    return new Set(selected.map((file) => file.id));
  }, [recommendation]);
  const recommendedRoleByFileId = useMemo(() => {
    const entries = Object.entries(recommendation?.selectedByRole || {}) as Array<[AnalysisRole, ClinicalFile | undefined]>;
    const mapped = new Map<string, AnalysisRole>();
    for (const [role, file] of entries) {
      if (file) mapped.set(file.id, role);
    }
    return mapped;
  }, [recommendation]);
  const alternativeRoleByFileId = useMemo(() => {
    const mapped = new Map<string, AnalysisRole>();
    const entries = Object.entries(recommendation?.alternativesByRole || {}) as Array<[AnalysisRole, ClinicalFile[] | undefined]>;
    for (const [role, filesForRole] of entries) {
      for (const file of filesForRole || []) {
        if (!recommendedRoleByFileId.has(file.id) && !mapped.has(file.id)) {
          mapped.set(file.id, role);
        }
      }
    }
    return mapped;
  }, [recommendation, recommendedRoleByFileId]);

  useEffect(() => {
    setPlanningAssist(null);
    setPlanningAssistError(null);
  }, [input, docs]);

  useEffect(() => {
    setExplorationSuggestions([]);
    setExplorationSuggestionsError(null);
    setPendingSuggestedQuestion(null);
  }, [selectedFileIds, docs, input]);

  useEffect(() => {
    if (mode === AnalysisMode.AGENT) {
      void loadRecentAgentRuns();
    }
  }, [mode]);

  useEffect(() => {
    if (mode !== AnalysisMode.AGENT) {
      setAgentPlanBrief(null);
      setAgentPlanStatus(null);
      setAgentPlanExplanation(null);
      setAgentPlanBriefError(null);
      setIsAgentPlanBriefLoading(false);
      return;
    }

    if (!input.trim()) {
      setAgentPlanBrief(null);
      setAgentPlanStatus(null);
      setAgentPlanExplanation(null);
      setAgentPlanBriefError(null);
      setIsAgentPlanBriefLoading(false);
      return;
    }

    if (agentDatasetFiles.length === 0) {
      setAgentPlanBrief(null);
      setAgentPlanStatus('missing_data');
      setAgentPlanExplanation('No tabular datasets are available for agent planning.');
      setAgentPlanBriefError(null);
      setIsAgentPlanBriefLoading(false);
      return;
    }

    const timer = window.setTimeout(() => {
      void loadAgentPlanBrief(input);
    }, 600);

    return () => window.clearTimeout(timer);
  }, [mode, input, selectedSourceKey, agentDatasetFiles]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

  const toggleFileSelection = (id: string) => {
    const newSet = new Set(selectedFileIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedFileIds(newSet);
  };

  const selectAllSources = () => {
    setSelectedFileIds(new Set(docs.map((doc) => doc.id)));
  };

  const clearSelectedSources = () => {
    setSelectedFileIds(new Set());
  };

  const selectSourcesByType = (types: DataType[]) => {
    setSelectedFileIds(new Set(docs.filter((doc) => types.includes(doc.type)).map((doc) => doc.id)));
  };

  const applyRecommendedSources = () => {
    if (!recommendation) return;
    const preservedDocumentIds = docs
      .filter((doc) => doc.type === DataType.DOCUMENT && selectedFileIds.has(doc.id))
      .map((doc) => doc.id);
    const recommendedIds = Object.values(recommendation.selectedByRole)
      .filter(Boolean)
      .map((file) => (file as ClinicalFile).id);
    setSelectedFileIds(new Set([...preservedDocumentIds, ...recommendedIds]));
  };

  const applyRecommendedSourcesForQuestion = (question: string) => {
    const scopedRecommendation = buildQuestionFileRecommendation(question, docs, fileProfiles);
    if (!scopedRecommendation) return;
    const preservedDocumentIds = docs
      .filter((doc) => doc.type === DataType.DOCUMENT && selectedFileIds.has(doc.id))
      .map((doc) => doc.id);
    const recommendedIds = Object.values(scopedRecommendation.selectedByRole)
      .filter(Boolean)
      .map((file) => (file as ClinicalFile).id);
    setSelectedFileIds(new Set([...preservedDocumentIds, ...recommendedIds]));
  };

  const toggleBlockedRunDetails = (runId: string) => {
    setExpandedBlockedRunIds((prev) => {
      const next = new Set(prev);
      if (next.has(runId)) {
        next.delete(runId);
      } else {
        next.add(runId);
      }
      return next;
    });
  };

  const toLocalAgentRun = (run: FastApiAgentRunResponse): AnalysisAgentRun => ({
    runId: run.run_id,
    question: run.question,
    createdAt: run.created_at || null,
    status: run.status,
    missingRoles: run.missing_roles,
    executed: run.executed,
    analysisFamily: run.analysis_family,
    selectedSources: run.selected_sources,
    selectedRoles: run.selected_roles,
    workspaceId: run.workspace_id || null,
    userSummary: run.user_summary
      ? {
          bottomLine: run.user_summary.bottom_line,
          evidencePoints: run.user_summary.evidence_points || [],
          potentialHypotheses: run.user_summary.potential_hypotheses || [],
          recommendedFollowUp: run.user_summary.recommended_follow_up || [],
          limitations: run.user_summary.limitations || [],
          nextStep: run.user_summary.next_step || null,
          contextNote: run.user_summary.context_note || null,
        }
      : null,
    steps: run.steps.map((step) => ({
      id: step.id,
      title: step.title,
      status: step.status,
      summary: step.summary,
      details: step.details,
      code: step.code || null,
      chart: step.chart || undefined,
      table: step.table || undefined,
      provenance: step.provenance
        ? {
            sourceNames: step.provenance.source_names || [],
            columnsUsed: step.provenance.columns_used || [],
            derivedColumns: step.provenance.derived_columns || [],
            cohortFiltersApplied: step.provenance.cohort_filters_applied || [],
            joinKeys: step.provenance.join_keys || [],
            note: step.provenance.note || null,
          }
        : null,
    })),
    warnings: run.warnings,
  });

  const toLocalAgentBrief = (plan: FastApiAgentPlanResponse): AnalysisAgentPlanBrief | null => {
    if (!plan.brief) return null;

    return {
      analysisFamily: plan.brief.analysis_family,
      targetDefinition: plan.brief.target_definition || null,
      endpointLabel: plan.brief.endpoint_label || null,
      treatmentVariable: plan.brief.treatment_variable || null,
      subgroupFactors: Array.isArray(plan.brief.subgroup_factors) ? plan.brief.subgroup_factors : [],
      requiredRoles: Array.isArray(plan.brief.required_roles) ? plan.brief.required_roles : [],
      missingRoles: Array.isArray(plan.brief.missing_roles) ? plan.brief.missing_roles : [],
      selectedSources: Array.isArray(plan.brief.selected_sources) ? plan.brief.selected_sources : [],
      selectedRoles: plan.brief.selected_roles || {},
      timeWindowDays: plan.brief.time_window_days ?? null,
      gradeThreshold: plan.brief.grade_threshold ?? null,
      termFilters: Array.isArray(plan.brief.term_filters) ? plan.brief.term_filters : [],
      cohortFilters: Array.isArray(plan.brief.cohort_filters) ? plan.brief.cohort_filters : [],
      interactionTerms: Array.isArray(plan.brief.interaction_terms) ? plan.brief.interaction_terms : [],
      requestedOutputs: Array.isArray(plan.brief.requested_outputs) ? plan.brief.requested_outputs : [],
      notes: Array.isArray(plan.brief.notes) ? plan.brief.notes : [],
      assessment: plan.brief.assessment
        ? {
            supportLevel: plan.brief.assessment.support_level,
            blockerStage: plan.brief.assessment.blocker_stage,
            blockerReason: plan.brief.assessment.blocker_reason || null,
            recommendedNextStep: plan.brief.assessment.recommended_next_step || null,
            fallbackOption: plan.brief.assessment.fallback_option || null,
            dataRequirements: Array.isArray(plan.brief.assessment.data_requirements) ? plan.brief.assessment.data_requirements : [],
            methodConstraints: Array.isArray(plan.brief.assessment.method_constraints) ? plan.brief.assessment.method_constraints : [],
          }
        : null,
    };
  };

  const loadAgentPlanBrief = async (question: string) => {
    const trimmedQuestion = question.trim();
    const requestId = ++agentPlanRequestIdRef.current;

    if (!trimmedQuestion) {
      if (requestId === agentPlanRequestIdRef.current) {
        setAgentPlanBrief(null);
        setAgentPlanStatus(null);
        setAgentPlanExplanation(null);
        setAgentPlanBriefError(null);
        setIsAgentPlanBriefLoading(false);
      }
      return;
    }

    const datasetRefs = agentDatasetFiles.map((file) => buildDatasetReference(file, selectedFileIds.has(file.id)));
    if (datasetRefs.length === 0) {
      if (requestId === agentPlanRequestIdRef.current) {
        setAgentPlanBrief(null);
        setAgentPlanStatus('missing_data');
        setAgentPlanExplanation('No tabular datasets are available for agent planning.');
        setAgentPlanBriefError(null);
        setIsAgentPlanBriefLoading(false);
      }
      return;
    }

    setIsAgentPlanBriefLoading(true);
    setAgentPlanBriefError(null);

    try {
      const plan = await planAnalysisAgent(trimmedQuestion, datasetRefs);
      if (requestId !== agentPlanRequestIdRef.current) return;

      setAgentPlanBrief(toLocalAgentBrief(plan));
      setAgentPlanStatus(plan.status);
      setAgentPlanExplanation(plan.explanation || null);
      setAgentPlanBriefError(null);
    } catch (error) {
      if (requestId !== agentPlanRequestIdRef.current) return;

      setAgentPlanBrief(null);
      setAgentPlanStatus(null);
      setAgentPlanExplanation(null);
      setAgentPlanBriefError(error instanceof Error ? error.message : 'Could not prepare the agent plan preview.');
    } finally {
      if (requestId === agentPlanRequestIdRef.current) {
        setIsAgentPlanBriefLoading(false);
      }
    }
  };

  const restoreAgentRunSelection = (run: Pick<AnalysisAgentRun, 'selectedSources'>) => {
    const matchedDocs = docs.filter((doc) => run.selectedSources.includes(doc.name));
    const matchedIds = new Set(matchedDocs.map((doc) => doc.id));
    setSelectedFileIds(matchedIds);
    return {
      matchedDocs,
      matchedIds,
    };
  };

  const loadRecentAgentRuns = async () => {
    setIsAgentRunsLoading(true);
    setAgentRunsError(null);
    try {
      const runs = await listAnalysisAgentRuns(12);
      setRecentAgentRuns(
        runs.map((run) => ({
          runId: run.run_id,
          question: run.question,
          createdAt: run.created_at || null,
          status: run.status,
          missingRoles: run.missing_roles,
          executed: run.executed,
          analysisFamily: run.analysis_family,
          selectedSources: run.selected_sources,
        }))
      );
    } catch (error) {
      setAgentRunsError(error instanceof Error ? error.message : 'Could not load saved agent runs.');
      setRecentAgentRuns([]);
    } finally {
      setIsAgentRunsLoading(false);
    }
  };

  const viewAgentRunDetail = async (runId: string) => {
    if (isAgentDetailLoading || activeAgentRunId === runId) return;
    setIsAgentDetailLoading(true);
    setAgentDetailError(null);
    setActiveAgentRunId(runId);
    setIsAgentToolsOpen(true);
    setAgentToolsTab('runs');
    try {
      const run = await getAnalysisAgentRun(runId);
      const localRun = toLocalAgentRun(run);
      setSelectedAgentRunDetail(localRun);
      setSelectedAgentStepId(localRun.steps[0]?.id || null);
      restoreAgentRunSelection(localRun);
      setMode(AnalysisMode.AGENT);
    } catch (error) {
      setAgentDetailError(error instanceof Error ? error.message : 'Could not load run details.');
      setSelectedAgentRunDetail(null);
    } finally {
      setIsAgentDetailLoading(false);
      setActiveAgentRunId(null);
    }
  };

  const reopenAgentRun = async (runId: string) => {
    if (isLoading || activeAgentRunId === runId) return;

    setActiveAgentRunId(runId);
    setIsAgentToolsOpen(true);
    setAgentToolsTab('runs');
    try {
      const run = await getAnalysisAgentRun(runId);
      const localRun = toLocalAgentRun(run);
      setSelectedAgentRunDetail(localRun);
      setSelectedAgentStepId(localRun.steps[0]?.id || null);
      restoreAgentRunSelection(localRun);
      const reopenedQuestion = run.question || 'Reopened AI Analysis Agent run';
      const userMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        content: reopenedQuestion,
        timestamp: run.created_at || new Date().toISOString(),
      };
      const aiMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'model',
        content: run.answer,
        timestamp: new Date().toISOString(),
        chartConfig: run.chart || undefined,
        tableConfig: run.table || undefined,
        agentRun: localRun,
        responseModeBadge: {
          label: localRun.executed ? 'Deterministic analysis' : 'Deterministic analysis blocked',
          tone: localRun.executed ? 'deterministic' : 'blocked',
          detail: 'Loaded from a saved AI Analysis Agent run.',
        },
      };
      setMessages((prev) => [...prev, userMsg, aiMsg]);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not reopen saved run.';
      const aiMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'model',
        content: `### Could not reopen saved agent run\n${message}`,
        timestamp: new Date().toISOString(),
        responseModeBadge: {
          label: 'Saved run error',
          tone: 'fallback',
        },
      };
      setMessages((prev) => [...prev, aiMsg]);
    } finally {
      setActiveAgentRunId(null);
    }
  };

  const rerunAgentRun = async (runId: string) => {
    if (isLoading || activeAgentRunId === runId) return;
    setActiveAgentRunId(runId);
    setIsAgentToolsOpen(true);
    setAgentToolsTab('runs');
    try {
      const run = await getAnalysisAgentRun(runId);
      const localRun = toLocalAgentRun(run);
      setSelectedAgentRunDetail(localRun);
      setSelectedAgentStepId(localRun.steps[0]?.id || null);
      const { matchedDocs, matchedIds } = restoreAgentRunSelection(localRun);
      setMode(AnalysisMode.AGENT);
      await handleSend(run.question, matchedDocs, matchedIds, AnalysisMode.AGENT);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not rerun saved agent run.';
      const aiMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'model',
        content: `### Could not rerun saved agent run\n${message}`,
        timestamp: new Date().toISOString(),
        responseModeBadge: {
          label: 'Saved run error',
          tone: 'fallback',
        },
      };
      setMessages((prev) => [...prev, aiMsg]);
    } finally {
      setActiveAgentRunId(null);
    }
  };

  const handleGeneratePlanningAssist = async () => {
    if (!input.trim() || docs.length === 0 || isPlanningAssistLoading) return;
    setIsPlanningAssistLoading(true);
    setPlanningAssistError(null);
    try {
      const assist = await generateQuestionPlanningAssist(input, docs);
      if (!assist) {
        setPlanningAssistError('AI planning assist could not produce advice from the current files.');
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

  const handleGenerateExplorationSuggestions = async () => {
    if (selectedContextFiles.length === 0 || isExplorationSuggestionsLoading) return;
    setIsExplorationSuggestionsLoading(true);
    setExplorationSuggestionsError(null);
    try {
      const suggestions = await generateExplorationQuestionSuggestions(selectedContextFiles, input);
      if (!suggestions.length) {
        setExplorationSuggestions([]);
        setExplorationSuggestionsError('AI could not propose distinct questions from the current selected sources.');
      } else {
        setExplorationSuggestions(suggestions);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'AI question suggestions failed.';
      setExplorationSuggestions([]);
      setExplorationSuggestionsError(message);
    } finally {
      setIsExplorationSuggestionsLoading(false);
    }
  };

  const buildScopedContextForQuestion = (question: string) => {
    const resolution = resolveChatAnalysisContext(question, selectedContextFiles, docs, fileProfiles);
    const scopedFiles = resolution.resolvedFiles;
    const scopedIds = new Set(scopedFiles.map((file) => file.id));
    return {
      scopedFiles,
      scopedIds,
      note: resolution.note,
      shouldUpdateSelection: resolution.autoSelected,
    };
  };

  const executeSuggestedQuestion = async (question: string) => {
    const { scopedFiles, scopedIds } = buildScopedContextForQuestion(question);
    setSelectedFileIds(scopedIds);
    await handleSend(question, scopedFiles, scopedIds);
  };

  const handleRunSuggestedQuestion = async (suggestion: ExplorationQuestionSuggestion) => {
    if (suggestion.supportStatus === 'PARTIAL') {
      setPendingSuggestedQuestion(suggestion);
      return;
    }
    setPendingSuggestedQuestion(null);
    await executeSuggestedQuestion(suggestion.question);
  };

  const rerunBlockedAgentQuestionInSummaryMode = async (question: string) => {
    setMode(AnalysisMode.RAG);
    setInput(question);
    await handleSend(question, selectedContextFiles, selectedFileIds, AnalysisMode.RAG);
  };

  const handleSend = async (
    textOverride?: string,
    contextOverride?: ClinicalFile[],
    selectedIdsOverride?: Set<string>,
    modeOverride?: AnalysisMode
  ) => {
    const textToSend = textOverride || input;
    if (!textToSend.trim() || isLoading) return;

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: textToSend,
      timestamp: new Date().toISOString()
    };

    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);

    let contextFiles = contextOverride || selectedContextFiles;
    let provenanceIds = new Set(selectedIdsOverride || selectedFileIds);
    let resolutionNote = '';

    if (!contextOverride && !selectedIdsOverride) {
      const scoped = buildScopedContextForQuestion(textToSend);
      contextFiles = scoped.scopedFiles;
      provenanceIds = scoped.scopedIds;
      resolutionNote = scoped.note;
      if (scoped.shouldUpdateSelection) {
        setSelectedFileIds(new Set(scoped.scopedIds));
      }
    }

    const provenanceInputs = Array.from(provenanceIds);
    
    // Record provenance start
    const provId = crypto.randomUUID();
    onRecordProvenance({
      id: provId,
      timestamp: new Date().toISOString(),
      userId: 'current_user',
      actionType: ProvenanceType.ANALYSIS,
      details: `Query: ${textToSend.substring(0, 50)}... | Mode: ${modeOverride || mode}`,
      inputs: provenanceInputs
    });

    const response = await generateAnalysis(textToSend, contextFiles, modeOverride || mode, messages, docs);

    const aiMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'model',
      content: response.answer,
      timestamp: new Date().toISOString(),
      citations: response.citations,
      chartConfig: response.chartConfig,
      tableConfig: response.tableConfig,
      keyInsights: response.keyInsights,
      agentRun: response.agentRun,
      responseModeBadge: response.responseModeBadge,
    };

    if (resolutionNote) {
      aiMsg.content = `${resolutionNote}\n\n${aiMsg.content}`;
    }

    setMessages(prev => [...prev, aiMsg]);
    setIsLoading(false);
    if ((modeOverride || mode) === AnalysisMode.AGENT && response.agentRun) {
      void loadRecentAgentRuns();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const exportMessage = (msg: ChatMessage, index: number) => {
      // Find the user query that triggered this, if possible (usually the previous message)
      const prevMsg = index > 0 ? messages[index - 1] : null;
      const userQuery = prevMsg?.role === 'user' ? prevMsg.content : "N/A";
      const insightSections: InsightSections | null = msg.agentRun
        ? (msg.agentRun.userSummary
            ? {
                directAnswer: msg.agentRun.userSummary.bottomLine,
                supportingPoints: msg.agentRun.userSummary.evidencePoints,
                potentialHypotheses: msg.agentRun.userSummary.potentialHypotheses,
                recommendedFollowUp: msg.agentRun.userSummary.recommendedFollowUp,
                limitations: msg.agentRun.userSummary.limitations,
                nextSteps: msg.agentRun.userSummary.nextStep ? [msg.agentRun.userSummary.nextStep] : [],
                contextNotes: msg.agentRun.userSummary.contextNote ? [msg.agentRun.userSummary.contextNote] : [],
              }
            : null)
        : splitInsightSections(msg.keyInsights);

      // Create a nice HTML wrapper for the AI response
      const chartScript = msg.chartConfig ? `
          <div id="chartDiv" style="width:100%; height:500px; margin-top:20px; border:1px solid #eee; border-radius:8px;"></div>
          <script>
            var data = ${JSON.stringify(msg.chartConfig.data)};
            var layout = ${JSON.stringify(msg.chartConfig.layout)};
            // Ensure layout fits container
            layout.autosize = true;
            Plotly.newPlot('chartDiv', data, layout);
          </script>
      ` : '';

      const resultTable = msg.tableConfig ? `
          <div style="margin-top:30px;">
            <span class="label" style="display:block; margin-bottom:10px;">Result Table</span>
            <div style="overflow:auto; border:1px solid #e2e8f0; border-radius:8px;">
              <table style="width:100%; border-collapse:collapse; font-size:0.95em;">
                <thead>
                  <tr>
                    ${msg.tableConfig.columns.map((column) => `<th style="text-align:left; padding:12px; background:#f8fafc; border-bottom:1px solid #e2e8f0;">${escapeHtml(column)}</th>`).join('')}
                  </tr>
                </thead>
                <tbody>
                  ${msg.tableConfig.rows.map((row) => `
                    <tr>
                      ${msg.tableConfig!.columns.map((column) => `<td style="padding:12px; border-bottom:1px solid #f1f5f9;">${escapeHtml(String(row[column] ?? ''))}</td>`).join('')}
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
      ` : '';

      const content = `
        <!DOCTYPE html>
        <html>
        <head>
          <title>AI Analysis Report</title>
          <script src="https://cdn.plot.ly/plotly-2.27.0.min.js"></script>
          <style>
            body { font-family: -apple-system, system-ui, sans-serif; max-width: 900px; margin: 40px auto; line-height: 1.6; color: #1e293b; }
            h1 { color: #0f172a; border-bottom: 2px solid #e2e8f0; padding-bottom: 10px; margin-bottom: 30px; }
            .meta { background: #f8fafc; padding: 15px; border-radius: 8px; border: 1px solid #e2e8f0; margin-bottom: 30px; font-size: 0.9em; }
            .label { font-weight: bold; color: #64748b; text-transform: uppercase; font-size: 0.75em; letter-spacing: 0.05em; }
            .query-box { background: #f0f9ff; padding: 15px; border-left: 4px solid #0ea5e9; margin-bottom: 30px; font-style: italic; }
            .content { font-size: 1.05em; }
            .content h2, .content h3, .content h4, .content h5 { color: #0f172a; margin: 1.1em 0 0.45em; line-height: 1.25; }
            .content h2 { font-size: 1.35em; }
            .content h3 { font-size: 1.15em; }
            .content h4, .content h5 { font-size: 1.05em; }
            .content p { margin: 0 0 1em; }
            .content ul { margin: 0 0 1em 1.25em; padding: 0; }
            .content li { margin-bottom: 0.4em; }
            .content code { background: #f1f5f9; padding: 0.1em 0.35em; border-radius: 4px; font-family: ui-monospace, SFMono-Regular, monospace; font-size: 0.92em; }
            .insight-box { margin-top: 30px; background: #eef2ff; border: 1px solid #c7d2fe; border-radius: 8px; padding: 20px; }
            .insight-box h3 { margin-top: 0; color: #4338ca; font-size: 1.1em; display: flex; align-items: center; }
            ul { margin: 0; padding-left: 20px; }
            li { margin-bottom: 8px; }
            strong { color: #334155; }
          </style>
        </head>
        <body>
          <h1>AI Analysis Report</h1>
          
          <div class="meta">
            <div><span class="label">Date:</span> ${new Date(msg.timestamp).toLocaleString()}</div>
            <div><span class="label">Report ID:</span> ${msg.id.split('-')[0]}</div>
          </div>

          <div><span class="label">User Query</span></div>
          <div class="query-box">"${userQuery}"</div>
          
          <div><span class="label">Analysis Result</span></div>
          ${msg.responseModeBadge ? `
            <div style="margin: 10px 0 18px;">
              <span style="display:inline-block; border:1px solid #cbd5e1; background:#f8fafc; color:#334155; border-radius:9999px; padding:6px 10px; font-size:12px; font-weight:600;">
                ${escapeHtml(msg.responseModeBadge.label)}
              </span>
              ${msg.responseModeBadge.autoRouted ? `
                <span style="display:inline-block; border:1px solid #bfdbfe; background:#eff6ff; color:#1d4ed8; border-radius:9999px; padding:6px 10px; font-size:12px; font-weight:600; margin-left:8px;">
                  Auto-routed to agent
                </span>
              ` : ''}
              ${msg.responseModeBadge.detail ? `<div style="margin-top:8px; color:#64748b; font-size:0.9em;">${escapeHtml(msg.responseModeBadge.detail)}</div>` : ''}
            </div>
          ` : ''}
          <div class="content">${formatMessageAsHtml(msg.content)}</div>

          ${insightSections ? `
            <div class="insight-box">
                <h3>Answer And Interpretation</h3>
                <p>${escapeHtml(insightSections.directAnswer)}</p>
                ${insightSections.supportingPoints.length > 0 ? `<ul>${insightSections.supportingPoints.map(i => `<li>${escapeHtml(i)}</li>`).join('')}</ul>` : ''}
                ${insightSections.potentialHypotheses.length > 0 ? `<p><strong>Possible explanations</strong></p><ul>${insightSections.potentialHypotheses.map(i => `<li>${escapeHtml(i)}</li>`).join('')}</ul>` : ''}
                ${insightSections.recommendedFollowUp.length > 0 ? `<p><strong>Recommended follow-up analyses</strong></p><ul>${insightSections.recommendedFollowUp.map(i => `<li>${escapeHtml(i)}</li>`).join('')}</ul>` : ''}
                ${insightSections.limitations.length > 0 ? `<p><strong>Limitations</strong></p><ul>${insightSections.limitations.map(i => `<li>${escapeHtml(i)}</li>`).join('')}</ul>` : ''}
                ${insightSections.nextSteps.length > 0 ? `<p><strong>Next step:</strong> ${escapeHtml(insightSections.nextSteps[0].replace(/^What to do next:\s*/i, ''))}</p>` : ''}
                ${insightSections.contextNotes.length > 0 ? `<p><strong>Context:</strong> ${escapeHtml(insightSections.contextNotes.join(' '))}</p>` : ''}
            </div>
          ` : ''}

          ${msg.chartConfig ? `<div><span class="label" style="display:block; margin-top:30px;">Visual Data</span></div>` : ''}
          ${chartScript}
          ${resultTable}
          
          <div style="margin-top: 50px; border-top: 1px solid #e2e8f0; padding-top: 20px; color: #94a3b8; font-size: 0.8em; text-align: center;">
             Generated by Evidence CoPilot
          </div>
        </body>
        </html>
      `;

      const blob = new Blob([content], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ai_report_${msg.id.substring(0,6)}.html`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
  };

  const exportAgentRun = async (runId: string, format: 'ipynb' | 'html') => {
    const exported = await exportAnalysisAgentRun(runId, format);
    const blob = new Blob([exported.content], { type: exported.mime_type });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = exported.filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="relative flex h-full bg-white">
      {isContextDrawerOpen && (
        <button
          aria-label="Close context drawer"
          onClick={() => setIsContextDrawerOpen(false)}
          className="absolute inset-0 z-20 bg-slate-900/20"
        />
      )}

      {/* Context Drawer */}
      {isContextDrawerOpen && (
      <div className="absolute inset-y-0 left-0 z-30 w-80 border-r border-slate-200 flex flex-col bg-slate-50 shadow-2xl">
        <div className="p-4 border-b border-slate-200">
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-semibold text-slate-800 flex items-center">
              <BookOpen className="w-4 h-4 mr-2" /> Context Manager
            </h3>
            <button
              onClick={() => setIsContextDrawerOpen(false)}
              className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-100"
            >
              Close
            </button>
          </div>
        </div>
        
        <div className="p-4 border-b border-slate-200 bg-white">
          <p className="text-xs leading-relaxed text-slate-500">
            Use this drawer only for secondary controls such as agent tools and source curation. Primary mode selection now lives in the chat composer.
          </p>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {mode === AnalysisMode.AGENT && (
            <>
              <div className="mb-4 rounded-xl border border-slate-200 bg-white p-3">
                <button
                  onClick={() => setIsAgentToolsOpen((prev) => !prev)}
                  className="flex w-full items-center justify-between gap-3 text-left"
                >
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wider text-slate-700">Agent Tools</div>
                    <div className="mt-1 text-[11px] leading-relaxed text-slate-500">
                      Optional planning and run-history controls. Keep this collapsed unless you need to inspect or rerun.
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-[11px] font-semibold text-slate-500">
                    <span>{isAgentToolsOpen ? 'Hide' : 'Show'}</span>
                    {isAgentToolsOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </div>
                </button>
                {isAgentToolsOpen && (
                  <div className="mt-3 flex gap-2 rounded-lg bg-slate-100 p-1">
                    <button
                      onClick={() => setAgentToolsTab('brief')}
                      className={`flex-1 rounded-md px-3 py-2 text-xs font-semibold transition-colors ${
                        agentToolsTab === 'brief' ? 'bg-white text-medical-700 shadow-sm' : 'text-slate-500'
                      }`}
                    >
                      Planning Brief
                    </button>
                    <button
                      onClick={() => setAgentToolsTab('runs')}
                      className={`flex-1 rounded-md px-3 py-2 text-xs font-semibold transition-colors ${
                        agentToolsTab === 'runs' ? 'bg-white text-medical-700 shadow-sm' : 'text-slate-500'
                      }`}
                    >
                      Recent Runs
                    </button>
                  </div>
                )}
              </div>
              {isAgentToolsOpen && agentToolsTab === 'brief' && (
                <div className="mb-4 rounded-xl border border-slate-200 bg-white p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wider text-slate-700">Pre-Execution Brief</div>
                    <div className="mt-1 text-[11px] leading-relaxed text-slate-500">
                      Preview of how the agent interprets the question before it builds the workspace and runs analysis.
                    </div>
                  </div>
                  <button
                    onClick={() => void loadAgentPlanBrief(input)}
                    disabled={!input.trim() || isAgentPlanBriefLoading}
                    className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:border-medical-200 hover:bg-medical-50 hover:text-medical-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isAgentPlanBriefLoading ? 'Preparing…' : 'Refresh'}
                  </button>
                </div>
                {!input.trim() && (
                  <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-500">
                    Ask a question to preview how the agent will scope the endpoint, data roles, and planned outputs.
                  </div>
                )}
                {input.trim() && isAgentPlanBriefLoading && (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-500">
                    Preparing agent brief…
                  </div>
                )}
                {agentPlanBriefError && (
                  <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                    {agentPlanBriefError}
                  </div>
                )}
                {input.trim() && !isAgentPlanBriefLoading && !agentPlanBriefError && (
                  <>
                    {agentPlanStatus && (
                      <div className={`mb-3 rounded-lg border px-3 py-2 text-xs ${
                        agentPlanStatus === 'executable'
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                          : agentPlanStatus === 'missing_data'
                            ? 'border-amber-200 bg-amber-50 text-amber-800'
                            : 'border-rose-200 bg-rose-50 text-rose-700'
                      }`}>
                        <span className="font-semibold">
                          {agentPlanStatus === 'executable'
                            ? 'Execution ready'
                            : agentPlanStatus === 'missing_data'
                              ? 'Execution readiness: missing data'
                              : 'Execution not supported yet'}
                        </span>
                        {agentPlanExplanation ? <span>{' '} {agentPlanExplanation}</span> : null}
                      </div>
                    )}
                    {agentPlanBrief ? (
                      <div className="space-y-3 text-xs text-slate-700">
                        {agentPlanBrief.assessment && (
                          <div className={`rounded-lg border px-3 py-3 ${
                            agentPlanBrief.assessment.supportLevel === 'supported'
                              ? 'border-emerald-200 bg-emerald-50'
                              : agentPlanBrief.assessment.supportLevel === 'partial'
                                ? 'border-amber-200 bg-amber-50'
                                : 'border-rose-200 bg-rose-50'
                          }`}>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                                agentPlanBrief.assessment.supportLevel === 'supported'
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : agentPlanBrief.assessment.supportLevel === 'partial'
                                    ? 'bg-amber-100 text-amber-800'
                                    : 'bg-rose-100 text-rose-700'
                              }`}>
                                {agentPlanBrief.assessment.supportLevel === 'supported'
                                  ? 'Supported'
                                  : agentPlanBrief.assessment.supportLevel === 'partial'
                                    ? 'Partially supported'
                                    : 'Not supported yet'}
                              </span>
                              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                                {formatCapabilityStageLabel(agentPlanBrief.assessment.blockerStage)}
                              </span>
                            </div>
                            {agentPlanBrief.assessment.blockerReason && (
                              <div className="mt-2 text-sm font-medium text-slate-800">
                                {agentPlanBrief.assessment.blockerReason}
                              </div>
                            )}
                            {agentPlanBrief.assessment.recommendedNextStep && (
                              <div className="mt-2 text-xs leading-relaxed text-slate-700">
                                <span className="font-semibold text-slate-800">What to do next:</span>{' '}
                                {agentPlanBrief.assessment.recommendedNextStep}
                              </div>
                            )}
                            {agentPlanBrief.assessment.fallbackOption && (
                              <div className="mt-2 text-xs leading-relaxed text-slate-600">
                                <span className="font-semibold text-slate-700">Fallback:</span>{' '}
                                {agentPlanBrief.assessment.fallbackOption}
                              </div>
                            )}
                          </div>
                        )}
                        <div className="grid grid-cols-1 gap-2">
                          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                            <div className="font-semibold uppercase tracking-wide text-slate-500">Analysis Family</div>
                            <div className="mt-1 text-sm font-semibold text-slate-800">
                              {formatAnalysisFamilyLabel(agentPlanBrief.analysisFamily)}
                            </div>
                          </div>
                          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                            <div className="font-semibold uppercase tracking-wide text-slate-500">Endpoint</div>
                            <div className="mt-1 leading-relaxed text-slate-800">
                              {agentPlanBrief.endpointLabel || agentPlanBrief.targetDefinition || 'Auto-derived from available analysis-ready fields.'}
                            </div>
                          </div>
                        </div>
                        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                          <div className="font-semibold uppercase tracking-wide text-slate-500">Treatment Variable</div>
                          <div className="mt-1 leading-relaxed text-slate-800">
                            {agentPlanBrief.treatmentVariable || 'Auto-detect treatment or arm variable from subject-level data.'}
                          </div>
                        </div>
                        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                          <div className="font-semibold uppercase tracking-wide text-slate-500">Subgroup Factors</div>
                          <div className="mt-1 leading-relaxed text-slate-800">
                            {agentPlanBrief.subgroupFactors.length > 0 ? agentPlanBrief.subgroupFactors.join(', ') : 'No specific subgroup modifiers inferred.'}
                          </div>
                        </div>
                        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                          <div className="font-semibold uppercase tracking-wide text-slate-500">Required Dataset Roles</div>
                          <div className="mt-1 leading-relaxed text-slate-800">
                            {agentPlanBrief.requiredRoles.length > 0 ? agentPlanBrief.requiredRoles.join(', ') : 'No deterministic role set inferred yet.'}
                          </div>
                          {agentPlanBrief.missingRoles.length > 0 && (
                            <div className="mt-2 text-amber-700">
                              Missing: {agentPlanBrief.missingRoles.join(', ')}
                            </div>
                          )}
                        </div>
                        {agentPlanBrief.selectedSources.length > 0 && (
                          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                            <div className="font-semibold uppercase tracking-wide text-slate-500">Selected Sources</div>
                            <div className="mt-1 leading-relaxed text-slate-800">
                              {agentPlanBrief.selectedSources.join(', ')}
                            </div>
                          </div>
                        )}
                        {(agentPlanBrief.timeWindowDays || agentPlanBrief.gradeThreshold || agentPlanBrief.termFilters.length > 0 || agentPlanBrief.cohortFilters.length > 0) && (
                          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                            <div className="font-semibold uppercase tracking-wide text-slate-500">Derived Constraints</div>
                            <div className="mt-1 space-y-1 leading-relaxed text-slate-800">
                              {agentPlanBrief.timeWindowDays ? <div>Time window: {agentPlanBrief.timeWindowDays} days</div> : null}
                              {agentPlanBrief.gradeThreshold ? <div>Grade threshold: Grade {agentPlanBrief.gradeThreshold}+</div> : null}
                              {agentPlanBrief.termFilters.length > 0 ? <div>Term filters: {agentPlanBrief.termFilters.join(', ')}</div> : null}
                              {agentPlanBrief.cohortFilters.length > 0 ? <div>Cohort filters: {agentPlanBrief.cohortFilters.join(', ')}</div> : null}
                            </div>
                          </div>
                        )}
                        {(agentPlanBrief.interactionTerms.length > 0 || agentPlanBrief.requestedOutputs.length > 0) && (
                          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                            <div className="font-semibold uppercase tracking-wide text-slate-500">Planned Outputs</div>
                            <div className="mt-1 space-y-1 leading-relaxed text-slate-800">
                              {agentPlanBrief.interactionTerms.length > 0 ? <div>Interactions: {agentPlanBrief.interactionTerms.join(', ')}</div> : null}
                              {agentPlanBrief.requestedOutputs.length > 0 ? <div>Outputs: {agentPlanBrief.requestedOutputs.join(', ')}</div> : null}
                            </div>
                          </div>
                        )}
                        {agentPlanBrief.assessment && (agentPlanBrief.assessment.dataRequirements.length > 0 || agentPlanBrief.assessment.methodConstraints.length > 0) && (
                          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                            <div className="font-semibold uppercase tracking-wide text-slate-500">Capability Constraints</div>
                            {agentPlanBrief.assessment.dataRequirements.length > 0 && (
                              <div className="mt-2">
                                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Data Requirements</div>
                                <ul className="mt-1 space-y-1 leading-relaxed text-slate-700">
                                  {agentPlanBrief.assessment.dataRequirements.map((item, idx) => (
                                    <li key={`agent-brief-requirement-${idx}`} className="flex items-start">
                                      <div className="mt-1.5 mr-2 h-1.5 w-1.5 rounded-full bg-slate-400" />
                                      <span>{item}</span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            {agentPlanBrief.assessment.methodConstraints.length > 0 && (
                              <div className="mt-3">
                                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Method Constraints</div>
                                <ul className="mt-1 space-y-1 leading-relaxed text-slate-700">
                                  {agentPlanBrief.assessment.methodConstraints.map((item, idx) => (
                                    <li key={`agent-brief-constraint-${idx}`} className="flex items-start">
                                      <div className="mt-1.5 mr-2 h-1.5 w-1.5 rounded-full bg-slate-400" />
                                      <span>{item}</span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </div>
                        )}
                        {agentPlanBrief.notes.length > 0 && (
                          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                            <div className="font-semibold uppercase tracking-wide text-slate-500">Planner Notes</div>
                            <ul className="mt-1 space-y-1 leading-relaxed text-slate-700">
                              {agentPlanBrief.notes.slice(0, 4).map((note, idx) => (
                                <li key={`agent-brief-note-${idx}`} className="flex items-start">
                                  <div className="mt-1.5 mr-2 h-1.5 w-1.5 rounded-full bg-slate-400" />
                                  <span>{note}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-500">
                        The planner did not produce a structured brief for this question yet.
                      </div>
                    )}
                  </>
                )}
                </div>
              )}
              {selectedAgentRunDetail && (
                <div className="mb-4 rounded-xl border border-slate-200 bg-white p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wider text-slate-700">Run Detail</div>
                      <div className="mt-1 text-[11px] leading-relaxed text-slate-500">
                        Focused view of the selected agent run with restore and rerun controls.
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        setSelectedAgentRunDetail(null);
                        setSelectedAgentStepId(null);
                      }}
                      className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-100"
                    >
                      Clear
                    </button>
                  </div>
                  <div className="text-sm font-semibold leading-5 text-slate-800">
                    {selectedAgentRunDetail.question || 'Saved AI Analysis Agent run'}
                  </div>
                  <div className="mt-1 text-[11px] text-slate-500">
                    {formatAgentRunTimestamp(selectedAgentRunDetail.createdAt)} | {selectedAgentRunDetail.analysisFamily}
                  </div>
                  {selectedAgentRunDetail.userSummary?.bottomLine && (
                    <div className="mt-3 rounded-lg border border-indigo-100 bg-indigo-50 px-3 py-2 text-sm leading-relaxed text-indigo-950">
                      {selectedAgentRunDetail.userSummary.bottomLine}
                    </div>
                  )}
                  {selectedAgentRunDetail.selectedSources.length > 0 && (
                    <div className="mt-3 text-[11px] leading-relaxed text-slate-600">
                      Sources: {selectedAgentRunDetail.selectedSources.join(', ')}
                    </div>
                  )}
                  {selectedAgentRunDetail.missingRoles.length > 0 && (
                    <div className="mt-2 text-[11px] leading-relaxed text-amber-700">
                      Still needed: {selectedAgentRunDetail.missingRoles.join(', ')}
                    </div>
                  )}
                  {selectedAgentRunDetail.userSummary?.evidencePoints && selectedAgentRunDetail.userSummary.evidencePoints.length > 0 && (
                    <div className="mt-3">
                      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Evidence</div>
                      <ul className="space-y-1 text-[11px] leading-relaxed text-slate-600">
                        {selectedAgentRunDetail.userSummary.evidencePoints.slice(0, 3).map((point, idx) => (
                          <li key={`${selectedAgentRunDetail.runId}-evidence-${idx}`} className="flex items-start">
                            <div className="mt-1.5 mr-2 h-1.5 w-1.5 rounded-full bg-slate-400" />
                            <span>{point}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
                    {selectedAgentRunDetail.steps.map((step) => (
                      <button
                        key={`${selectedAgentRunDetail.runId}-${step.id}`}
                        onClick={() => setSelectedAgentStepId(step.id)}
                        className={`rounded-lg border px-2 py-2 text-left ${
                          selectedAgentStepId === step.id ? 'border-medical-200 bg-medical-50' : 'border-slate-200 bg-slate-50'
                        }`}
                      >
                        <div className="font-semibold text-slate-700">{step.title}</div>
                        <div className={`mt-1 uppercase tracking-wide ${
                          step.status === 'completed'
                            ? 'text-emerald-700'
                            : step.status === 'failed'
                              ? 'text-red-700'
                              : 'text-slate-500'
                        }`}>
                          {step.status}
                        </div>
                      </button>
                    ))}
                  </div>
                  {selectedAgentRunDetail.steps.find((step) => step.id === selectedAgentStepId) && (
                    <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                      {(() => {
                        const step = selectedAgentRunDetail.steps.find((candidate) => candidate.id === selectedAgentStepId)!;
                        return (
                          <>
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <div className="text-sm font-semibold text-slate-800">{step.title}</div>
                                <div className="mt-1 text-xs leading-relaxed text-slate-600">{step.summary}</div>
                              </div>
                              <div className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                                step.status === 'completed'
                                  ? 'bg-emerald-50 text-emerald-700'
                                  : step.status === 'failed'
                                    ? 'bg-red-50 text-red-700'
                                    : 'bg-slate-100 text-slate-500'
                              }`}>
                                {step.status}
                              </div>
                            </div>
                            {step.details.length > 0 && (
                              <ul className="mt-3 space-y-1 text-[11px] leading-relaxed text-slate-600">
                                {step.details.map((detail, idx) => (
                                  <li key={`${step.id}-detail-${idx}`} className="flex items-start">
                                    <div className="mt-1.5 mr-2 h-1.5 w-1.5 rounded-full bg-slate-400" />
                                    <span>{detail}</span>
                                  </li>
                                ))}
                              </ul>
                            )}
                            {renderAgentStepProvenance(step.provenance, 'compact')}
                            {step.code && (
                              <pre className="mt-3 overflow-x-auto rounded-lg bg-slate-900 p-3 text-[11px] text-slate-100 whitespace-pre-wrap">
                                {step.code}
                              </pre>
                            )}
                            {step.chart && (
                              <div className="mt-3">
                                <Chart data={step.chart.data} layout={step.chart.layout} />
                              </div>
                            )}
                            {step.table && (
                              <div className="mt-3 overflow-hidden rounded-lg border border-slate-200 bg-white">
                                {step.table.title && (
                                  <div className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-semibold text-slate-600">
                                    {step.table.title}
                                  </div>
                                )}
                                <div className="overflow-x-auto">
                                  <table className="min-w-full text-left text-[11px]">
                                    <thead className="bg-slate-50">
                                      <tr>
                                        {step.table.columns.map((column) => (
                                          <th key={`${step.id}-${column}`} className="px-3 py-2 font-semibold text-slate-600">
                                            {column}
                                          </th>
                                        ))}
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {step.table.rows.map((row, rowIndex) => (
                                        <tr key={`${step.id}-detail-row-${rowIndex}`} className="border-t border-slate-100">
                                          {step.table!.columns.map((column) => (
                                            <td key={`${step.id}-detail-${rowIndex}-${column}`} className="px-3 py-2 text-slate-700">
                                              {String(row[column] ?? '')}
                                            </td>
                                          ))}
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            )}
                          </>
                        );
                      })()}
                    </div>
                  )}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      onClick={() => restoreAgentRunSelection(selectedAgentRunDetail)}
                      className="rounded-full border border-medical-200 bg-medical-50 px-2.5 py-1 text-[11px] font-semibold text-medical-700 hover:bg-medical-100"
                    >
                      Restore Files
                    </button>
                    <button
                      onClick={() => void rerunAgentRun(selectedAgentRunDetail.runId)}
                      disabled={activeAgentRunId === selectedAgentRunDetail.runId || isLoading}
                      className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {activeAgentRunId === selectedAgentRunDetail.runId ? 'Rerunning…' : 'Rerun'}
                    </button>
                    <button
                      onClick={() => void reopenAgentRun(selectedAgentRunDetail.runId)}
                      disabled={activeAgentRunId === selectedAgentRunDetail.runId}
                      className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:border-medical-200 hover:bg-medical-50 hover:text-medical-700 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {activeAgentRunId === selectedAgentRunDetail.runId ? 'Opening…' : 'Open In Chat'}
                    </button>
                    <button
                      onClick={() => exportAgentRun(selectedAgentRunDetail.runId, 'ipynb')}
                      className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:border-medical-200 hover:bg-medical-50 hover:text-medical-700"
                    >
                      Notebook
                    </button>
                    <button
                      onClick={() => exportAgentRun(selectedAgentRunDetail.runId, 'html')}
                      className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:border-medical-200 hover:bg-medical-50 hover:text-medical-700"
                    >
                      HTML
                    </button>
                  </div>
                </div>
              )}
              {isAgentToolsOpen && agentToolsTab === 'runs' && (
                <div className="mb-4 rounded-xl border border-slate-200 bg-white p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wider text-slate-700">Recent Agent Runs</div>
                    <div className="mt-1 text-[11px] leading-relaxed text-slate-500">
                      Reopen prior deterministic agent runs, inspect their details, restore files, or rerun them.
                    </div>
                  </div>
                  <button
                    onClick={() => void loadRecentAgentRuns()}
                    disabled={isAgentRunsLoading}
                    className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:border-medical-200 hover:bg-medical-50 hover:text-medical-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isAgentRunsLoading ? 'Loading…' : 'Refresh'}
                  </button>
                </div>
                {agentRunsError && (
                  <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                    {agentRunsError}
                  </div>
                )}
                {agentDetailError && (
                  <div className="mb-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                    {agentDetailError}
                  </div>
                )}
                {!agentRunsError && recentAgentRuns.length === 0 && !isAgentRunsLoading && (
                  <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-500">
                    No saved agent runs yet.
                  </div>
                )}
                {recentAgentRuns.length > 0 && (
                  <div className="space-y-2">
                    {recentAgentRuns.map((run) => (
                      <div key={run.runId} className={`rounded-lg border px-3 py-3 ${
                        selectedAgentRunDetail?.runId === run.runId ? 'border-medical-200 bg-medical-50' : 'border-slate-200 bg-slate-50'
                      }`}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold text-slate-800">{run.question || 'Saved AI Analysis Agent run'}</div>
                            <div className="mt-1 text-[11px] text-slate-500">
                              {formatAgentRunTimestamp(run.createdAt)} | {run.analysisFamily}
                            </div>
                          </div>
                          <span className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                            run.executed ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
                          }`}>
                            {run.executed ? 'Executed' : 'Blocked'}
                          </span>
                        </div>
                        {run.selectedSources.length > 0 && (
                        <div className="mt-2 text-[11px] leading-relaxed text-slate-500">
                          Sources: {run.selectedSources.join(', ')}
                        </div>
                      )}
                        {run.missingRoles.length > 0 && (
                          <div className="mt-2 text-[11px] leading-relaxed text-amber-700">
                            Still needed: {run.missingRoles.join(', ')}
                          </div>
                        )}
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button
                            onClick={() => void viewAgentRunDetail(run.runId)}
                            disabled={activeAgentRunId === run.runId || isAgentDetailLoading}
                            className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {activeAgentRunId === run.runId && isAgentDetailLoading ? 'Loading…' : 'View'}
                          </button>
                          <button
                            onClick={() => void rerunAgentRun(run.runId)}
                            disabled={activeAgentRunId === run.runId || isLoading}
                            className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {activeAgentRunId === run.runId && !isAgentDetailLoading ? 'Rerunning…' : 'Rerun'}
                          </button>
                          <button
                            onClick={() => void reopenAgentRun(run.runId)}
                            disabled={activeAgentRunId === run.runId}
                            className="rounded-full border border-medical-200 bg-medical-50 px-2.5 py-1 text-[11px] font-semibold text-medical-700 hover:bg-medical-100 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {activeAgentRunId === run.runId ? 'Opening…' : 'Open In Chat'}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                </div>
              )}
            </>
          )}
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-slate-700">Source Selection</div>
                <div className="mt-1 text-[11px] leading-relaxed text-slate-500">
                  {selectedFileIds.size}/{docs.length} selected. Keep this collapsed unless you need to curate the source set manually.
                </div>
              </div>
              <button
                onClick={() => setIsSourcesDrawerOpen(true)}
                className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-700 hover:border-medical-200 hover:bg-medical-50 hover:text-medical-700"
              >
                Edit Sources
              </button>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                onClick={clearSelectedSources}
                className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:border-slate-300 hover:bg-slate-100"
              >
                Clear
              </button>
              {recommendation && recommendation.requiredRoles.length > 0 && (
                <button
                  onClick={applyRecommendedSources}
                  className="rounded-full border border-medical-200 bg-medical-50 px-2.5 py-1 text-[11px] font-semibold text-medical-700 hover:bg-medical-100"
                >
                  Use Recommended
                </button>
              )}
            </div>
            {selectedContextFiles.length > 0 && (
              <div className="mt-3 text-[11px] leading-relaxed text-slate-600">
                Active: {selectedContextFiles.slice(0, 3).map((file) => file.name).join(', ')}
                {selectedContextFiles.length > 3 ? ` +${selectedContextFiles.length - 3} more` : ''}
              </div>
            )}
          </div>
        </div>
      </div>
      )}

      {isSourcesDrawerOpen && (
        <>
          <button
            aria-label="Close source drawer"
            onClick={() => setIsSourcesDrawerOpen(false)}
            className="absolute inset-0 z-20 bg-slate-900/20"
          />
          <div className="absolute inset-y-0 left-0 z-40 w-[420px] border-r border-slate-200 bg-white shadow-2xl">
            <div className="flex h-full flex-col">
              <div className="flex items-center justify-between border-b border-slate-200 px-4 py-4">
                <div>
                  <div className="text-sm font-semibold text-slate-800">Edit Sources</div>
                  <div className="mt-1 text-[11px] leading-relaxed text-slate-500">
                    Choose datasets and documents, then close this panel to keep the main workspace focused.
                  </div>
                </div>
                <button
                  onClick={() => setIsSourcesDrawerOpen(false)}
                  className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-100"
                >
                  Close
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-4">
                <div className="flex items-center justify-between gap-3 mb-2">
                  <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Available Sources</div>
                  <div className="text-[11px] text-slate-400">
                    {selectedFileIds.size}/{docs.length} selected
                  </div>
                </div>
                {docs.length > 0 && (
                  <div className="mb-3 flex flex-wrap gap-2">
                    <button
                      onClick={selectAllSources}
                      className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:border-medical-200 hover:bg-medical-50 hover:text-medical-700"
                    >
                      Select All
                    </button>
                    <button
                      onClick={clearSelectedSources}
                      className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:border-slate-300 hover:bg-slate-100"
                    >
                      Clear
                    </button>
                    <button
                      onClick={() => selectSourcesByType([DataType.RAW, DataType.STANDARDIZED])}
                      className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:border-medical-200 hover:bg-medical-50 hover:text-medical-700"
                    >
                      Datasets Only
                    </button>
                    <button
                      onClick={() => selectSourcesByType([DataType.DOCUMENT])}
                      className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:border-medical-200 hover:bg-medical-50 hover:text-medical-700"
                    >
                      Documents Only
                    </button>
                    {recommendation && recommendation.requiredRoles.length > 0 && (
                      <button
                        onClick={applyRecommendedSources}
                        className="rounded-full border border-medical-200 bg-medical-50 px-2.5 py-1 text-[11px] font-semibold text-medical-700 hover:bg-medical-100"
                      >
                        Use Recommended Files
                      </button>
                    )}
                  </div>
                )}
                {recommendation && recommendation.requiredRoles.length > 0 && (
                  <div className="mb-3 rounded-xl border border-medical-100 bg-medical-50/60 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="text-xs font-semibold uppercase tracking-wider text-medical-700">Recommended For This Question</div>
                <div className="text-[11px] text-medical-600">
                  {recommendedFileIds.size} file{recommendedFileIds.size === 1 ? '' : 's'} suggested
                </div>
              </div>
              <div className="space-y-1.5 text-xs text-slate-700">
                <div className={`rounded-lg border px-3 py-2 ${supportStatusClass(recommendation.supportAssessment.status)}`}>
                  <div className="text-[11px] font-semibold uppercase tracking-wide">
                    {recommendation.supportAssessment.status === 'READY'
                      ? 'Likely answerable'
                      : recommendation.supportAssessment.status === 'PARTIAL'
                        ? 'Partially supported'
                        : 'Not enough data yet'}
                  </div>
                  <div className="mt-1 text-xs leading-relaxed">{recommendation.supportAssessment.summary}</div>
                </div>
                {recommendation.requiredRoles.map((role) => {
                  const file = recommendation.selectedByRole[role];
                  const alternatives = recommendation.alternativesByRole[role] || [];
                  return (
                    <div key={role} className="leading-relaxed">
                      <span className="font-semibold text-slate-800">{ROLE_LABELS[role]}:</span>{' '}
                      {file ? (
                        <>
                          <span>{file.name}</span>
                          {recommendation.confidenceByFileId[file.id] && (
                            <span className={`ml-1 inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${confidenceBadgeClass(recommendation.confidenceByFileId[file.id])}`}>
                              {recommendation.confidenceByFileId[file.id]} confidence
                            </span>
                          )}
                          {alternatives.length > 1 && (
                            <span className="text-slate-500"> ({alternatives.length - 1} alternative{alternatives.length - 1 === 1 ? '' : 's'} found)</span>
                          )}
                        </>
                      ) : (
                        <span className="text-amber-700">no good match found</span>
                      )}
                    </div>
                  );
                })}
                {recommendation.optionalRoles.length > 0 && (
                  <div className="pt-1 text-[11px] text-slate-500">
                    Optional if available: {recommendation.optionalRoles.map((role) => ROLE_LABELS[role]).join(', ')}
                  </div>
                )}
                {recommendation.missingRequiredRoles.length > 0 && (
                  <div className="pt-1 text-[11px] text-amber-700">
                    Still missing: {recommendation.missingRequiredRoles.map((role) => ROLE_LABELS[role]).join(', ')}
                  </div>
                )}
                <div className="pt-1 text-[11px] text-slate-500">
                  The app prefers one best file per dataset type and leaves likely duplicates unselected.
                </div>
                {recommendation.supportAssessment.checks.length > 0 && (
                  <div className="pt-2">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1">
                      Readiness checks
                    </div>
                    <div className="space-y-1 text-[11px]">
                      {recommendation.supportAssessment.checks.map((check, index) => (
                        <div key={`${check.label}-${index}`} className="leading-relaxed">
                          <span className={`font-semibold ${supportCheckClass(check.status)}`}>
                            {check.status === 'MET' ? 'Ready' : check.status === 'PARTIAL' ? 'Partial' : 'Missing'}:
                          </span>{' '}
                          <span className="text-slate-700">{check.label}</span>
                          <div className="text-slate-500">{check.detail}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
                  </div>
                )}
                {input.trim() && docs.length > 0 && (
                  <div className="mb-3 rounded-xl border border-indigo-100 bg-indigo-50/60 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wider text-indigo-700">AI Planning Assist</div>
                  <div className="mt-1 text-[11px] leading-relaxed text-slate-500">
                    Uses AI to interpret the question and selected file metadata, then suggests which files and predictor families are most relevant.
                  </div>
                </div>
                <button
                  onClick={handleGeneratePlanningAssist}
                  disabled={isPlanningAssistLoading}
                  className="rounded-full border border-indigo-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isPlanningAssistLoading ? 'Generating…' : 'Generate AI Assist'}
                </button>
              </div>
              {planningAssistError && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  {planningAssistError}
                </div>
              )}
              {planningAssist && (
                <div className="space-y-2 text-xs text-slate-700">
                  <div className="rounded-lg border border-indigo-100 bg-white px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-slate-800">AI read of the question</span>
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                        planningAssist.confidence === 'HIGH'
                          ? 'bg-emerald-50 text-emerald-700'
                          : planningAssist.confidence === 'LOW'
                            ? 'bg-red-50 text-red-700'
                            : 'bg-amber-50 text-amber-700'
                      }`}>
                        {planningAssist.confidence.toLowerCase()} confidence
                      </span>
                    </div>
                    <div className="mt-1 leading-relaxed">{planningAssist.questionIntentSummary}</div>
                  </div>
                  {planningAssist.requiredRoles.length > 0 && (
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Likely required dataset types</div>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {planningAssist.requiredRoles.map((role) => (
                          <span key={role} className="rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-semibold text-indigo-700">{role}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {planningAssist.predictorFamiliesNeeded.length > 0 && (
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Predictor families needed</div>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {planningAssist.predictorFamiliesNeeded.map((family) => (
                          <span key={family} className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-700">{family}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {planningAssist.recommendedFileNames.length > 0 && (
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">AI-recommended files</div>
                      <ul className="mt-1 list-disc space-y-1 pl-4">
                        {planningAssist.recommendedFileNames.map((name) => (
                          <li key={name}>{name}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {planningAssist.whyTheseFiles.length > 0 && (
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Why these files</div>
                      <ul className="mt-1 list-disc space-y-1 pl-4">
                        {planningAssist.whyTheseFiles.map((item, index) => (
                          <li key={`${item}-${index}`}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {planningAssist.keyRisks.length > 0 && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-amber-800">AI-noted risks</div>
                      <ul className="mt-1 list-disc space-y-1 pl-4 text-amber-800">
                        {planningAssist.keyRisks.map((risk, index) => (
                          <li key={`${risk}-${index}`}>{risk}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
                  </div>
                )}
                {selectedContextFiles.length > 0 && (
                  <div className="mb-3 rounded-xl border border-emerald-100 bg-emerald-50/60 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wider text-emerald-700">Explore Questions</div>
                  <div className="mt-1 text-[11px] leading-relaxed text-slate-500">
                    Let AI scan the selected source metadata and propose distinct clinical questions you can run next.
                  </div>
                </div>
                <button
                  onClick={handleGenerateExplorationSuggestions}
                  disabled={isExplorationSuggestionsLoading}
                  className="rounded-full border border-emerald-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isExplorationSuggestionsLoading ? 'Generating…' : 'Suggest Questions'}
                </button>
              </div>
              {explorationSuggestionsError && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  {explorationSuggestionsError}
                </div>
              )}
              {explorationSuggestions.length > 0 && (
                <div className="space-y-2">
                  {explorationSuggestions.map((suggestion, index) => (
                    <button
                      key={`${suggestion.question}-${index}`}
                      onClick={() => handleRunSuggestedQuestion(suggestion)}
                      disabled={isLoading}
                      className="w-full rounded-lg border border-emerald-100 bg-white px-3 py-3 text-left hover:border-emerald-200 hover:bg-emerald-50/50 disabled:opacity-60"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="text-sm font-semibold leading-5 text-slate-800">{suggestion.question}</div>
                        <div className="flex shrink-0 items-center gap-1">
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${suggestionSupportClass(suggestion.supportStatus)}`}>
                            {suggestion.supportStatus.toLowerCase()}
                          </span>
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                            suggestion.confidence === 'HIGH'
                              ? 'bg-emerald-50 text-emerald-700'
                              : suggestion.confidence === 'LOW'
                                ? 'bg-red-50 text-red-700'
                                : 'bg-amber-50 text-amber-700'
                          }`}>
                            {suggestion.confidence.toLowerCase()}
                          </span>
                        </div>
                      </div>
                      <div className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-700">
                        {suggestion.analysisFamily}
                      </div>
                      <div className="mt-1 text-xs leading-relaxed text-slate-600">{suggestion.rationale}</div>
                      <div className="mt-2 text-[11px] leading-relaxed text-slate-500">
                        {suggestion.supportSummary}
                      </div>
                      {suggestion.recommendedFileNames.length > 0 && (
                        <div className="mt-2 text-[11px] leading-relaxed text-slate-500">
                          Using: <span className="font-medium text-slate-700">{suggestion.recommendedFileNames.join(', ')}</span>
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              )}
              {pendingSuggestedQuestion && (
                <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-amber-800">
                    Partial Question Confirmation
                  </div>
                  <div className="mt-1 text-sm font-semibold leading-5 text-slate-800">
                    {pendingSuggestedQuestion.question}
                  </div>
                  <div className="mt-2 text-xs leading-relaxed text-slate-700">
                    This suggested question can run, but the current files only partially support it.
                    You may still continue for an exploratory answer, or cancel and choose a stronger suggestion.
                  </div>
                  <div className="mt-2 text-[11px] leading-relaxed text-slate-600">
                    {pendingSuggestedQuestion.supportSummary}
                  </div>
                  {pendingSuggestedQuestion.recommendedFileNames.length > 0 && (
                    <div className="mt-2 text-[11px] leading-relaxed text-slate-600">
                      Using: <span className="font-medium text-slate-700">{pendingSuggestedQuestion.recommendedFileNames.join(', ')}</span>
                    </div>
                  )}
                  <div className="mt-3 flex items-center gap-2">
                    <button
                      onClick={() => executeSuggestedQuestion(pendingSuggestedQuestion.question)}
                      disabled={isLoading}
                      className="rounded-full bg-amber-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Continue Anyway
                    </button>
                    <button
                      onClick={() => setPendingSuggestedQuestion(null)}
                      disabled={isLoading}
                      className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
                  </div>
                )}
                {docs.map(doc => (
                  <div 
                    key={doc.id} 
                    onClick={() => toggleFileSelection(doc.id)}
                    className={`flex items-start space-x-3 p-2 rounded cursor-pointer transition-colors ${
                      selectedFileIds.has(doc.id) ? 'bg-medical-50 border border-medical-200' : 'hover:bg-slate-100 border border-transparent'
                    }`}
                  >
                    <div className={`mt-0.5 w-4 h-4 border rounded flex items-center justify-center transition-colors ${
                      selectedFileIds.has(doc.id) ? 'bg-medical-600 border-medical-600' : 'border-slate-300 bg-white'
                    }`}>
                      {selectedFileIds.has(doc.id) && <CheckSquare className="w-3 h-3 text-white" />}
                    </div>
                    <div className="flex-1 overflow-hidden">
                      <div className="text-sm font-medium text-slate-700 truncate">{doc.name}</div>
                      <div className="text-xs text-slate-500">{doc.type} • {doc.size}</div>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                          {fileProfiles.get(doc.id)?.shortLabel || 'Clinical'}
                        </span>
                        {recommendedRoleByFileId.has(doc.id) && (
                          <span className="rounded-full bg-medical-100 px-2 py-0.5 text-[10px] font-semibold text-medical-700">
                            Recommended: {ROLE_LABELS[recommendedRoleByFileId.get(doc.id)!]}
                          </span>
                        )}
                        {!recommendedRoleByFileId.has(doc.id) && alternativeRoleByFileId.has(doc.id) && (
                          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                            Alternative: {ROLE_LABELS[alternativeRoleByFileId.get(doc.id)!]}
                          </span>
                        )}
                        {recommendation?.confidenceByFileId[doc.id] && (
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${confidenceBadgeClass(recommendation.confidenceByFileId[doc.id])}`}>
                            {recommendation.confidenceByFileId[doc.id]} confidence
                          </span>
                        )}
                      </div>
                      {recommendedRoleByFileId.has(doc.id) && recommendation?.rationaleByFileId[doc.id] && (
                        <div className="mt-1 text-[11px] leading-relaxed text-slate-500">
                          {recommendation.rationaleByFileId[doc.id]}
                        </div>
                      )}
                      {!recommendedRoleByFileId.has(doc.id) && recommendation?.whyNotSelectedByFileId[doc.id] && (
                        <div className="mt-1 text-[11px] leading-relaxed text-slate-500">
                          {recommendation.whyNotSelectedByFileId[doc.id]}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                {docs.length === 0 && <div className="text-sm text-slate-400 italic">No documents available. Upload in Ingestion tab.</div>}
              </div>
            </div>
          </div>
        </>
      )}

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col">
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {messages.map((msg, index) => {
            const agentRun = normalizeAgentRun(msg.agentRun);
            const blockedMissingRoles = agentRun?.missingRoles || [];
            const insightSections: InsightSections | null = agentRun
              ? (agentRun.userSummary
                  ? {
                      directAnswer: agentRun.userSummary.bottomLine,
                      supportingPoints: agentRun.userSummary.evidencePoints,
                      potentialHypotheses: agentRun.userSummary.potentialHypotheses,
                      recommendedFollowUp: agentRun.userSummary.recommendedFollowUp,
                      limitations: agentRun.userSummary.limitations,
                      nextSteps: agentRun.userSummary.nextStep ? [agentRun.userSummary.nextStep] : [],
                      contextNotes: agentRun.userSummary.contextNote ? [agentRun.userSummary.contextNote] : [],
                    }
                  : null)
              : splitInsightSections(msg.keyInsights);
            return (
            <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-3xl flex items-start space-x-3 ${msg.role === 'user' ? 'flex-row-reverse space-x-reverse' : ''}`}>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                  msg.role === 'user' ? 'bg-slate-700 text-white' : 'bg-medical-600 text-white'
                }`}>
                  {msg.role === 'user' ? <User className="w-5 h-5" /> : <Bot className="w-5 h-5" />}
                </div>
                <div className={`p-4 rounded-2xl w-full ${
                  msg.role === 'user' 
                    ? 'bg-slate-100 text-slate-800 rounded-tr-none' 
                    : 'bg-white border border-slate-200 text-slate-800 rounded-tl-none shadow-sm'
                }`}>
                  {msg.role === 'model' && msg.responseModeBadge && (
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      <div className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${responseBadgeClass(msg.responseModeBadge.tone)}`}>
                        {msg.responseModeBadge.label}
                      </div>
                      {msg.responseModeBadge.autoRouted && (
                        <div className="rounded-full border border-medical-200 bg-medical-50 px-2.5 py-1 text-[11px] font-semibold text-medical-700">
                          Auto-routed to agent
                        </div>
                      )}
                      {msg.responseModeBadge.detail && (
                        <div className="text-[11px] leading-relaxed text-slate-500">
                          {msg.responseModeBadge.detail}
                        </div>
                      )}
                    </div>
                  )}
                  {(!agentRun || agentRun.executed) && (
                    <div className="text-sm leading-relaxed font-sans">{renderFormattedMessage(msg.content)}</div>
                  )}

                  {agentRun && (
                    <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
                      <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-100 px-4 py-2">
                        <div className="flex items-center gap-2">
                          <Cpu className="w-4 h-4 text-slate-700" />
                          <div className="text-sm font-semibold text-slate-800">AI Analysis Agent Run</div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => exportAgentRun(agentRun.runId, 'ipynb')}
                            className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:border-medical-200 hover:bg-medical-50 hover:text-medical-700"
                          >
                            Notebook
                          </button>
                          <button
                            onClick={() => exportAgentRun(agentRun.runId, 'html')}
                            className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:border-medical-200 hover:bg-medical-50 hover:text-medical-700"
                          >
                            HTML
                          </button>
                          <div className={`text-[11px] font-semibold uppercase tracking-wide ${
                            agentRun.executed ? 'text-slate-500' : 'text-amber-700'
                          }`}>
                            {agentRun.executed ? 'Executed' : 'Execution Blocked'}
                          </div>
                        </div>
                      </div>
                      <div className="space-y-3 p-4">
                        <div className="text-xs leading-relaxed text-slate-600">
                          {agentRun.question && (
                            <>
                              <span className="font-semibold text-slate-800">Question:</span> {agentRun.question}
                              <br />
                            </>
                          )}
                          <span className="font-semibold text-slate-800">Family:</span> {agentRun.analysisFamily}
                          {agentRun.createdAt && (
                            <>
                              {' '}| <span className="font-semibold text-slate-800">Saved:</span> {formatAgentRunTimestamp(agentRun.createdAt)}
                            </>
                          )}
                          {agentRun.selectedSources.length > 0 && (
                            <>
                              {' '}| <span className="font-semibold text-slate-800">Sources:</span> {agentRun.selectedSources.join(', ')}
                            </>
                          )}
                        </div>
                        {!agentRun.executed && (
                          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                            <div className="text-sm font-semibold text-amber-900">Execution blocked</div>
                            <div className="mt-2 text-sm leading-relaxed text-amber-900">
                              {blockedMissingRoles.length > 0
                                ? `The agent searched the available project datasets but still could not find the required role${blockedMissingRoles.length === 1 ? '' : 's'}: ${blockedMissingRoles.join(', ')}.`
                                : 'The agent stopped before execution because the available datasets still do not satisfy the required deterministic analysis roles.'}
                            </div>
                            <div className="mt-2 text-xs leading-relaxed text-amber-800">
                              Next step: add the missing dataset type or switch to a summary-only chat answer if you only need orientation.
                            </div>
                            <div className="mt-3 flex flex-wrap gap-2">
                              <button
                                onClick={() => applyRecommendedSourcesForQuestion(agentRun.question)}
                                className="rounded-full border border-amber-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-amber-800 hover:bg-amber-100"
                              >
                                Use Recommended Files
                              </button>
                              <button
                                onClick={() => rerunBlockedAgentQuestionInSummaryMode(agentRun.question)}
                                className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:border-medical-200 hover:bg-medical-50 hover:text-medical-700"
                              >
                                Ask In AI Summary Mode
                              </button>
                              <button
                                onClick={() => toggleBlockedRunDetails(agentRun.runId)}
                                className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-100"
                              >
                                {expandedBlockedRunIds.has(agentRun.runId) ? 'Hide Details' : 'Show Details'}
                              </button>
                            </div>
                          </div>
                        )}
                        {(agentRun.executed || expandedBlockedRunIds.has(agentRun.runId)) && agentRun.steps.map((step) => (
                          <div key={step.id} className="rounded-xl border border-slate-200 bg-white p-3">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <div className="text-sm font-semibold text-slate-800">{step.title}</div>
                                <div className="mt-1 text-sm text-slate-600">{step.summary}</div>
                              </div>
                              <div className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                                step.status === 'completed'
                                  ? 'bg-emerald-50 text-emerald-700'
                                  : step.status === 'failed'
                                    ? 'bg-red-50 text-red-700'
                                    : 'bg-slate-100 text-slate-500'
                              }`}>
                                {step.status}
                              </div>
                            </div>
                            {step.details.length > 0 && (
                              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-slate-600">
                                {step.details.map((detail, idx) => (
                                  <li key={`${step.id}-detail-${idx}`}>{detail}</li>
                                ))}
                              </ul>
                            )}
                            {renderAgentStepProvenance(step.provenance, 'default')}
                            {step.code && (
                              <pre className="mt-3 overflow-x-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100 whitespace-pre-wrap">
                                {step.code}
                              </pre>
                            )}
                            {step.chart && (
                              <div className="mt-3">
                                <Chart data={step.chart.data} layout={step.chart.layout} />
                              </div>
                            )}
                            {step.table && (
                              <div className="mt-3 overflow-hidden rounded-lg border border-slate-200">
                                {step.table.title && (
                                  <div className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">
                                    {step.table.title}
                                  </div>
                                )}
                                <table className="min-w-full text-left text-xs">
                                  <thead className="bg-slate-50">
                                    <tr>
                                      {step.table.columns.map((column) => (
                                        <th key={`${step.id}-${column}`} className="px-3 py-2 font-semibold text-slate-600">
                                          {column}
                                        </th>
                                      ))}
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {step.table.rows.map((row, rowIndex) => (
                                      <tr key={`${step.id}-row-${rowIndex}`} className="border-t border-slate-100">
                                        {step.table!.columns.map((column) => (
                                          <td key={`${step.id}-${rowIndex}-${column}`} className="px-3 py-2 text-slate-700">
                                            {String(row[column] ?? '')}
                                          </td>
                                        ))}
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  
                  {/* Chart Rendering */}
                  {msg.chartConfig && (
                    <div className="mt-4 mb-4">
                      <Chart data={msg.chartConfig.data} layout={msg.chartConfig.layout} />
                    </div>
                  )}

                  {msg.tableConfig && (
                    <div className="mt-4 overflow-hidden rounded-xl border border-slate-200">
                      {msg.tableConfig.title && (
                        <div className="border-b border-slate-200 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-700">
                          {msg.tableConfig.title}
                        </div>
                      )}
                      <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-slate-200 text-sm">
                          <thead className="bg-slate-50">
                            <tr>
                              {msg.tableConfig.columns.map((column) => (
                                <th key={column} className="px-4 py-3 text-left font-semibold uppercase tracking-wide text-slate-500">
                                  {column}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 bg-white">
                            {msg.tableConfig.rows.map((row, rowIndex) => (
                              <tr key={rowIndex}>
                                {msg.tableConfig!.columns.map((column) => (
                                  <td key={column} className="px-4 py-3 text-slate-700">
                                    {String(row[column] ?? '')}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Key Takeaways */}
                  {insightSections && (
                    <div className="mt-4 bg-indigo-50 border border-indigo-200 rounded-xl overflow-hidden shadow-sm">
                      <div className="bg-indigo-100 px-4 py-2 border-b border-indigo-200 flex items-center">
                        <Sparkles className="w-4 h-4 mr-2 text-indigo-600" />
                        <h4 className="text-sm font-bold text-indigo-800">
                          Answer And Interpretation
                        </h4>
                      </div>
                      <div className="p-4">
                        <div className="text-sm font-semibold leading-relaxed text-indigo-950">
                          {insightSections.directAnswer}
                        </div>
                        {insightSections.supportingPoints.length > 0 && (
                          <div className="mt-4">
                            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-indigo-700">
                              Supporting points
                            </div>
                            <ul className="space-y-3">
                              {insightSections.supportingPoints.map((insight, idx) => (
                                <li key={idx} className="flex items-start">
                                  <div className="mt-1.5 w-1.5 h-1.5 rounded-full bg-indigo-500 mr-3 flex-shrink-0" />
                                  <span className="text-sm text-indigo-900 leading-relaxed">{insight}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {insightSections.potentialHypotheses.length > 0 && (
                          <div className="mt-4">
                            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-indigo-700">
                              Possible explanations
                            </div>
                            <ul className="space-y-3">
                              {insightSections.potentialHypotheses.map((item, idx) => (
                                <li key={`hypothesis-${idx}`} className="flex items-start">
                                  <div className="mt-1.5 w-1.5 h-1.5 rounded-full bg-indigo-500 mr-3 flex-shrink-0" />
                                  <span className="text-sm text-indigo-900 leading-relaxed">{item}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {insightSections.recommendedFollowUp.length > 0 && (
                          <div className="mt-4">
                            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-indigo-700">
                              Recommended follow-up analyses
                            </div>
                            <ul className="space-y-3">
                              {insightSections.recommendedFollowUp.map((item, idx) => (
                                <li key={`follow-up-${idx}`} className="flex items-start">
                                  <div className="mt-1.5 w-1.5 h-1.5 rounded-full bg-indigo-500 mr-3 flex-shrink-0" />
                                  <span className="text-sm text-indigo-900 leading-relaxed">{item}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {insightSections.limitations.length > 0 && (
                          <div className="mt-4">
                            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-indigo-700">
                              Limitations
                            </div>
                            <ul className="space-y-3">
                              {insightSections.limitations.map((item, idx) => (
                                <li key={`limitation-${idx}`} className="flex items-start">
                                  <div className="mt-1.5 w-1.5 h-1.5 rounded-full bg-indigo-500 mr-3 flex-shrink-0" />
                                  <span className="text-sm text-indigo-900 leading-relaxed">{item}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {insightSections.nextSteps.length > 0 && (
                          <div className="mt-4 rounded-lg border border-indigo-200 bg-white/70 px-3 py-2 text-sm text-indigo-900">
                            <span className="font-semibold">Next step:</span>{' '}
                            {insightSections.nextSteps[0].replace(/^What to do next:\s*/i, '')}
                          </div>
                        )}
                        {insightSections.contextNotes.length > 0 && (
                          <div className="mt-3 text-xs leading-relaxed text-indigo-700">
                            {insightSections.contextNotes.join(' ')}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {msg.citations && msg.citations.length > 0 && (
                    <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <div className="mb-2 flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                        <span>Retrieved Sources</span>
                        <InfoTooltip content="These are the file sections the app relied on most heavily when preparing the answer." />
                      </div>
                      <div className="space-y-2">
                        {msg.citations.map((citation, idx) => (
                          <div key={`${citation.sourceId}-${idx}`} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="text-sm font-medium text-slate-900 break-words">{citation.sourceId}</div>
                                {citation.title && (
                                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mt-0.5">
                                    {citation.title}
                                  </div>
                                )}
                              </div>
                              {citation.kind && (
                                <div className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                                  {citation.kind === 'TABULAR_PROFILE'
                                    ? 'Profile'
                                    : citation.kind === 'TABULAR_ROWS'
                                    ? 'Rows'
                                    : 'Doc'}
                                </div>
                              )}
                            </div>
                            <div className="mt-2 text-xs leading-5 text-slate-600 break-all whitespace-pre-wrap">
                              {citation.snippet}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="mt-2 flex items-center justify-end space-x-2">
                    <span className="text-xs text-slate-400">
                      {new Date(msg.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                    </span>
                    {msg.role === 'model' && (
                        <button 
                            onClick={() => exportMessage(msg, index)}
                            className="text-xs flex items-center text-medical-600 hover:text-medical-800 font-medium transition-colors"
                            title="Download Report"
                        >
                            <Download className="w-3 h-3 mr-1" />
                            Report
                        </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )})}
          {isLoading && (
            <div className="flex justify-start">
               <div className="flex items-center space-x-3">
                  <div className="w-8 h-8 rounded-full bg-medical-600 text-white flex items-center justify-center">
                    <Bot className="w-5 h-5" />
                  </div>
                  <div className="bg-white border border-slate-200 p-4 rounded-2xl rounded-tl-none shadow-sm">
                    <div className="flex space-x-1">
                      <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{animationDelay: '0ms'}}></div>
                      <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{animationDelay: '150ms'}}></div>
                      <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{animationDelay: '300ms'}}></div>
                    </div>
                  </div>
               </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Area & Quick Actions */}
        <div className="p-4 border-t border-slate-200 bg-white">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="flex items-center rounded-full border border-slate-200 bg-slate-50 p-1">
              <button
                onClick={() => setMode(AnalysisMode.RAG)}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                  mode === AnalysisMode.RAG ? 'bg-white text-medical-700 shadow-sm' : 'text-slate-500'
                }`}
              >
                AI Chat
              </button>
              <button
                onClick={() => setMode(AnalysisMode.AGENT)}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                  mode === AnalysisMode.AGENT ? 'bg-white text-medical-700 shadow-sm' : 'text-slate-500'
                }`}
              >
                AI Analysis Agent
              </button>
            </div>
            <button
              onClick={() => setIsSourcesDrawerOpen(true)}
              className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-medical-200 hover:bg-medical-50 hover:text-medical-700"
            >
              Sources: {selectedFileIds.size}
            </button>
            <button
              onClick={() => setIsContextDrawerOpen(true)}
              className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-medical-200 hover:bg-medical-50 hover:text-medical-700"
            >
              Tools
            </button>
            <div className="text-[11px] text-slate-500">
              {mode === AnalysisMode.AGENT
                ? 'Deterministic multi-step execution mode.'
                : 'Unified AI chat with automatic context strategy.'}
            </div>
          </div>

          {/* Quick Action Chips */}
          <div className="mb-2 flex items-center justify-between gap-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              {selectedContextFiles.length > 0 ? 'Suggested For Selected Context' : 'Suggested Starting Points'}
            </div>
            <div className="text-[11px] text-slate-400">
              {selectedContextFiles.length > 0
                ? `${selectedContextFiles.length} source${selectedContextFiles.length === 1 ? '' : 's'} selected`
                : 'Select sources to make these suggestions more specific'}
            </div>
          </div>
          <div className="flex flex-wrap gap-2 mb-3">
              {quickActions.map((action, i) => {
                  const ActionIcon = QUICK_ACTION_ICONS[action.icon];
                  return (
                  <button
                    key={i}
                    onClick={() => handleSend(action.prompt)}
                    disabled={isLoading}
                    className="flex items-center px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-full text-xs font-medium text-slate-600 hover:bg-medical-50 hover:border-medical-200 hover:text-medical-700 transition-all disabled:opacity-50"
                  >
                      <ActionIcon className="w-3 h-3 mr-1.5" />
                      {action.label}
                  </button>
              )})}
          </div>

          <div className="max-w-4xl mx-auto relative">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={inputPlaceholder}
              className="w-full pl-4 pr-12 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-medical-500 focus:bg-white resize-none shadow-sm text-sm transition-all"
              rows={1}
              style={{ minHeight: '50px' }}
            />
            <button
              onClick={() => handleSend()}
              disabled={!input.trim() || isLoading}
              className="absolute right-2 top-2 p-2 bg-medical-600 text-white rounded-lg hover:bg-medical-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
          <div className="text-center mt-2">
            <span className="text-[10px] text-slate-400">
              AI generated content can be inaccurate. Verify all clinical outputs.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
