import React from 'react';
import { CheckCircle2, Clock3, FileText, Loader2, XCircle } from 'lucide-react';

type WorkflowStepStatus = 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED' | 'SKIPPED';

interface WorkflowStepItem {
  key: string;
  label: string;
  status: WorkflowStepStatus;
  detail: string;
}

interface AutopilotWorkflowPanelProps {
  steps: WorkflowStepItem[];
  reviewMode: boolean;
  runError: string | null;
  failureLogPreview: string[];
  displayedRunLog: string[];
  logHeightClass: string;
}

const stepStatusClass: Record<WorkflowStepStatus, string> = {
  PENDING: 'border-slate-200 bg-slate-50 text-slate-500',
  RUNNING: 'border-indigo-200 bg-indigo-50 text-indigo-700',
  DONE: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  FAILED: 'border-red-200 bg-red-50 text-red-700',
  SKIPPED: 'border-amber-200 bg-amber-50 text-amber-700',
};

const StepIcon: React.FC<{ status: WorkflowStepStatus }> = ({ status }) => {
  if (status === 'DONE') return <CheckCircle2 className="w-4 h-4" />;
  if (status === 'FAILED') return <XCircle className="w-4 h-4" />;
  if (status === 'RUNNING') return <Loader2 className="w-4 h-4 animate-spin" />;
  return <Clock3 className="w-4 h-4" />;
};

export const AutopilotWorkflowPanel: React.FC<AutopilotWorkflowPanelProps> = ({
  steps,
  reviewMode,
  runError,
  failureLogPreview,
  displayedRunLog,
  logHeightClass,
}) => (
  <div className="space-y-6 min-w-0">
    <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-bold text-slate-800 flex items-center">
          <Loader2 className="w-4 h-4 mr-2 text-indigo-600" />
          Workflow Status
        </h3>
        {reviewMode && (
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Secondary panel in review mode</span>
        )}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {steps.map((step) => (
          <div key={step.key} className={`border rounded-xl px-3 py-2 text-sm ${stepStatusClass[step.status]}`}>
            <div className="flex items-center justify-between">
              <span className="font-semibold">{step.label}</span>
              <StepIcon status={step.status} />
            </div>
            <div className="text-xs mt-1 opacity-90">{step.detail}</div>
          </div>
        ))}
      </div>
      {runError && (
        <div className="mt-4 border border-red-200 bg-red-50 text-red-700 rounded-xl p-3 text-sm">
          <div className="font-semibold">Run failed</div>
          <div className="mt-1">{runError}</div>
          {failureLogPreview.length > 0 && (
            <div className="mt-3 rounded-lg border border-red-200 bg-white/70 p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-red-700 mb-2">Latest execution details</div>
              <div className="space-y-1 font-mono text-xs text-red-800">
                {failureLogPreview.map((line, idx) => (
                  <div key={`${line}-${idx}`}>{line}</div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>

    <div className="bg-[#111827] border border-slate-700 rounded-2xl overflow-hidden shadow-sm">
      <div className="px-4 py-3 border-b border-slate-700 text-slate-200 text-sm font-semibold flex items-center justify-between">
        <div className="flex items-center">
          <FileText className="w-4 h-4 mr-2" />
          Autopilot Log
        </div>
        {reviewMode && <span className="text-[11px] uppercase tracking-wide text-slate-400">Reference</span>}
      </div>
      <div className={`p-4 ${logHeightClass} overflow-y-auto font-mono text-xs text-slate-300 space-y-1`}>
        {displayedRunLog.length === 0 && <div className="text-slate-500">No execution logs yet.</div>}
        {displayedRunLog.map((line, idx) => (
          <div key={idx}>{line}</div>
        ))}
      </div>
    </div>
  </div>
);
