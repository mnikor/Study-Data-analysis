import React from 'react';
import { Loader2 } from 'lucide-react';
import { ClinicalFile } from '../types';
import { QuestionPlanningAssist } from '../services/planningAssistService';
import {
  FileRoleRecommendation,
  QuestionSupportAssessment,
  RecommendationConfidence,
} from '../utils/datasetProfile';

interface BackendPlanningPreflightView {
  status: 'idle' | 'loading' | 'ready' | 'missing_data' | 'unsupported' | 'error';
  summary: string;
  explanation: string;
  missingRoles: string[];
  sourceNames: string[];
  basis: 'current' | 'recommended' | null;
}

interface AutopilotPlanningHeroProps {
  analysisMode: 'PACK' | 'SINGLE';
  analysisQuestion: string;
  defaultQuestion: string;
  packFocusQuestion: string;
  activeAutopilotPrompt: string;
  sourceFilesCount: number;
  autopilotRecommendation: FileRoleRecommendation | null;
  recommendedSupportingFiles: ClinicalFile[];
  planningAssist: QuestionPlanningAssist | null;
  planningAssistError: string | null;
  isPlanningAssistLoading: boolean;
  backendPlanningPreflight: BackendPlanningPreflightView;
  roleLabels: Record<string, string>;
  recommendationConfidenceClass: (confidence?: RecommendationConfidence) => string;
  recommendationSupportStatusClass: (status?: QuestionSupportAssessment['status']) => string;
  recommendationSupportCheckClass: (status?: QuestionSupportAssessment['checks'][number]['status']) => string;
  onSetAnalysisQuestion: (value: string) => void;
  onSetPackFocusQuestion: (value: string) => void;
  onApplyRecommendedAutopilotFiles: () => void;
  onGeneratePlanningAssist: () => void;
}

