import React from 'react';
import { Loader2, Play } from 'lucide-react';
import { ClinicalFile, StatTestType } from '../types';
import { QuestionPlanningAssist } from '../services/planningAssistService';
import {
  AnalysisRole,
  FileRoleRecommendation,
  QuestionSupportAssessment,
  RecommendationConfidence,
} from '../utils/datasetProfile';
import { InfoTooltip } from './InfoTooltip';

interface HypothesisDraftView {
  id: string;
  question: string;
  enabled: boolean;
  suggestedTestType: StatTestType;
  suggestedVar1: string;
  suggestedVar2: string;
  rationale?: string;
}

interface RunModeView {
  label: string;
  helper: string;
  button: string;
}

interface AutopilotControlPanelProps {
  experienceMode: 'EXPLORE_FAST' | 'RUN_CONFIRMED';
  analysisScope: 'SINGLE_DATASET' | 'LINKED_WORKSPACE';
  analysisMode: 'PACK' | 'SINGLE';
  runMode: RunModeView;
  selectedProtocol: ClinicalFile | null;
  confirmedBlockingReason: string | null;
  analysisQuestion: string;
  defaultQuestion: string;
  packFocusQuestion: string;
  proposedHypotheses: HypothesisDraftView[];
  enabledHypothesesCount: number;
  hypothesisGenerationBlockingReason: string | null;
  hypothesisGenerationError: string | null;
  autopilotRecommendation: FileRoleRecommendation | null;
  activeAutopilotPrompt: string;
  recommendedSupportingFiles: ClinicalFile[];
  planningAssist: QuestionPlanningAssist | null;
  planningAssistError: string | null;
  isPlanningAssistLoading: boolean;
  sourceFiles: ClinicalFile[];
  selectedSourceId: string;
  recommendedSourceFile: ClinicalFile | null;
  supportingSourceFiles: ClinicalFile[];
  selectedSupportingIds: string[];
  referenceFiles: ClinicalFile[];
  selectedReferenceId: string;
  protocolFiles: ClinicalFile[];
  selectedProtocolId: string;
  selectedTargetDomainOption: string;
  targetDomain: string;
  suggestedTargetDomain: string;
  customSynonyms: string;
  generateSasDraft: boolean;
  isRunning: boolean;
  runDisabled: boolean;
  selectedReferenceOptionLabel?: string;
  targetDomainOptions: Array<{ value: string; label: string }>;
  customTargetDomainValue: string;
  roleLabels: Record<string, string>;
  recommendationConfidenceClass: (confidence?: RecommendationConfidence) => string;
  recommendationSupportStatusClass: (status?: QuestionSupportAssessment['status']) => string;
  recommendationSupportCheckClass: (status?: QuestionSupportAssessment['checks'][number]['status']) => string;
  formatVariablesForDisplay: (var1?: string, var2?: string) => string;
  onSetExperienceMode: (mode: 'EXPLORE_FAST' | 'RUN_CONFIRMED') => void;
  onSetAnalysisScope: (scope: 'SINGLE_DATASET' | 'LINKED_WORKSPACE') => void;
  onSetAnalysisMode: (mode: 'PACK' | 'SINGLE') => void;
  onSetAnalysisQuestion: (value: string) => void;
  onSetPackFocusQuestion: (value: string) => void;
  onGeneratePackHypotheses: () => void;
  onToggleHypothesisEnabled: (id: string) => void;
  onUpdateHypothesisQuestion: (id: string, value: string) => void;
  onApplyRecommendedAutopilotFiles: () => void;
  onGeneratePlanningAssist: () => void;
  onSetSelectedSourceId: (id: string) => void;
  onSelectAllSupportingFiles: () => void;
  onClearSupportingFiles: () => void;
  onToggleSupportingFile: (id: string) => void;
  onSetSelectedReferenceId: (id: string) => void;
  onSetSelectedProtocolId: (id: string) => void;
  onSetTargetDomain: (value: string) => void;
  onSetCustomSynonyms: (value: string) => void;
  onSetGenerateSasDraft: (value: boolean) => void;
  onRunAutopilot: () => void;
}

