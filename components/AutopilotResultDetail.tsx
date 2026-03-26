import React from 'react';
import { AnalysisSession, AutopilotDataScope, AutopilotReviewBundle, ResultTable, UsageMode } from '../types';
import { BarChart3, Download, ExternalLink, FileText, Table2 } from 'lucide-react';

interface AutopilotResultDetailProps {
  selectedRunName: string;
  selectedRunDatasetName: string;
  selectedResult: AnalysisSession;
  resultDetailView: 'CHART' | 'TABLE';
  activeResultTable?: ResultTable;
  activeReview: AutopilotReviewBundle | null;
  detailContent: React.ReactNode;
  onSetResultDetailView: (view: 'CHART' | 'TABLE') => void;
  onExportSelectedResult: () => void;
  onExportRun: () => void;
  onOpenStatistics: () => void;
  renderDecisionReview: (review: AutopilotReviewBundle | null) => React.ReactNode;
  sessionAnalysisLabel: (session: AnalysisSession) => string;
  sessionVariableSummary: (session: AnalysisSession) => string;
  getWorkflowBadgeClass: (mode: UsageMode | null | undefined) => string;
  getWorkflowLabel: (mode: UsageMode | null | undefined) => string;
  getQuestionMatchBadgeClass: (status: AnalysisSession['params']['autopilotQuestionMatchStatus']) => string;
  formatMetricLabel: (value: string) => string;
  getScopeLabel: (scope: AutopilotDataScope | null | undefined) => string;
  formatTimestamp: (timestamp: string) => string;
}

