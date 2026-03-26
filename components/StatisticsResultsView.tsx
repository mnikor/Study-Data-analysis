import React from 'react';
import {
  ArrowLeft,
  BarChart3,
  Calculator,
  Copy,
  Download,
  Lightbulb,
  Lock,
  Sparkles,
} from 'lucide-react';
import { AnalysisSession, StatAnalysisResult, UsageMode } from '../types';
import { Chart } from './Chart';

interface StatisticsResultsViewProps {
  result: StatAnalysisResult;
  activeSession: AnalysisSession | null;
  usageMode: UsageMode;
  backendPreview: { workspace: { row_count?: number | null; column_count?: number | null } | null } | null;
  variable1: string;
  variable2: string;
  onBackToCodeReview: () => void;
  onExportHtml: () => void;
  onCreateEditableDraft: () => void;
}

export const StatisticsResultsView: React.FC<StatisticsResultsViewProps> = ({
  result,
  activeSession,
  usageMode,
  backendPreview,
  variable1,
  variable2,
  onBackToCodeReview,
  onExportHtml,
  onCreateEditableDraft,
}) => {
  return (
    <div className="flex-1 overflow-y-auto p-8 animate-fadeIn">
      <div className="max-w-6xl mx-auto">
        <div className="flex justify-between items-start mb-8">
          <div>
            <div className="flex items-center space-x-3 mb-2">
              <button onClick={onBackToCodeReview} className="text-slate-400 hover:text-slate-600">
                <ArrowLeft className="w-5 h-5" />
              </button>
              <h2 className="text-2xl font-bold text-slate-800">Analysis Results</h2>
              {usageMode === UsageMode.OFFICIAL && (
                <span className="px-2 py-0.5 bg-green-100 text-green-800 text-xs font-bold rounded border border-green-200 flex items-center">
                  <Lock className="w-3 h-3 mr-1" /> Run Confirmed
                </span>
              )}
            </div>
            <p className="text-slate-500">{activeSession?.name}</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              onClick={onExportHtml}
              className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              <Download className="w-4 h-4 mr-2" />
              Export HTML
            </button>
          </div>
        </div>

        {activeSession?.params.autopilotRunId && (
          <div className="mb-6 rounded-2xl border border-indigo-200 bg-indigo-50 p-5">
            <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
              <div className="min-w-0">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-indigo-700 mb-1">Promoted From Autopilot</div>
                <div className="text-lg font-semibold text-slate-900">
                  This result came from the Autopilot workspace and is now open in the Statistical Analysis workbench.
                </div>
                <div className="mt-2 text-sm text-slate-700 leading-6">
                  Use this view when you want tighter control: inspect the generated code, switch execution path, restore protocol-plan context, or create an editable draft for reruns without changing the original Autopilot result.
                </div>
                <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-600">
                  <span className="rounded-full border border-indigo-200 bg-white px-2.5 py-1 font-semibold">
                    Run: {activeSession.params.autopilotRunName || activeSession.name}
                  </span>
                  {activeSession.params.selectedPlanDocId && (
                    <span className="rounded-full border border-emerald-200 bg-white px-2.5 py-1 font-semibold">
                      Protocol context restored
                    </span>
                  )}
                  {activeSession.params.autopilotSourceNames && activeSession.params.autopilotSourceNames.length > 1 && (
                    <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 font-semibold">
                      Linked sources: {activeSession.params.autopilotSourceNames.length}
                    </span>
                  )}
                </div>
              </div>
              <button
                onClick={onCreateEditableDraft}
                className="inline-flex items-center justify-center rounded-xl border border-indigo-300 bg-white px-4 py-2 text-sm font-semibold text-indigo-700 hover:bg-indigo-100 shrink-0"
              >
                <Copy className="w-4 h-4 mr-2" />
                Create Editable Draft
              </button>
            </div>
          </div>
        )}

        <div className="space-y-6">
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
            <h3 className="font-bold text-slate-800 mb-4 flex items-center">
              <BarChart3 className="w-5 h-5 mr-2 text-purple-500" />
              Visualization
            </h3>
            <div className="min-h-[460px]">
              <Chart data={result.chartConfig.data} layout={result.chartConfig.layout} />
            </div>
            <p className="text-center text-xs text-slate-400 mt-4">Figure 1. {activeSession?.name}</p>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <div className="bg-indigo-50 p-6 rounded-xl border border-indigo-100 shadow-sm">
              <h3 className="font-bold text-indigo-900 mb-3 flex items-center">
                <Lightbulb className="w-5 h-5 mr-2" />
                {result.aiCommentary?.sections?.directAnswer ? 'Direct Answer' : 'Clinical Interpretation'}
              </h3>
              <p className="text-indigo-800 text-sm leading-relaxed">
                {result.aiCommentary?.sections?.directAnswer || result.interpretation}
              </p>
            </div>

            {result.aiCommentary ? (
              <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
                <div className="flex items-center justify-between gap-3 mb-3">
                  <h3 className="font-bold text-slate-800 flex items-center">
                    <Sparkles className="w-5 h-5 mr-2 text-indigo-500" />
                    AI Clinical Commentary
                  </h3>
                  <span className="px-2 py-0.5 bg-indigo-50 text-indigo-700 text-[10px] rounded border border-indigo-100 uppercase font-bold">
                    {result.aiCommentary.source === 'AI' ? 'AI generated' : 'Fallback'}
                  </span>
                </div>
                <p className="text-slate-700 text-sm leading-relaxed">{result.aiCommentary.summary}</p>
                {result.aiCommentary.limitations.length > 0 && (
                  <div className="mt-4">
                    <p className="text-xs font-bold uppercase text-slate-500 mb-2">Limitations</p>
                    <ul className="list-disc pl-5 space-y-1 text-sm text-slate-600">
                      {result.aiCommentary.limitations.map((item, index) => (
                        <li key={index}>{item}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {result.aiCommentary.caution && (
                  <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                    {result.aiCommentary.caution}
                  </div>
                )}
              </div>
            ) : (
              <div className="bg-slate-50 p-6 rounded-xl border border-dashed border-slate-200 shadow-sm text-sm text-slate-500">
                No AI clinical commentary is available for this result.
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_340px] gap-6">
            <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
              <h3 className="font-bold text-slate-800 mb-4 flex items-center">
                <Calculator className="w-5 h-5 mr-2 text-blue-500" />
                Calculated Metrics
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {Object.entries(result.metrics).map(([key, val]) => (
                  <div key={key} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <div className="text-[11px] uppercase tracking-wide font-semibold text-slate-500">{key.replace(/_/g, ' ')}</div>
                    <div className="mt-1 text-sm font-bold text-slate-800 font-mono break-words">{val}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
              <h3 className="font-bold text-slate-800 mb-4">Run Details</h3>
              <div className="space-y-3 text-sm text-slate-700">
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <div className="text-[11px] uppercase tracking-wide font-semibold text-slate-500">Analysis</div>
                  <div className="mt-1 font-medium text-slate-800 break-words">{activeSession?.name}</div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <div className="text-[11px] uppercase tracking-wide font-semibold text-slate-500">Dataset</div>
                  <div className="mt-1 font-medium text-slate-800 break-all">{activeSession?.params.fileName}</div>
                </div>
                {activeSession?.params.supportingFileNames && activeSession.params.supportingFileNames.length > 0 && (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <div className="text-[11px] uppercase tracking-wide font-semibold text-slate-500">Supporting Datasets</div>
                    <div className="mt-1 font-medium text-slate-800 break-words">{activeSession.params.supportingFileNames.join(', ')}</div>
                  </div>
                )}
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <div className="text-[11px] uppercase tracking-wide font-semibold text-slate-500">Variables</div>
                  <div className="mt-1 font-medium text-slate-800 break-words">
                    {activeSession?.params.var1 || variable1} vs {activeSession?.params.var2 || variable2}
                  </div>
                </div>
                {activeSession?.params.backendAnalysisFamily && (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <div className="text-[11px] uppercase tracking-wide font-semibold text-slate-500">Execution Engine</div>
                    <div className="mt-1 font-medium text-slate-800 break-words">
                      Deterministic analysis engine ({activeSession.params.backendAnalysisFamily})
                    </div>
                  </div>
                )}
                {activeSession?.params.backendWorkspaceId && (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <div className="text-[11px] uppercase tracking-wide font-semibold text-slate-500">Workspace ID</div>
                    <div className="mt-1 font-medium text-slate-800 break-all">{activeSession.params.backendWorkspaceId}</div>
                  </div>
                )}
                {result.backendExecution?.receipt && (
                  <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3">
                    <div className="text-[11px] uppercase tracking-wide font-semibold text-indigo-700">Analysis Receipt</div>
                    <div className="mt-2 space-y-2 text-sm text-slate-700">
                      {result.backendExecution.receipt.endpointLabel && (
                        <div><span className="font-semibold text-slate-800">Endpoint:</span> {result.backendExecution.receipt.endpointLabel}</div>
                      )}
                      {result.backendExecution.receipt.targetDefinition && (
                        <div><span className="font-semibold text-slate-800">Target definition:</span> {result.backendExecution.receipt.targetDefinition}</div>
                      )}
                      {result.backendExecution.receipt.cohortFiltersApplied.length > 0 && (
                        <div><span className="font-semibold text-slate-800">Cohort filters:</span> {result.backendExecution.receipt.cohortFiltersApplied.join(', ')}</div>
                      )}
                      {result.backendExecution.receipt.treatmentVariable && (
                        <div><span className="font-semibold text-slate-800">Grouping variable:</span> {result.backendExecution.receipt.treatmentVariable}</div>
                      )}
                      {result.backendExecution.receipt.outcomeVariable && (
                        <div><span className="font-semibold text-slate-800">Outcome variable:</span> {result.backendExecution.receipt.outcomeVariable}</div>
                      )}
                      {result.backendExecution.receipt.timeVariable && (
                        <div><span className="font-semibold text-slate-800">Time variable:</span> {result.backendExecution.receipt.timeVariable}</div>
                      )}
                      {result.backendExecution.receipt.derivedColumns.length > 0 && (
                        <div><span className="font-semibold text-slate-800">Derived fields:</span> {result.backendExecution.receipt.derivedColumns.join(', ')}</div>
                      )}
                      {(result.backendExecution.receipt.rowCount || result.backendExecution.receipt.columnCount) && (
                        <div>
                          <span className="font-semibold text-slate-800">Workspace shape:</span>{' '}
                          {result.backendExecution.receipt.rowCount ?? '?'} rows x {result.backendExecution.receipt.columnCount ?? '?'} columns
                        </div>
                      )}
                    </div>
                  </div>
                )}
                {backendPreview?.workspace?.row_count != null && backendPreview.workspace.column_count != null && (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <div className="text-[11px] uppercase tracking-wide font-semibold text-slate-500">Preview Workspace Shape</div>
                    <div className="mt-1 font-medium text-slate-800">
                      {backendPreview.workspace.row_count} rows x {backendPreview.workspace.column_count} columns
                    </div>
                  </div>
                )}
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <div className="text-[11px] uppercase tracking-wide font-semibold text-slate-500">Saved</div>
                  <div className="mt-1 font-medium text-slate-800">
                    {activeSession ? new Date(activeSession.timestamp).toLocaleString() : 'Current session'}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-slate-900 rounded-xl overflow-hidden shadow-sm">
            <div className="bg-slate-800 px-4 py-2 border-b border-slate-700 flex justify-between items-center">
              <span className="text-slate-400 text-xs font-bold uppercase">Source Code</span>
              <div className="flex space-x-2">
                {result.sasCode && (
                  <span className="px-2 py-0.5 bg-orange-900 text-orange-200 text-[10px] rounded border border-orange-700">SAS Available</span>
                )}
                <span className="px-2 py-0.5 bg-blue-900 text-blue-200 text-[10px] rounded border border-blue-700">Python Executed</span>
              </div>
            </div>
            <div className="max-h-60 overflow-auto p-4">
              {result.sasCode && (
                <div className="mb-4">
                  <p className="text-xs text-orange-400 mb-1 font-bold">SAS Validation Code:</p>
                  <pre className="font-mono text-xs text-orange-100 opacity-80 whitespace-pre-wrap">{result.sasCode}</pre>
                </div>
              )}
              <p className="text-xs text-blue-400 mb-1 font-bold">Python Execution Code:</p>
              <pre className="font-mono text-xs text-slate-300 whitespace-pre-wrap">{result.executedCode}</pre>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
