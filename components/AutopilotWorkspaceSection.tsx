import React from 'react';
import { BarChart3, PencilLine, Save, X } from 'lucide-react';
import { AnalysisSession, AutopilotDataScope, AutopilotReviewBundle, ResultTable, UsageMode } from '../types';
import { AutopilotResultDetail } from './AutopilotResultDetail';

interface AutopilotRunSummary {
  runId: string;
  runName: string;
  datasetName: string;
  latestTimestamp: string;
  analysisCount: number;
  modeLabel: string;
  scopeLabel: string;
  workflowMode: UsageMode;
}

interface AutopilotWorkspaceSectionProps {
  sessionCount: number;
  selectedRun: AutopilotRunSummary | null;
  selectedRunResults: AnalysisSession[];
  selectedResult: AnalysisSession | null;
  selectedResultId: string;
  isEditingRunName: boolean;
  runNameDraft: string;
  renameError: string | null;
  isRunning: boolean;
  runError: string | null;
  resultDetailView: 'CHART' | 'TABLE';
  activeResultTable?: ResultTable;
  activeReview: AutopilotReviewBundle | null;
  detailContent: React.ReactNode;
  formatTimestamp: (timestamp: string) => string;
  sessionCardTitle: (session: AnalysisSession) => string;
  sessionAnalysisLabel: (session: AnalysisSession) => string;
  sessionVariableSummary: (session: AnalysisSession) => string;
  getWorkflowBadgeClass: (mode: UsageMode | null | undefined) => string;
  getWorkflowLabel: (mode: UsageMode | null | undefined) => string;
  getQuestionMatchBadgeClass: (status: AnalysisSession['params']['autopilotQuestionMatchStatus']) => string;
  formatMetricLabel: (value: string) => string;
  getScopeLabel: (scope: AutopilotDataScope | null | undefined) => string;
  renderDecisionReview: (review: AutopilotReviewBundle | null) => React.ReactNode;
  onSelectResult: (sessionId: string) => void;
  onSetRunNameDraft: (value: string) => void;
  onStartEditingRunName: () => void;
  onCancelEditingRunName: () => void;
  onSaveRunName: () => void;
  onSetResultDetailView: (view: 'CHART' | 'TABLE') => void;
  onExportSelectedResult: () => void;
  onExportRun: () => void;
  onOpenStatistics: () => void;
}

