import React from 'react';
import { Loader2, Play } from 'lucide-react';
import { ClinicalFile, StatTestType } from '../types';
import { AnalysisRole } from '../utils/datasetProfile';
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
  proposedHypotheses: HypothesisDraftView[];
  enabledHypothesesCount: number;
  hypothesisGenerationBlockingReason: string | null;
  hypothesisGenerationError: string | null;
  backendPlanningBlockingReason: string | null;
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
  formatVariablesForDisplay: (var1?: string, var2?: string) => string;
  onSetExperienceMode: (mode: 'EXPLORE_FAST' | 'RUN_CONFIRMED') => void;
  onSetAnalysisScope: (scope: 'SINGLE_DATASET' | 'LINKED_WORKSPACE') => void;
  onSetAnalysisMode: (mode: 'PACK' | 'SINGLE') => void;
  onGeneratePackHypotheses: () => void;
  onToggleHypothesisEnabled: (id: string) => void;
  onUpdateHypothesisQuestion: (id: string, value: string) => void;
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
  proposedHypotheses,
  enabledHypothesesCount,
  hypothesisGenerationBlockingReason,
  hypothesisGenerationError,
  backendPlanningBlockingReason,
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
  formatVariablesForDisplay,
  onSetExperienceMode,
  onSetAnalysisScope,
  onSetAnalysisMode,
  onGeneratePackHypotheses,
  onToggleHypothesisEnabled,
  onUpdateHypothesisQuestion,
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

        {analysisMode !== 'SINGLE' && (
          <div className="space-y-4">
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
          {recommendedSourceFile && (
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

        {backendPlanningBlockingReason && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            {backendPlanningBlockingReason}
          </div>
        )}

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