export const AutopilotResultDetail: React.FC<AutopilotResultDetailProps> = ({
  selectedRunName,
  selectedRunDatasetName,
  selectedResult,
  resultDetailView,
  activeResultTable,
  activeReview,
  detailContent,
  onSetResultDetailView,
  onExportSelectedResult,
  onExportRun,
  onOpenStatistics,
  renderDecisionReview,
  sessionAnalysisLabel,
  sessionVariableSummary,
  getWorkflowBadgeClass,
  getWorkflowLabel,
  getQuestionMatchBadgeClass,
  formatMetricLabel,
  getScopeLabel,
  formatTimestamp,
}) => {
  const showOriginalQuestion =
    Boolean(selectedResult.params.autopilotQuestion) &&
    selectedRunName.trim() !== selectedResult.params.autopilotQuestion!.trim();
  const showQuestionMatchSummary = Boolean(selectedResult.params.autopilotQuestionMatchSummary);

  return (
    <div className="border border-slate-200 rounded-2xl p-5 min-w-0 bg-white">
      <div className="flex flex-col 2xl:flex-row 2xl:items-start 2xl:justify-between gap-4 mb-4">
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-wide text-slate-500 font-semibold mb-2">Selected Result</div>
          <div className="text-2xl font-bold text-slate-800 break-words">
            {`Autopilot - ${sessionAnalysisLabel(selectedResult)}: ${sessionVariableSummary(selectedResult)}`}
          </div>
          <div className="text-sm text-slate-500 mt-1">
            {sessionAnalysisLabel(selectedResult)} | {sessionVariableSummary(selectedResult)}
          </div>
          <div className="mt-3">
            <span
              className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide ${getWorkflowBadgeClass(
                selectedResult.usageMode
              )}`}
            >
              {getWorkflowLabel(selectedResult.usageMode)}
            </span>
          </div>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 shrink-0">
          <div className="inline-flex rounded-xl border border-slate-200 bg-slate-100 p-1">
            <button
              onClick={() => onSetResultDetailView('CHART')}
              className={`inline-flex items-center rounded-lg px-3 py-2 text-sm font-semibold ${
                resultDetailView === 'CHART' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
              }`}
            >
              <BarChart3 className="w-4 h-4 mr-2" />
              Chart
            </button>
            <button
              onClick={() => onSetResultDetailView('TABLE')}
              disabled={!activeResultTable}
              className={`inline-flex items-center rounded-lg px-3 py-2 text-sm font-semibold ${
                resultDetailView === 'TABLE' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
              } ${!activeResultTable ? 'cursor-not-allowed opacity-50' : ''}`}
            >
              <Table2 className="w-4 h-4 mr-2" />
              Table
            </button>
          </div>
          <button
            onClick={onExportSelectedResult}
            className="inline-flex items-center justify-center px-4 py-2 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            <Download className="w-4 h-4 mr-2" />
            Export Result
          </button>
          <button
            onClick={onExportRun}
            className="inline-flex items-center justify-center px-4 py-2 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            <FileText className="w-4 h-4 mr-2" />
            Export Run
          </button>
          <button
            onClick={onOpenStatistics}
            className="inline-flex items-center justify-center px-4 py-2 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            <ExternalLink className="w-4 h-4 mr-2" />
            Promote to Statistical Workbench
          </button>
        </div>
      </div>

      <div className="min-w-0">{detailContent}</div>

      {(showOriginalQuestion || showQuestionMatchSummary) && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mt-4 min-w-0 items-start">
          {showOriginalQuestion && (
            <div className="rounded-2xl border border-indigo-100 bg-indigo-50 p-4 min-w-0">
              <div className="text-xs uppercase tracking-wide text-indigo-700 font-semibold mb-2">Original question</div>
              <div className="text-base leading-7 text-indigo-950">{selectedResult.params.autopilotQuestion}</div>
            </div>
          )}
          {showQuestionMatchSummary && (
            <div
              className={`rounded-2xl border p-4 text-sm min-w-0 ${getQuestionMatchBadgeClass(
                selectedResult.params.autopilotQuestionMatchStatus
              )}`}
            >
              <div className="font-semibold">{selectedResult.params.autopilotQuestionMatchSummary}</div>
              {selectedResult.params.autopilotQuestionMatchDetails &&
                selectedResult.params.autopilotQuestionMatchDetails.length > 0 && (
                  <ul className="mt-2 list-disc pl-5 space-y-1">
                    {selectedResult.params.autopilotQuestionMatchDetails.map((detail, index) => (
                      <li key={`${selectedResult.id}-match-${index}`}>{detail}</li>
                    ))}
                  </ul>
                )}
            </div>
          )}
        </div>
      )}

      <div className="mt-4 min-w-0">
        {selectedResult.aiCommentary ? (
          <div className="rounded-2xl border border-indigo-100 p-4 bg-indigo-50/60">
            <div className="flex items-center justify-between gap-3 mb-2">
              <div className="text-xs uppercase tracking-wide text-indigo-700 font-semibold">AI Clinical Commentary</div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-indigo-600">
                {selectedResult.aiCommentary.source === 'AI' ? 'AI generated' : 'Fallback summary'}
              </div>
            </div>
            {selectedResult.aiCommentary.sections?.status && (
              <div className="mb-3 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">
                <span className="font-semibold">Status:</span> {selectedResult.aiCommentary.sections.status}
              </div>
            )}
            <div className="space-y-3">
              {selectedResult.aiCommentary.sections?.directAnswer && (
                <div>
                  <div className="text-xs uppercase tracking-wide text-slate-500 font-semibold mb-1">Direct answer</div>
                  <div className="text-base leading-7 text-slate-800">{selectedResult.aiCommentary.sections.directAnswer}</div>
                </div>
              )}
              {selectedResult.aiCommentary.sections?.population && (
                <div>
                  <div className="text-xs uppercase tracking-wide text-slate-500 font-semibold mb-1">Analysis population</div>
                  <div className="text-base leading-7 text-slate-800">{selectedResult.aiCommentary.sections.population}</div>
                </div>
              )}
              {selectedResult.aiCommentary.sections?.endpointDefinition && (
                <div>
                  <div className="text-xs uppercase tracking-wide text-slate-500 font-semibold mb-1">Endpoint definition</div>
                  <div className="text-base leading-7 text-slate-800">{selectedResult.aiCommentary.sections.endpointDefinition}</div>
                </div>
              )}
              {selectedResult.aiCommentary.sections?.mainFindings ? (
                <div>
                  <div className="text-xs uppercase tracking-wide text-slate-500 font-semibold mb-1">Main findings</div>
                  <div className="text-base leading-7 text-slate-800">{selectedResult.aiCommentary.sections.mainFindings}</div>
                </div>
              ) : (
                <div className="text-base leading-7 text-slate-800">{selectedResult.aiCommentary.summary}</div>
              )}
              {selectedResult.aiCommentary.sections?.interactionFindings && (
                <div>
                  <div className="text-xs uppercase tracking-wide text-slate-500 font-semibold mb-1">Arm interaction findings</div>
                  <div className="text-base leading-7 text-slate-800">{selectedResult.aiCommentary.sections.interactionFindings}</div>
                </div>
              )}
              {selectedResult.aiCommentary.sections?.modelStrength && (
                <div>
                  <div className="text-xs uppercase tracking-wide text-slate-500 font-semibold mb-1">Model strength</div>
                  <div className="text-base leading-7 text-slate-800">{selectedResult.aiCommentary.sections.modelStrength}</div>
                </div>
              )}
              {selectedResult.aiCommentary.sections?.nextSteps && selectedResult.aiCommentary.sections.nextSteps.length > 0 && (
                <div>
                  <div className="text-xs uppercase tracking-wide text-slate-500 font-semibold mb-1">What to do next</div>
                  <ul className="space-y-2 text-sm text-slate-700 list-disc pl-5">
                    {selectedResult.aiCommentary.sections.nextSteps.map((item, index) => (
                      <li key={index}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}
              {selectedResult.aiCommentary.sections?.mainFindings && (
                <div>
                  <div className="text-xs uppercase tracking-wide text-slate-500 font-semibold mb-1">Summary</div>
                  <div className="text-base leading-7 text-slate-800">{selectedResult.aiCommentary.summary}</div>
                </div>
              )}
            </div>
            {selectedResult.aiCommentary.limitations.length > 0 && (
              <div className="mt-3">
                <div className="text-xs uppercase tracking-wide text-slate-500 font-semibold mb-2">Limitations</div>
                <ul className="space-y-2 text-sm text-slate-700 list-disc pl-5">
                  {selectedResult.aiCommentary.limitations.map((item, index) => (
                    <li key={index}>{item}</li>
                  ))}
                </ul>
              </div>
            )}
            {selectedResult.aiCommentary.caution && (
              <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                {selectedResult.aiCommentary.caution}
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-2xl border border-slate-200 p-4 bg-white">
            <div className="text-xs uppercase tracking-wide text-slate-500 font-semibold mb-2">Statistical interpretation</div>
            <div className="text-base leading-7 text-slate-800">
              {selectedResult.interpretation || 'No AI clinical commentary is available for this result.'}
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_340px] gap-4 mt-4 min-w-0 items-start">
        <div className="space-y-4 min-w-0">
          <div className="rounded-2xl border border-slate-200 p-4 bg-white">
            <div className="text-xs uppercase tracking-wide text-slate-500 font-semibold mb-3">Metrics</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {Object.entries(selectedResult.metrics).map(([key, value]) => (
                <div key={key} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
                  <div className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">
                    {formatMetricLabel(key)}
                  </div>
                  <div className="text-sm font-semibold text-slate-800 mt-1 break-words">{String(value)}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-200 p-4 bg-white">
            <div className="text-xs uppercase tracking-wide text-slate-500 font-semibold mb-3">Run Details</div>
            <div className="grid grid-cols-1 gap-3 text-sm text-slate-700">
              <div className="rounded-xl bg-slate-50 border border-slate-200 px-3 py-3">
                <div className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">Run Name</div>
                <div className="mt-1 font-medium text-slate-800 break-words">{selectedRunName}</div>
              </div>
              <div className="rounded-xl bg-slate-50 border border-slate-200 px-3 py-3">
                <div className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">Source Dataset</div>
                <div className="mt-1 font-medium text-slate-800 break-all">
                  {selectedResult.params.autopilotSourceName || selectedRunDatasetName}
                </div>
              </div>
              <div className="rounded-xl bg-slate-50 border border-slate-200 px-3 py-3">
                <div className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">Scope</div>
                <div className="mt-1 font-medium text-slate-800">{getScopeLabel(selectedResult.params.autopilotDataScope)}</div>
              </div>
              <div className="rounded-xl bg-slate-50 border border-slate-200 px-3 py-3">
                <div className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">Standardized Dataset</div>
                <div className="mt-1 font-medium text-slate-800 break-all">{selectedResult.params.fileName}</div>
              </div>
              <div className="rounded-xl bg-slate-50 border border-slate-200 px-3 py-3">
                <div className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">Saved</div>
                <div className="mt-1 font-medium text-slate-800">{formatTimestamp(selectedResult.timestamp)}</div>
              </div>
              <div className="rounded-xl bg-slate-50 border border-slate-200 px-3 py-3">
                <div className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">Variables</div>
                <div className="mt-1 font-medium text-slate-800 break-words">
                  {sessionVariableSummary(selectedResult)}
                </div>
              </div>
              {selectedResult.params.autopilotSourceNames && selectedResult.params.autopilotSourceNames.length > 1 && (
                <div className="rounded-xl bg-slate-50 border border-slate-200 px-3 py-3">
                  <div className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">Linked Source Datasets</div>
                  <div className="mt-1 font-medium text-slate-800 break-words">
                    {selectedResult.params.autopilotSourceNames.join(', ')}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 p-4 bg-slate-50 mt-4">
        <div className="text-xs uppercase tracking-wide text-slate-500 font-semibold mb-3">Review AI Decisions</div>
        {renderDecisionReview(activeReview)}
      </div>
    </div>
  );
};