export const AutopilotPlanningHero: React.FC<AutopilotPlanningHeroProps> = ({
  analysisMode,
  analysisQuestion,
  defaultQuestion,
  packFocusQuestion,
  activeAutopilotPrompt,
  sourceFilesCount,
  autopilotRecommendation,
  recommendedSupportingFiles,
  planningAssist,
  planningAssistError,
  isPlanningAssistLoading,
  backendPlanningPreflight,
  roleLabels,
  recommendationConfidenceClass,
  recommendationSupportStatusClass,
  recommendationSupportCheckClass,
  onSetAnalysisQuestion,
  onSetPackFocusQuestion,
  onApplyRecommendedAutopilotFiles,
  onGeneratePlanningAssist,
}) => {
  const recommendation = autopilotRecommendation;
  const requiredRoles = recommendation?.requiredRoles ?? [];
  const optionalRoles = recommendation?.optionalRoles ?? [];
  const missingRequiredRoles = recommendation?.missingRequiredRoles ?? [];
  const supportAssessment = recommendation?.supportAssessment ?? { status: 'PARTIAL' as const, summary: '', checks: [] };
  const supportChecks = supportAssessment.checks ?? [];
  const guidanceRequiredRoles = planningAssist?.requiredRoles ?? [];
  const predictorFamiliesNeeded = planningAssist?.predictorFamiliesNeeded ?? [];
  const recommendedFileNames = planningAssist?.recommendedFileNames ?? [];
  const whyTheseFiles = planningAssist?.whyTheseFiles ?? [];
  const keyRisks = planningAssist?.keyRisks ?? [];
  const missingReadinessRoles = backendPlanningPreflight?.missingRoles ?? [];
  const readinessSourceNames = backendPlanningPreflight?.sourceNames ?? [];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
      {analysisMode === 'SINGLE' ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Analysis Question</div>
          <div className="mt-1 text-sm text-slate-600">
            Ask the exact question you want the app to answer before you spend time configuring files.
          </div>
          <textarea
            value={analysisQuestion}
            onChange={(e) => onSetAnalysisQuestion(e.target.value)}
            rows={4}
            className="mt-3 w-full rounded-xl border border-slate-300 bg-slate-50 p-3 text-sm text-slate-800"
            placeholder={`Example: ${defaultQuestion}`}
          />
        </div>
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Exploration Goal</div>
          <div className="mt-1 text-sm text-slate-600">
            Describe what the pack should prioritize. Leave it blank if you want a broad exploratory pack.
          </div>
          <textarea
            value={packFocusQuestion}
            onChange={(e) => onSetPackFocusQuestion(e.target.value)}
            rows={3}
            className="mt-3 w-full rounded-xl border border-slate-300 bg-slate-50 p-3 text-sm text-slate-800"
            placeholder="Example: Prioritize early dermatologic signals, treatment-arm differences, and baseline lab predictors."
          />
        </div>
      )}

      {recommendation && requiredRoles.length > 0 && activeAutopilotPrompt ? (
        <div className="rounded-2xl border border-indigo-100 bg-indigo-50/70 p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-indigo-700">
                {analysisMode === 'SINGLE' ? 'Recommended For This Question' : 'Recommended For This Goal'}
              </div>
              <div className="mt-1 text-sm text-slate-600">
                Use this as the fastest path to a viable file selection.
              </div>
            </div>
            <button
              onClick={onApplyRecommendedAutopilotFiles}
              className="rounded-full border border-indigo-200 bg-white px-3 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-50"
            >
              Use Recommended Files
            </button>
          </div>
          <div className="space-y-2 text-sm text-slate-700">
            <div className={`rounded-xl border px-3 py-3 text-xs ${recommendationSupportStatusClass(supportAssessment.status)}`}>
              <div className="font-semibold uppercase tracking-wide">
                {supportAssessment.status === 'READY'
                  ? 'Likely answerable'
                  : supportAssessment.status === 'PARTIAL'
                    ? 'Partially supported'
                    : 'Not enough data yet'}
              </div>
              <div className="mt-1 leading-relaxed">{supportAssessment.summary}</div>
            </div>
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {requiredRoles.map((role) => {
                const file = recommendation.selectedByRole[role];
                const alternatives = recommendation.alternativesByRole[role] || [];
                return (
                  <div key={role} className="rounded-xl border border-white/70 bg-white/80 px-3 py-3">
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{roleLabels[role] || role}</div>
                    {file ? (
                      <>
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-slate-800">{file.name}</span>
                          {recommendation.confidenceByFileId[file.id] && (
                            <span className={`inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${recommendationConfidenceClass(recommendation.confidenceByFileId[file.id])}`}>
                              {recommendation.confidenceByFileId[file.id]} confidence
                            </span>
                          )}
                          {alternatives.length > 1 && (
                            <span className="text-xs text-slate-500">
                              {alternatives.length - 1} alternative{alternatives.length - 1 === 1 ? '' : 's'}
                            </span>
                          )}
                        </div>
                        {recommendation.rationaleByFileId[file.id] && (
                          <div className="mt-1 text-xs leading-relaxed text-slate-500">
                            {recommendation.rationaleByFileId[file.id]}
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="mt-1 text-sm text-amber-700">No good match found</div>
                    )}
                  </div>
                );
              })}
            </div>
            {optionalRoles.length > 0 && (
              <div className="text-xs text-slate-500">
                Optional if available: {optionalRoles.map((role) => roleLabels[role] || role).join(', ')}
              </div>
            )}
            {missingRequiredRoles.length > 0 && (
              <div className="text-xs text-amber-700">
                Still missing: {missingRequiredRoles.map((role) => roleLabels[role] || role).join(', ')}
              </div>
            )}
            {recommendedSupportingFiles.length > 0 && (
              <div className="text-xs text-slate-500">
                Supporting files that will also be selected: {recommendedSupportingFiles.map((file) => file.name).join(', ')}.
              </div>
            )}
            {supportChecks.length > 0 && (
              <div>
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Readiness checks</div>
                <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
                  {supportChecks.map((check, index) => (
                    <div key={`${check.label}-${index}`} className="rounded-xl border border-white/70 bg-white/80 px-3 py-3 text-xs leading-relaxed">
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
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Recommended Files</div>
          <div className="mt-1 text-sm text-slate-600">
            {activeAutopilotPrompt
              ? 'Recommended files will appear here once the app can infer a credible setup from your question.'
              : analysisMode === 'SINGLE'
                ? 'Enter a question first to see recommended files and readiness.'
                : 'Add an exploration goal if you want the app to tailor the recommendation to a specific objective.'}
          </div>
        </div>
      )}
    </div>

      <div className="rounded-2xl border border-violet-100 bg-violet-50/60 p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-violet-700">Planning Readiness</div>
            <div className="mt-1 text-sm text-slate-600">
              Combines execution-readiness validation with AI guidance grounded in the same result.
            </div>
          </div>
          <button
            onClick={onGeneratePlanningAssist}
            disabled={isPlanningAssistLoading}
            className="rounded-full border border-violet-200 bg-white px-3 py-1.5 text-xs font-semibold text-violet-700 hover:bg-violet-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isPlanningAssistLoading ? 'Generating…' : 'Generate Guidance'}
          </button>
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
          {analysisMode === 'SINGLE' && activeAutopilotPrompt && sourceFilesCount > 0 && backendPlanningPreflight.status !== 'idle' ? (
            <div
              className={`rounded-xl border px-4 py-4 text-sm ${
                backendPlanningPreflight.status === 'ready'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                  : backendPlanningPreflight.status === 'loading'
                    ? 'border-sky-200 bg-white text-sky-800'
                    : backendPlanningPreflight.status === 'error'
                      ? 'border-red-200 bg-red-50 text-red-700'
                      : 'border-amber-200 bg-amber-50 text-amber-800'
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="font-semibold uppercase tracking-wide">
                  {backendPlanningPreflight.status === 'ready'
                    ? 'Execution Readiness: Ready To Run'
                    : backendPlanningPreflight.status === 'loading'
                      ? 'Execution Readiness: Checking'
                      : backendPlanningPreflight.status === 'error'
                        ? 'Execution Readiness: Check Failed'
                        : backendPlanningPreflight.status === 'unsupported'
                          ? 'Execution Readiness: Not Supported Yet'
                          : 'Execution Readiness: Missing Data'}
                </div>
                {backendPlanningPreflight.status === 'loading' && <Loader2 className="h-4 w-4 animate-spin" />}
              </div>
              <div className="mt-2 leading-relaxed">{backendPlanningPreflight.summary}</div>
              {missingReadinessRoles.length > 0 && (
                <div className="mt-2 text-sm">
                  Missing roles: {missingReadinessRoles.map((role) => roleLabels[role] || role).join(', ')}
                </div>
              )}
              {readinessSourceNames.length > 0 && (
                <div className="mt-2 text-xs opacity-80">
                  Checked using {backendPlanningPreflight.basis === 'recommended' ? 'recommended' : 'current'} files: {readinessSourceNames.join(', ')}
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-xl border border-violet-100 bg-white px-4 py-4 text-sm text-slate-600">
              {analysisMode === 'SINGLE'
                ? activeAutopilotPrompt
                  ? 'Execution readiness will appear here after the app validates your current question and file selection.'
                  : 'Paste or type a question to see execution readiness before you run anything.'
                : 'Planning guidance works best once the app has a concrete goal or generated hypotheses to prioritize.'}
            </div>
          )}

          <div>
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">AI Guidance</div>
            {planningAssistError && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{planningAssistError}</div>}
            {!planningAssist && !planningAssistError && (
              <div className="rounded-xl border border-violet-100 bg-white px-4 py-4 text-sm text-slate-600">
                Generate guidance to get a plain-language explanation of the readiness result, recommended files, and likely risks.
              </div>
            )}
            {planningAssist && (
              <div className="space-y-3 text-sm text-slate-700">
                <div className="rounded-xl border border-violet-100 bg-white px-4 py-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-slate-800">Question interpretation</span>
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
                  <div className="mt-2 leading-relaxed">{planningAssist.questionIntentSummary}</div>
                </div>

                {(guidanceRequiredRoles.length > 0 || predictorFamiliesNeeded.length > 0) && (
                  <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                    {guidanceRequiredRoles.length > 0 && (
                      <div className="rounded-xl border border-violet-100 bg-white px-4 py-4">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Likely required dataset types</div>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {guidanceRequiredRoles.map((role) => (
                            <span key={role} className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold text-violet-700">
                              {role}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    {predictorFamiliesNeeded.length > 0 && (
                      <div className="rounded-xl border border-violet-100 bg-white px-4 py-4">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Predictor families needed</div>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {predictorFamiliesNeeded.map((family) => (
                            <span key={family} className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-700">
                              {family}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {(recommendedFileNames.length > 0 || whyTheseFiles.length > 0) && (
                  <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                    {recommendedFileNames.length > 0 && (
                      <div className="rounded-xl border border-violet-100 bg-white px-4 py-4">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Recommended files</div>
                        <ul className="mt-2 list-disc space-y-1 pl-4 text-sm">
                          {recommendedFileNames.map((name) => (
                            <li key={name}>{name}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {whyTheseFiles.length > 0 && (
                      <div className="rounded-xl border border-violet-100 bg-white px-4 py-4">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Why these files</div>
                        <ul className="mt-2 list-disc space-y-1 pl-4 text-sm">
                          {whyTheseFiles.map((item, index) => (
                            <li key={`${item}-${index}`}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}

                {keyRisks.length > 0 && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-4">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-amber-800">Key risks</div>
                    <ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-amber-800">
                      {keyRisks.map((risk, index) => (
                        <li key={`${risk}-${index}`}>{risk}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