export const AutopilotControlPanel: React.FC<AutopilotControlPanelProps> = ({
  experienceMode,
  analysisScope,
  analysisMode,
  runMode,
  selectedProtocol,
  confirmedBlockingReason,
  analysisQuestion,
  defaultQuestion,
  packFocusQuestion,
  proposedHypotheses,
  enabledHypothesesCount,
  hypothesisGenerationBlockingReason,
  hypothesisGenerationError,
  autopilotRecommendation,
  activeAutopilotPrompt,
  recommendedSupportingFiles,
  planningAssist,
  planningAssistError,
  isPlanningAssistLoading,
  sourceFiles,
  selectedSourceId,
  recommendedSourceFile,
  supportingSourceFiles,
  selectedSupportingIds,
  referenceFiles,
  selectedReferenceId,
  protocolFiles,
  selectedProtocolId,
  selectedTargetDomainOption,
  targetDomain,
  suggestedTargetDomain,
  customSynonyms,
  generateSasDraft,
  isRunning,
  runDisabled,
  targetDomainOptions,
  customTargetDomainValue,
  roleLabels,
  recommendationConfidenceClass,
  recommendationSupportStatusClass,
  recommendationSupportCheckClass,
  formatVariablesForDisplay,
  onSetExperienceMode,
  onSetAnalysisScope,
  onSetAnalysisMode,
  onSetAnalysisQuestion,
  onSetPackFocusQuestion,
  onGeneratePackHypotheses,
  onToggleHypothesisEnabled,
  onUpdateHypothesisQuestion,
  onApplyRecommendedAutopilotFiles,
  onGeneratePlanningAssist,
  onSetSelectedSourceId,
  onSelectAllSupportingFiles,
  onClearSupportingFiles,
  onToggleSupportingFile,
  onSetSelectedReferenceId,
  onSetSelectedProtocolId,
  onSetTargetDomain,
  onSetCustomSynonyms,
  onSetGenerateSasDraft,
  onRunAutopilot,
}) => {
  return (
    <div className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-4">
        <div>
          <h3 className="font-bold text-slate-800">Configuration</h3>
          <p className="text-sm text-slate-500 mt-1">Autopilot saves each completed analysis as a normal Statistical Analysis session.</p>
        </div>

        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">Execution Path</div>
          <div className="inline-flex w-full rounded-xl border border-slate-200 bg-slate-100 p-1">
            <button
              onClick={() => onSetExperienceMode('EXPLORE_FAST')}
              className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
                experienceMode === 'EXPLORE_FAST' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              Explore Fast
            </button>
            <button
              onClick={() => onSetExperienceMode('RUN_CONFIRMED')}
              className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
                experienceMode === 'RUN_CONFIRMED' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              Run Confirmed
            </button>
          </div>
        </div>

        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">Analysis Scope</div>
          <div className="inline-flex w-full rounded-xl border border-slate-200 bg-slate-100 p-1">
            <button
              onClick={() => onSetAnalysisScope('SINGLE_DATASET')}
              className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
                analysisScope === 'SINGLE_DATASET' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              Single Dataset
            </button>
            <button
              onClick={() => onSetAnalysisScope('LINKED_WORKSPACE')}
              disabled={experienceMode === 'RUN_CONFIRMED'}
              className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
                analysisScope === 'LINKED_WORKSPACE' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              } ${experienceMode === 'RUN_CONFIRMED' ? 'cursor-not-allowed opacity-50' : ''}`}
            >
              Linked Workspace
            </button>
          </div>
        </div>

        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">Execution Mode</div>
          <div className="inline-flex w-full rounded-xl border border-slate-200 bg-slate-100 p-1">
            <button
              onClick={() => onSetAnalysisMode('PACK')}
              className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
                analysisMode === 'PACK' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              Analysis Pack
            </button>
            <button
              onClick={() => onSetAnalysisMode('SINGLE')}
              disabled={experienceMode === 'RUN_CONFIRMED'}
              className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
                analysisMode === 'SINGLE' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              } ${experienceMode === 'RUN_CONFIRMED' ? 'cursor-not-allowed opacity-50' : ''}`}
            >
              One Question
            </button>
          </div>
        </div>

        {experienceMode === 'RUN_CONFIRMED' ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
            <div className="mb-1 flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-emerald-700">
              <span>Run Confirmed Checklist</span>
              <InfoTooltip content="Run Confirmed is for controlled, reviewable analysis based on a protocol or pre-specified plan." />
            </div>
            <div className="text-sm font-semibold text-slate-800">{runMode.label}</div>
            <div className="text-sm text-slate-600 mt-1">{runMode.helper}</div>
            <ul className="mt-3 space-y-2 text-sm text-slate-700">
              <li className="flex items-start gap-2">
                <span className={`mt-0.5 h-2.5 w-2.5 rounded-full ${selectedProtocol ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                <span>{selectedProtocol ? `Protocol selected: ${selectedProtocol.name}` : 'Select a Protocol or SAP document.'}</span>
              </li>
              <li className="flex items-start gap-2">
                <span className={`mt-0.5 h-2.5 w-2.5 rounded-full ${analysisMode === 'PACK' ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                <span>Run Confirmed uses Analysis Pack only.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className={`mt-0.5 h-2.5 w-2.5 rounded-full ${analysisScope === 'SINGLE_DATASET' ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                <span>Run Confirmed currently supports single-dataset protocol-driven runs.</span>
              </li>
            </ul>
            {confirmedBlockingReason && (
              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                {confirmedBlockingReason}
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-xl border border-indigo-100 bg-indigo-50 p-4">
            <div className="mb-1 flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-indigo-600">
              <span>Explore Fast</span>
              <InfoTooltip content="Best for quick exploratory analysis and idea generation. Results may need follow-up validation." />
            </div>
            <div className="text-sm font-semibold text-slate-800">{runMode.label}</div>
            <div className="text-sm text-slate-600 mt-1">{runMode.helper}</div>
          </div>
        )}

        {analysisMode === 'SINGLE' ? (
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase mb-2">Analysis Question</label>
            <textarea
              value={analysisQuestion}
              onChange={(e) => onSetAnalysisQuestion(e.target.value)}
              rows={4}
              className="w-full p-2.5 rounded-lg border border-slate-300 bg-slate-50 text-sm"
              placeholder={`Example: ${defaultQuestion}`}
            />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Exploration Goal (Optional)</div>
              <div className="text-sm text-slate-600 mb-3">
                Describe what kind of hypotheses you want the pack to prioritize. Leave blank for a broad exploratory pack.
              </div>
              <textarea
                value={packFocusQuestion}
                onChange={(e) => onSetPackFocusQuestion(e.target.value)}
                rows={3}
                className="w-full p-2.5 rounded-lg border border-slate-300 bg-white text-sm"
                placeholder="Example: Prioritize early dermatologic signals, treatment-arm differences, and baseline lab predictors."
              />
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-indigo-700">Proposed Hypotheses</div>
                  <div className="text-sm text-slate-600 mt-1">
                    Generate 4-6 distinct candidate questions, review them, then run only the ones you keep enabled.
                  </div>
                </div>
                <button
                  onClick={onGeneratePackHypotheses}
                  disabled={Boolean(hypothesisGenerationBlockingReason)}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                    hypothesisGenerationBlockingReason
                      ? 'border border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed'
                      : 'border border-indigo-200 bg-white text-indigo-700 hover:bg-indigo-50'
                  }`}
                  title={hypothesisGenerationBlockingReason || 'Generate a distinct hypothesis pack'}
                >
                  {hypothesisGenerationBlockingReason
                    ? 'Complete setup first'
                    : proposedHypotheses.length > 0
                      ? 'Refresh Hypotheses'
                      : 'Generate Hypotheses'}
                </button>
              </div>

              {hypothesisGenerationBlockingReason && (
                <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900">
                  <div className="font-semibold">To enable hypothesis generation</div>
                  <div className="mt-1">{hypothesisGenerationBlockingReason}</div>
                  <ul className="mt-2 list-disc pl-5 space-y-1 text-xs text-amber-800">
                    <li>Choose a primary source dataset below.</li>
                    {analysisScope === 'LINKED_WORKSPACE' && <li>Add at least one supporting dataset to build the linked workspace.</li>}
                  </ul>
                </div>
              )}

              {hypothesisGenerationError && (
                <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {hypothesisGenerationError}
                </div>
              )}

              {proposedHypotheses.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-300 bg-white px-3 py-4 text-sm text-slate-500">
                  Generate a hypothesis pack to review the distinct questions Autopilot plans to run.
                </div>
              ) : (
                <div className="space-y-3">
                  {proposedHypotheses.map((hypothesis, index) => (
                    <div
                      key={hypothesis.id}
                      className={`rounded-xl border px-3 py-3 ${
                        hypothesis.enabled ? 'border-indigo-200 bg-white' : 'border-slate-200 bg-slate-100/80'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          checked={hypothesis.enabled}
                          onChange={() => onToggleHypothesisEnabled(hypothesis.id)}
                          className="mt-1 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2 mb-2">
                            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Hypothesis {index + 1}</span>
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                              {hypothesis.suggestedTestType}
                            </span>
                          </div>
                          <textarea
                            value={hypothesis.question}
                            onChange={(e) => onUpdateHypothesisQuestion(hypothesis.id, e.target.value)}
                            rows={3}
                            className="w-full rounded-lg border border-slate-300 bg-slate-50 p-2.5 text-sm text-slate-800"
                          />
                          <div className="mt-2 text-xs text-slate-500">
                            Suggested variables: <span className="font-medium text-slate-700">{formatVariablesForDisplay(hypothesis.suggestedVar1, hypothesis.suggestedVar2)}</span>
                          </div>
                          {hypothesis.rationale && <div className="mt-1 text-xs leading-relaxed text-slate-500">{hypothesis.rationale}</div>}
                        </div>
                      </div>
                    </div>
                  ))}
                  <div className="text-xs text-slate-500">
                    {enabledHypothesesCount} of {proposedHypotheses.length} hypotheses enabled for execution.
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {autopilotRecommendation && autopilotRecommendation.requiredRoles.length > 0 && activeAutopilotPrompt && (
          <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 p-4">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-indigo-700">
                {analysisMode === 'SINGLE' ? 'Recommended For This Question' : 'Recommended For This Goal'}
              </div>
              <button
                onClick={onApplyRecommendedAutopilotFiles}
                className="rounded-full border border-indigo-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-50"
              >
                Use Recommended Files
              </button>
            </div>
            <div className="space-y-1.5 text-sm text-slate-700">
              <div className={`rounded-lg border px-3 py-2 text-xs ${recommendationSupportStatusClass(autopilotRecommendation.supportAssessment.status)}`}>
                <div className="font-semibold uppercase tracking-wide">
                  {autopilotRecommendation.supportAssessment.status === 'READY'
                    ? 'Likely answerable'
                    : autopilotRecommendation.supportAssessment.status === 'PARTIAL'
                      ? 'Partially supported'
                      : 'Not enough data yet'}
                </div>
                <div className="mt-1 leading-relaxed">{autopilotRecommendation.supportAssessment.summary}</div>
              </div>
              {autopilotRecommendation.requiredRoles.map((role) => {
                const file = autopilotRecommendation.selectedByRole[role];
                const alternatives = autopilotRecommendation.alternativesByRole[role] || [];
                return (
                  <div key={role}>
                    <span className="font-semibold text-slate-800">{roleLabels[role] || role}:</span>{' '}
                    {file ? (
                      <>
                        {file.name}
                        {autopilotRecommendation.confidenceByFileId[file.id] && (
                          <span className={`ml-1 inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${recommendationConfidenceClass(autopilotRecommendation.confidenceByFileId[file.id])}`}>
                            {autopilotRecommendation.confidenceByFileId[file.id]} confidence
                          </span>
                        )}
                        {alternatives.length > 1 && (
                          <span className="text-slate-500"> ({alternatives.length - 1} alternative{alternatives.length - 1 === 1 ? '' : 's'})</span>
                        )}
                      </>
                    ) : (
                      <span className="text-amber-700">no good match found</span>
                    )}
                    {file && autopilotRecommendation.rationaleByFileId[file.id] && (
                      <div className="mt-1 text-xs leading-relaxed text-slate-500">{autopilotRecommendation.rationaleByFileId[file.id]}</div>
                    )}
                  </div>
                );
              })}
              {autopilotRecommendation.optionalRoles.length > 0 && (
                <div className="pt-1 text-xs text-slate-500">
                  Optional if available: {autopilotRecommendation.optionalRoles.map((role) => roleLabels[role] || role).join(', ')}
                </div>
              )}
              {autopilotRecommendation.missingRequiredRoles.length > 0 && (
                <div className="pt-1 text-xs text-amber-700">
                  Still missing: {autopilotRecommendation.missingRequiredRoles.map((role) => roleLabels[role] || role).join(', ')}
                </div>
              )}
              {recommendedSupportingFiles.length > 0 && (
                <div className="pt-1 text-xs text-slate-500">
                  Supporting files that will also be selected: {recommendedSupportingFiles.map((file) => file.name).join(', ')}.
                </div>
              )}
              {autopilotRecommendation.supportAssessment.checks.length > 0 && (
                <div className="pt-2">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1">Readiness checks</div>
                  <div className="space-y-1 text-xs">
                    {autopilotRecommendation.supportAssessment.checks.map((check, index) => (
                      <div key={`${check.label}-${index}`} className="leading-relaxed">
                        <span className={`font-semibold ${recommendationSupportCheckClass(check.status)}`}>
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

        {activeAutopilotPrompt && sourceFiles.length > 0 && (
          <div className="rounded-xl border border-violet-100 bg-violet-50/60 p-4">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-violet-700">AI Planning Assist</div>
                <div className="mt-1 text-[11px] leading-relaxed text-slate-500">
                  Uses AI to interpret the question and file metadata, then suggests which roles, predictors, and files are most relevant before execution.
                </div>
              </div>
              <button
                onClick={onGeneratePlanningAssist}
                disabled={isPlanningAssistLoading}
                className="rounded-full border border-violet-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-violet-700 hover:bg-violet-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isPlanningAssistLoading ? 'Generating…' : 'Generate AI Assist'}
              </button>
            </div>
            {planningAssistError && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{planningAssistError}</div>}
            {planningAssist && (
              <div className="space-y-2 text-xs text-slate-700">
                <div className="rounded-lg border border-violet-100 bg-white px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-slate-800">AI read of the question</span>
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                        planningAssist.confidence === 'HIGH'
                          ? 'bg-emerald-50 text-emerald-700'
                          : planningAssist.confidence === 'LOW'
                            ? 'bg-red-50 text-red-700'
                            : 'bg-amber-50 text-amber-700'
                      }`}
                    >
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
                        <span key={role} className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold text-violet-700">{role}</span>
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

        <div>
          <label className="block text-xs font-semibold text-slate-500 uppercase mb-2">Source Dataset</label>
          <select
            value={selectedSourceId}
            onChange={(e) => onSetSelectedSourceId(e.target.value)}
            className="w-full p-2.5 rounded-lg border border-slate-300 bg-slate-50 text-sm"
          >
            <option value="">-- Select dataset --</option>
            {sourceFiles.map((file) => (
              <option key={file.id} value={file.id}>
                {file.name} ({file.type})
              </option>
            ))}
          </select>
          {recommendedSourceFile && activeAutopilotPrompt && (
            <p className="mt-2 text-xs text-slate-500">
              Recommended primary file: <span className="font-medium text-slate-700">{recommendedSourceFile.name}</span>
            </p>
          )}
        </div>

        {analysisScope === 'LINKED_WORKSPACE' && (
          <div>
            <div className="flex items-center justify-between gap-3 mb-2">
              <div className="flex items-center gap-1">
                <label className="block text-xs font-semibold text-slate-500 uppercase">Supporting Datasets</label>
                <InfoTooltip content="Optional additional datasets used to build one joined analysis table across subject-level domains." />
              </div>
              <div className="text-[11px] text-slate-400">
                {selectedSupportingIds.length}/{supportingSourceFiles.length} selected
              </div>
            </div>
            {supportingSourceFiles.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-2">
                <button
                  onClick={onSelectAllSupportingFiles}
                  className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700"
                >
                  Select All
                </button>
                <button
                  onClick={onClearSupportingFiles}
                  className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:border-slate-300 hover:bg-slate-100"
                >
                  Clear
                </button>
              </div>
            )}
            <div className="rounded-xl border border-slate-200 bg-slate-50 max-h-52 overflow-y-auto divide-y divide-slate-200">
              {supportingSourceFiles.length === 0 ? (
                <div className="p-3 text-sm text-slate-500">Choose a source dataset first to unlock supporting datasets.</div>
              ) : (
                supportingSourceFiles.map((file) => (
                  <label key={file.id} className="flex items-start gap-3 p-3 cursor-pointer hover:bg-white">
                    <input
                      type="checkbox"
                      checked={selectedSupportingIds.includes(file.id)}
                      onChange={() => onToggleSupportingFile(file.id)}
                      className="mt-1 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-slate-800 break-words">{file.name}</div>
                      <div className="text-xs text-slate-500">{file.type}</div>
                    </div>
                  </label>
                ))
              )}
            </div>
            <div className="mt-2 text-xs text-slate-500">
              Linked workspace mode creates a subject-level analysis table using shared subject identifiers such as `USUBJID`.
            </div>
          </div>
        )}

        <div>
          <div className="mb-2 flex items-center gap-1">
            <label className="block text-xs font-semibold text-slate-500 uppercase">Reference Mapping (Optional)</label>
            <InfoTooltip content="An optional mapping file that helps standardize source columns into a known clinical structure." />
          </div>
          <select
            value={selectedReferenceId}
            onChange={(e) => onSetSelectedReferenceId(e.target.value)}
            className="w-full p-2.5 rounded-lg border border-slate-300 bg-slate-50 text-sm"
          >
            <option value="">-- None --</option>
            {referenceFiles.map((file) => (
              <option key={file.id} value={file.id}>
                {file.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <div className="mb-2 flex items-center gap-1">
            <label className="block text-xs font-semibold text-slate-500 uppercase">
              Protocol/SAP {experienceMode === 'RUN_CONFIRMED' ? '(Required)' : '(Optional)'}
            </label>
            <InfoTooltip content="An optional protocol or statistical analysis plan document used to guide or constrain the analysis." />
          </div>
          <select
            value={selectedProtocolId}
            onChange={(e) => onSetSelectedProtocolId(e.target.value)}
            className="w-full p-2.5 rounded-lg border border-slate-300 bg-slate-50 text-sm"
          >
            <option value="">-- None --</option>
            {protocolFiles.map((file) => (
              <option key={file.id} value={file.id}>
                {file.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <div className="mb-2 flex items-center gap-1">
            <label className="block text-xs font-semibold text-slate-500 uppercase">Primary Clinical Domain</label>
            <InfoTooltip content="The main clinical data area this run should focus on, such as demographics, adverse events, labs, exposure, or disposition." />
          </div>
          <select
            value={selectedTargetDomainOption}
            onChange={(e) => {
              const nextValue = e.target.value;
              if (nextValue === customTargetDomainValue) {
                onSetTargetDomain('');
                return;
              }
              onSetTargetDomain(nextValue);
            }}
            className="w-full p-2.5 rounded-lg border border-slate-300 bg-slate-50 text-sm"
          >
            {targetDomainOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
            <option value={customTargetDomainValue}>Other / Custom...</option>
          </select>
          {selectedTargetDomainOption === customTargetDomainValue ? (
            <input
              type="text"
              value={targetDomain}
              onChange={(e) => onSetTargetDomain(e.target.value.toUpperCase())}
              className="mt-2 w-full p-2.5 rounded-lg border border-slate-300 bg-slate-50 text-sm font-mono"
              placeholder="Enter domain code, e.g. CM, MH, VS"
            />
          ) : null}
          <p className="mt-2 text-xs font-medium text-slate-600">Suggested from selected source file: {suggestedTargetDomain}</p>
          <p className="mt-2 text-xs leading-5 text-slate-500">
            Choose the main clinical data area this run should focus on. Use <span className="font-medium">Other / Custom...</span> if your study uses a different domain such as <span className="font-medium">CM</span>, <span className="font-medium">MH</span>, or <span className="font-medium">VS</span>.
          </p>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-500 uppercase mb-2">Synonyms (Optional)</label>
          <input
            value={customSynonyms}
            onChange={(e) => onSetCustomSynonyms(e.target.value)}
            className="w-full p-2.5 rounded-lg border border-slate-300 bg-slate-50 text-sm"
            placeholder="rash, dermatitis, erythema"
          />
        </div>

        <label className="flex items-center space-x-2 cursor-pointer">
          <input
            type="checkbox"
            checked={generateSasDraft}
            onChange={(e) => onSetGenerateSasDraft(e.target.checked)}
            className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
          />
          <span className="text-sm text-slate-600">Generate SAS validation draft</span>
        </label>

        <button
          onClick={onRunAutopilot}
          disabled={runDisabled}
          className={`w-full py-3 rounded-xl font-bold text-white flex items-center justify-center ${
            runDisabled ? 'bg-slate-300 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-700'
          }`}
        >
          {isRunning ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Play className="w-4 h-4 mr-2" />}
          {isRunning ? 'Running Autopilot...' : runMode.button}
        </button>
      </div>
    </div>
  );
};
