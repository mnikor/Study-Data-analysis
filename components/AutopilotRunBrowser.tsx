import React from 'react';
import { FileText, FolderOpen, Play, Trash2, X } from 'lucide-react';

interface AutopilotRunBrowserItem {
  runId: string;
  runName: string;
  analysisCount: number;
  modeLabel: string;
  scopeLabel: string;
  questionPreview: string;
  latestTimestamp: string;
}

interface AutopilotRunBrowserProps {
  runs: AutopilotRunBrowserItem[];
  selectedRunId: string | null;
  showWorkflowPanels: boolean;
  isCreatingNewAnalysis: boolean;
  isRunning: boolean;
  formatTimestamp: (timestamp: string) => string;
  onSelectRun: (runId: string) => void;
  onToggleWorkflowPanels: () => void;
  onStartNewAnalysis: () => void;
  onCloseNewAnalysis: () => void;
  onDeleteRun: (runId: string) => void;
}

export const AutopilotRunBrowser: React.FC<AutopilotRunBrowserProps> = ({
  runs,
  selectedRunId,
  showWorkflowPanels,
  isCreatingNewAnalysis,
  isRunning,
  formatTimestamp,
  onSelectRun,
  onToggleWorkflowPanels,
  onStartNewAnalysis,
  onCloseNewAnalysis,
  onDeleteRun,
}) => {
  if (runs.length === 0) return null;

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 mb-4">
        <div>
          <h3 className="font-bold text-slate-800 flex items-center">
            <FolderOpen className="w-4 h-4 mr-2 text-indigo-600" />
            Saved Runs
          </h3>
          <p className="text-sm text-slate-500 mt-1">Switch between previous runs without scrolling away from the current result.</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
            {runs.length} run{runs.length === 1 ? '' : 's'}
          </span>
          <button
            onClick={onToggleWorkflowPanels}
            className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            <FileText className="w-4 h-4 mr-2" />
            {showWorkflowPanels ? 'Hide Workflow & Log' : 'Show Workflow & Log'}
          </button>
          <button
            onClick={isCreatingNewAnalysis ? onCloseNewAnalysis : onStartNewAnalysis}
            disabled={isRunning && isCreatingNewAnalysis}
            className={`inline-flex items-center justify-center rounded-xl px-4 py-2 text-sm font-semibold ${
              isCreatingNewAnalysis
                ? 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                : 'bg-indigo-600 text-white hover:bg-indigo-700'
            } ${isRunning && isCreatingNewAnalysis ? 'cursor-not-allowed opacity-60' : ''}`}
          >
            {isCreatingNewAnalysis ? (
              <>
                <X className="w-4 h-4 mr-2" />
                Close New Analysis
              </>
            ) : (
              <>
                <Play className="w-4 h-4 mr-2" />
                New Analysis
              </>
            )}
          </button>
        </div>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-1">
        {runs.map((run) => (
          <button
            key={run.runId}
            onClick={() => onSelectRun(run.runId)}
            className={`shrink-0 w-[320px] text-left rounded-2xl border p-4 transition-colors ${
              selectedRunId === run.runId
                ? 'border-indigo-300 bg-indigo-50'
                : 'border-slate-200 bg-white hover:bg-slate-50'
            }`}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-semibold text-slate-800 line-clamp-2">{run.runName}</div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  {run.analysisCount} analysis{run.analysisCount === 1 ? '' : 'es'}
                </span>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onDeleteRun(run.runId);
                  }}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:border-red-200 hover:bg-red-50 hover:text-red-600"
                  aria-label={`Delete ${run.runName}`}
                  title="Delete run"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="text-xs text-slate-500 mt-2">
              {run.modeLabel} | {run.scopeLabel}
            </div>
            <div className="text-xs text-slate-600 mt-2 line-clamp-2">{run.questionPreview}</div>
            <div className="text-[11px] text-slate-400 mt-3">Updated {formatTimestamp(run.latestTimestamp)}</div>
          </button>
        ))}
      </div>
    </div>
  );
};