export const AutopilotWorkspaceSection: React.FC<AutopilotWorkspaceSectionProps> = ({
  sessionCount,
  selectedRun,
  selectedRunResults,
  selectedResult,
  selectedResultId,
  isEditingRunName,
  runNameDraft,
  renameError,
  isRunning,
  runError,
  resultDetailView,
  activeResultTable,
  activeReview,
  detailContent,
  formatTimestamp,
  sessionCardTitle,
  sessionAnalysisLabel,
  sessionVariableSummary,
  getWorkflowBadgeClass,
  getWorkflowLabel,
  getQuestionMatchBadgeClass,
  formatMetricLabel,
  getScopeLabel,
  renderDecisionReview,
  onSelectResult,
  onSetRunNameDraft,
  onStartEditingRunName,
  onCancelEditingRunName,
  onSaveRunName,
  onSetResultDetailView,
  onExportSelectedResult,
  onExportRun,
  onOpenStatistics,
}) => {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm min-w-0">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-5">
        <div>
          <h3 className="font-bold text-slate-800 flex items-center">
            <BarChart3 className="w-4 h-4 mr-2 text-indigo-600" />
            Autopilot Workspace
          </h3>
          <p className="text-sm text-slate-500 mt-1">Browse saved runs first, then compare the analyses inside the selected run.</p>
        </div>
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          {sessionCount} saved autopilot session{sessionCount === 1 ? '' : 's'}
        </div>
      </div>

      {selectedRun && selectedResult ? (
        <div className="space-y-5 min-w-0">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 md:col-span-2">
              <div className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold mb-2">Run Name</div>
              {isEditingRunName ? (
                <div className="space-y-2">
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      value={runNameDraft}
                      onChange={(e) => onSetRunNameDraft(e.target.value)}
                      className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
                      placeholder="Enter run name"
                    />
                    <button
                      onClick={onSaveRunName}
                      className="inline-flex items-center justify-center rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
                    >
                      <Save className="w-4 h-4 mr-2" />
                      Save
                    </button>
                    <button
                      onClick={onCancelEditingRunName}
                      className="inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      <X className="w-4 h-4 mr-2" />
                      Cancel
                    </button>
                  </div>
                  {renameError && <div className="text-sm text-red-600">{renameError}</div>}
                </div>
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <div className="text-lg font-semibold text-slate-800 break-words">{selectedRun.runName}</div>
                  <button
                    onClick={onStartEditingRunName}
                    className="inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 shrink-0"
                  >
                    <PencilLine className="w-4 h-4 mr-2" />
                    Rename
                  </button>
                </div>
              )}
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <div className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">Run Type</div>
              <div className="text-sm font-semibold text-slate-800 mt-1">{selectedRun.modeLabel}</div>
              <div className="text-sm text-slate-500 mt-1">{selectedRun.scopeLabel}</div>
              <div className="text-sm text-slate-500 mt-2">Updated {formatTimestamp(selectedRun.latestTimestamp)}</div>
              <div className="mt-3">
                <span
                  className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide ${getWorkflowBadgeClass(
                    selectedRun.workflowMode
                  )}`}
                >
                  {getWorkflowLabel(selectedRun.workflowMode)}
                </span>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="text-sm font-semibold text-slate-800">Analyses in This Run</div>
                <div className="text-sm text-slate-500">Select one result to review in detail below.</div>
              </div>
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                {selectedRun.analysisCount} saved result{selectedRun.analysisCount === 1 ? '' : 's'}
              </div>
            </div>
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
              {selectedRunResults.map((session, index) => (
                <button
                  key={session.id}
                  onClick={() => onSelectResult(session.id)}
                  className={`w-full text-left p-4 rounded-xl border transition-colors ${
                    selectedResultId === session.id
                      ? 'border-indigo-300 bg-indigo-50'
                      : 'border-slate-200 bg-white hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-[11px] uppercase tracking-wide font-semibold text-slate-500 mb-1">
                        Analysis {index + 1}
                      </div>
                      <div className="text-sm font-semibold text-slate-800 leading-6">{sessionCardTitle(session)}</div>
                    </div>
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 shrink-0">
                      {sessionAnalysisLabel(session)}
                    </div>
                  </div>
                  <div className="text-xs text-slate-500 mt-2">{sessionVariableSummary(session)}</div>
                  {session.params.autopilotQuestionMatchSummary && (
                    <div
                      className={`mt-3 inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold ${getQuestionMatchBadgeClass(
                        session.params.autopilotQuestionMatchStatus
                      )}`}
                    >
                      {session.params.autopilotQuestionMatchSummary}
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>

          <AutopilotResultDetail
            selectedRunName={selectedRun.runName}
            selectedRunDatasetName={selectedRun.datasetName}
            selectedResult={selectedResult}
            resultDetailView={resultDetailView}
            activeResultTable={activeResultTable}
            activeReview={activeReview}
            detailContent={detailContent}
            onSetResultDetailView={onSetResultDetailView}
            onExportSelectedResult={onExportSelectedResult}
            onExportRun={onExportRun}
            onOpenStatistics={onOpenStatistics}
            renderDecisionReview={renderDecisionReview}
            sessionAnalysisLabel={sessionAnalysisLabel}
            sessionVariableSummary={sessionVariableSummary}
            getWorkflowBadgeClass={getWorkflowBadgeClass}
            getWorkflowLabel={getWorkflowLabel}
            getQuestionMatchBadgeClass={getQuestionMatchBadgeClass}
            formatMetricLabel={formatMetricLabel}
            getScopeLabel={getScopeLabel}
            formatTimestamp={formatTimestamp}
          />
        </div>
      ) : sessionCount === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center">
          <div className="text-lg font-semibold text-slate-800">No saved Autopilot run yet</div>
          <div className="text-sm text-slate-500 mt-2 max-w-2xl mx-auto">
            The easiest path is: choose Explore Fast for rapid signal finding or Run Confirmed for protocol-driven execution, then review the saved run here and reopen any result later.
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-6">
          <div className="text-sm font-semibold text-slate-800">
            {isRunning ? 'Autopilot is running. New results will appear here when the run completes.' : 'No current result is selected.'}
          </div>
          <div className="text-sm text-slate-500 mt-2">
            {runError
              ? 'The latest run did not save a new analysis result. Review the workflow status and Autopilot log below instead of relying on any previous saved run.'
              : 'Select a saved run from the list, or start a new run to populate this workspace.'}
          </div>
        </div>
      )}
    </div>
  );
};
