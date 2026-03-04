import React, { useState, useMemo, useEffect } from 'react';
import { Calculator, BarChart3, AlertCircle, Play, Code, ArrowLeft, Terminal, CheckCircle2, Plus, History, Trash2, ChevronRight, Layout, Sparkles, Lightbulb, Download, FileJson, FileType, ChevronDown, FileText, BookOpen, FlaskConical, ShieldAlert, Lock, Unlock, Microscope, Copy, Check, Globe, ArrowRight, Settings } from 'lucide-react';
import { ClinicalFile, DataType, StatTestType, StatAnalysisResult, ProvenanceRecord, ProvenanceType, StatAnalysisStep, AnalysisSession, StatSuggestion, User, UsageMode, StudyType } from '../types';
import { generateStatisticalCode, executeStatisticalCode, generateStatisticalSuggestions, generateSASCode } from '../services/geminiService';
import { Chart } from './Chart';

interface StatisticsProps {
  files: ClinicalFile[];
  onRecordProvenance: (record: ProvenanceRecord) => void;
  sessions: AnalysisSession[];
  setSessions: React.Dispatch<React.SetStateAction<AnalysisSession[]>>;
  activeSessionId: string;
  setActiveSessionId: (id: string) => void;
  currentUser: User;
  studyType: StudyType;
}

export const Statistics: React.FC<StatisticsProps> = ({ files, onRecordProvenance, sessions, setSessions, activeSessionId, setActiveSessionId, currentUser, studyType }) => {
  // Wizard State (for 'NEW' session)
  const [step, setStep] = useState<StatAnalysisStep>(StatAnalysisStep.CONFIGURATION);
  const [selectedFileId, setSelectedFileId] = useState<string>('');
  const [selectedContextIds, setSelectedContextIds] = useState<Set<string>>(new Set()); 
  const [testType, setTestType] = useState<StatTestType>(StatTestType.T_TEST);
  const [variable1, setVariable1] = useState('');
  const [variable2, setVariable2] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // GxP Mode State
  const [usageMode, setUsageMode] = useState<UsageMode>(UsageMode.EXPLORATORY);

  // Suggestion State
  const [suggestions, setSuggestions] = useState<StatSuggestion[]>([]);
  const [isSuggesting, setIsSuggesting] = useState(false);

  // Execution State
  const [generatedCode, setGeneratedCode] = useState<string>('');
  const [sasCode, setSasCode] = useState<string>(''); // SAS Code State
  const [activeCodeTab, setActiveCodeTab] = useState<'PYTHON' | 'SAS'>('PYTHON');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isGeneratingSas, setIsGeneratingSas] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<StatAnalysisResult | null>(null);

  // Advanced Adjustments State
  const [covariates, setCovariates] = useState<string[]>([]);
  const [imputationMethod, setImputationMethod] = useState<string>('None');
  const [applyPSM, setApplyPSM] = useState<boolean>(false);

  // Load Active Session
  const activeSession = useMemo(() => sessions.find(s => s.id === activeSessionId), [sessions, activeSessionId]);
  const rawFiles = useMemo(() => files.filter(f => f.type === DataType.RAW || f.type === DataType.STANDARDIZED || f.type === DataType.COHORT_DEF), [files]);
  const docFiles = useMemo(() => files.filter(f => f.type === DataType.DOCUMENT), [files]);
  const selectedFile = rawFiles.find(f => f.id === selectedFileId);

  useEffect(() => {
    if (activeSessionId === 'NEW') {
      resetWizard();
    } else if (activeSession) {
      setStep(StatAnalysisStep.RESULTS);
      setResult(activeSession);
      setSelectedFileId(activeSession.params.fileId);
      setTestType(activeSession.params.testType);
      setVariable1(activeSession.params.var1);
      setVariable2(activeSession.params.var2);
      setGeneratedCode(activeSession.executedCode);
      setSasCode(activeSession.sasCode || '');
      setUsageMode(activeSession.usageMode);
    }
  }, [activeSessionId, activeSession]);

  const resetWizard = () => {
    setStep(StatAnalysisStep.CONFIGURATION);
    setGeneratedCode('');
    setSasCode('');
    setResult(null);
    setSuggestions([]);
    setUsageMode(UsageMode.EXPLORATORY);
    setActiveCodeTab('PYTHON');
    setCovariates([]);
    setImputationMethod('None');
    setApplyPSM(false);
  };

  const availableColumns = useMemo(() => {
    if (!selectedFile || !selectedFile.content) return [];
    return selectedFile.content.split('\n')[0].split(',').map(c => c.trim());
  }, [selectedFile]);

  const toggleContextDoc = (id: string) => {
    const newSet = new Set(selectedContextIds);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setSelectedContextIds(newSet);
  };

  const handleGenerateSuggestions = async () => {
    if (!selectedFile) return;
    setIsSuggesting(true);
    
    // Add a timeout to prevent hanging indefinitely
    const timeoutPromise = new Promise<StatSuggestion[]>((_, reject) => {
        setTimeout(() => reject(new Error("Suggestion request timed out")), 180000);
    });

    try {
        const suggs = await Promise.race([
            generateStatisticalSuggestions(selectedFile),
            timeoutPromise
        ]);
        setSuggestions(suggs);
    } catch (e: any) {
        console.error("Suggestion error:", e);
        setErrorMsg(e.message || "AI Suggestion timed out or failed. Please select variables manually.");
    } finally {
        setIsSuggesting(false);
    }
  };

  const applySuggestion = (s: StatSuggestion) => {
      setTestType(s.testType);
      setVariable1(s.var1);
      setVariable2(s.var2);
  };

  const handleGenerateCode = async () => {
    if (!selectedFile || !variable1 || availableColumns.length === 0) {
      setErrorMsg("Please select a valid file and at least one variable.");
      return;
    }
    setIsGenerating(true);
    setErrorMsg(null);
    
    const timeoutPromise = new Promise<string>((_, reject) => {
        setTimeout(() => reject(new Error("Code generation timed out")), 120000);
    });

    try {
      const contextDocs = docFiles.filter(d => selectedContextIds.has(d.id));
      const code = await Promise.race([
          generateStatisticalCode(selectedFile, testType, variable1, variable2, contextDocs, covariates, imputationMethod, applyPSM),
          timeoutPromise
      ]);
      setGeneratedCode(code);
      setStep(StatAnalysisStep.CODE_REVIEW);
      setActiveCodeTab('PYTHON');
    } catch (e: any) {
      setErrorMsg(e.message || "Failed to generate code.");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleGenerateSAS = async () => {
      if (!selectedFile || !generatedCode) return;
      setIsGeneratingSas(true);
      
      const timeoutPromise = new Promise<string>((_, reject) => {
          setTimeout(() => reject(new Error("SAS generation timed out")), 120000);
      });

      try {
          const sas = await Promise.race([
              generateSASCode(selectedFile, testType, variable1, variable2, generatedCode, covariates, imputationMethod, applyPSM),
              timeoutPromise
          ]);
          setSasCode(sas);
      } catch (e: any) {
          console.error(e);
          setErrorMsg(e.message || "Failed to generate SAS code.");
      } finally {
          setIsGeneratingSas(false);
      }
  };

  const handleRunAnalysis = async () => {
    if (!selectedFile || !generatedCode) return;
    setIsRunning(true);
    
    const timeoutPromise = new Promise<StatAnalysisResult | null>((_, reject) => {
        setTimeout(() => reject(new Error("Analysis execution timed out")), 180000);
    });

    try {
      const res = await Promise.race([
          executeStatisticalCode(generatedCode, selectedFile, testType),
          timeoutPromise
      ]);
      if (res) {
        const enrichedResult = { ...res, sasCode }; // Attach SAS code if generated
        setResult(enrichedResult);
        setStep(StatAnalysisStep.RESULTS);

        // Save Session
        const newSession: AnalysisSession = {
          id: crypto.randomUUID(),
          timestamp: new Date().toISOString(),
          name: `${testType} - ${variable1} vs ${variable2 || 'None'}`,
          usageMode: usageMode,
          params: { fileId: selectedFileId, fileName: selectedFile.name, testType, var1: variable1, var2: variable2, covariates, imputationMethod, applyPSM },
          ...enrichedResult
        };
        setSessions(prev => [newSession, ...prev]);
        setActiveSessionId(newSession.id);

        // Provenance
        onRecordProvenance({
          id: crypto.randomUUID(),
          timestamp: new Date().toISOString(),
          userId: currentUser.name,
          userRole: currentUser.role,
          actionType: ProvenanceType.STATISTICS,
          details: `Ran ${testType}. Mode: ${usageMode}. Result: ${res.interpretation.substring(0, 50)}...`,
          inputs: [selectedFileId, ...Array.from(selectedContextIds)],
          outputs: []
        });
      } else {
        setErrorMsg("Execution returned no results.");
      }
    } catch (e: any) {
      setErrorMsg(e.message || "Analysis execution failed.");
    } finally {
      setIsRunning(false);
    }
  };

  const handleDeleteSession = (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      setSessions(prev => prev.filter(s => s.id !== id));
      if (activeSessionId === id) setActiveSessionId('NEW');
  };

  return (
    <div className="flex h-full bg-slate-50">
      {/* Sidebar History */}
      <div className="w-64 bg-white border-r border-slate-200 flex flex-col">
        <div className="p-4 border-b border-slate-200">
           <button 
             onClick={() => setActiveSessionId('NEW')}
             className="w-full flex items-center justify-center space-x-2 bg-medical-600 text-white py-2.5 rounded-lg hover:bg-medical-700 transition-colors shadow-sm font-medium"
           >
             <Plus className="w-4 h-4" />
             <span>New Analysis</span>
           </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
           {sessions.length === 0 && (
             <div className="text-center p-4 text-slate-400 text-sm italic">No analysis history</div>
           )}
           {sessions.map(s => (
             <div 
               key={s.id}
               onClick={() => setActiveSessionId(s.id)}
               className={`group flex items-center justify-between p-3 rounded-lg cursor-pointer transition-all ${
                 activeSessionId === s.id ? 'bg-medical-50 text-medical-700 border border-medical-200' : 'hover:bg-slate-50 text-slate-600 border border-transparent'
               }`}
             >
               <div className="overflow-hidden">
                 <div className="font-medium text-sm truncate">{s.name}</div>
                 <div className="text-xs opacity-70 flex items-center mt-1">
                    <History className="w-3 h-3 mr-1" />
                    {new Date(s.timestamp).toLocaleDateString()}
                 </div>
               </div>
               <button 
                  onClick={(e) => handleDeleteSession(e, s.id)}
                  className="p-1.5 opacity-0 group-hover:opacity-100 hover:bg-red-50 hover:text-red-600 rounded transition-all"
               >
                 <Trash2 className="w-3 h-3" />
               </button>
             </div>
           ))}
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {step === StatAnalysisStep.CONFIGURATION && (
          <div className="flex-1 overflow-y-auto p-8 animate-fadeIn">
             <div className="max-w-4xl mx-auto">
                <div className="mb-8">
                  <h2 className="text-2xl font-bold text-slate-800 flex items-center">
                    <Calculator className="w-6 h-6 mr-3 text-medical-600" />
                    Statistical Configuration
                  </h2>
                  <p className="text-slate-500">Define your test parameters, select data, and choose analysis mode.</p>
                </div>

                {errorMsg && (
                   <div className="mb-6 bg-red-50 text-red-700 p-4 rounded-lg flex items-center border border-red-200">
                     <AlertCircle className="w-5 h-5 mr-3" />
                     {errorMsg}
                   </div>
                )}

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                   <div className="lg:col-span-2 space-y-6">
                      {/* Step 1: Data Selection */}
                      <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
                         <h3 className="font-bold text-slate-800 mb-4 flex items-center">
                            <div className="w-6 h-6 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center text-xs mr-3">1</div>
                            Data Source
                         </h3>
                         <div className="space-y-4">
                            <div>
                              <label className="block text-sm font-semibold text-slate-700 mb-2">Select Dataset (Raw or Standardized)</label>
                              <select 
                                value={selectedFileId}
                                onChange={(e) => setSelectedFileId(e.target.value)}
                                className="w-full p-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-medical-500 outline-none bg-slate-50 text-sm"
                              >
                                <option value="">-- Choose File --</option>
                                {rawFiles.map(f => (
                                  <option key={f.id} value={f.id}>{f.name}</option>
                                ))}
                              </select>
                            </div>
                         </div>
                      </div>

                      {/* Step 2: Protocol Context */}
                      <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
                          <h3 className="font-bold text-slate-800 mb-4 flex items-center">
                            <div className="w-6 h-6 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center text-xs mr-3">2</div>
                            Protocol Context (RAG)
                         </h3>
                         <p className="text-xs text-slate-500 mb-3">Select documents to ground the code generation (e.g. SAP rules, Exclusion criteria).</p>
                         <div className="max-h-40 overflow-y-auto space-y-2 border border-slate-100 rounded-lg p-2 bg-slate-50">
                            {docFiles.length === 0 && <span className="text-xs text-slate-400 italic">No documents uploaded.</span>}
                            {docFiles.map(doc => (
                                <div 
                                    key={doc.id} 
                                    onClick={() => toggleContextDoc(doc.id)}
                                    className={`flex items-center p-2 rounded cursor-pointer transition-colors ${selectedContextIds.has(doc.id) ? 'bg-indigo-50 border border-indigo-200' : 'hover:bg-white border border-transparent'}`}
                                >
                                    <div className={`w-4 h-4 rounded border mr-3 flex items-center justify-center ${selectedContextIds.has(doc.id) ? 'bg-indigo-600 border-indigo-600' : 'bg-white border-slate-300'}`}>
                                        {selectedContextIds.has(doc.id) && <Check className="w-3 h-3 text-white" />}
                                    </div>
                                    <FileText className="w-4 h-4 text-slate-400 mr-2" />
                                    <span className={`text-sm ${selectedContextIds.has(doc.id) ? 'text-indigo-900 font-medium' : 'text-slate-600'}`}>{doc.name}</span>
                                </div>
                            ))}
                         </div>
                      </div>

                      {/* Step 3: Test Config */}
                      <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm relative overflow-hidden">
                         {isSuggesting && <div className="absolute inset-0 bg-white/80 z-10 flex items-center justify-center"><Sparkles className="w-8 h-8 text-indigo-500 animate-pulse" /></div>}
                         <div className="flex justify-between items-center mb-4">
                            <h3 className="font-bold text-slate-800 flex items-center">
                                <div className="w-6 h-6 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center text-xs mr-3">3</div>
                                Analysis Definition
                            </h3>
                            <button 
                                onClick={handleGenerateSuggestions}
                                disabled={!selectedFileId || isSuggesting}
                                className="text-xs bg-indigo-50 text-indigo-600 px-3 py-1.5 rounded-full font-medium hover:bg-indigo-100 transition-colors flex items-center"
                            >
                                <Lightbulb className="w-3 h-3 mr-1" />
                                AI Suggest
                            </button>
                         </div>
                         
                         <div className="grid grid-cols-2 gap-4">
                            <div className="col-span-2">
                               <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Statistical Test</label>
                               <select 
                                 value={testType}
                                 onChange={(e) => setTestType(e.target.value as StatTestType)}
                                 className="w-full p-2 border border-slate-300 rounded focus:ring-2 focus:ring-medical-500 outline-none text-sm"
                               >
                                 {Object.values(StatTestType).map(t => <option key={t} value={t}>{t}</option>)}
                               </select>
                            </div>
                            <div>
                               <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Variable 1 (Group/X)</label>
                               <select 
                                 value={variable1}
                                 onChange={(e) => setVariable1(e.target.value)}
                                 className="w-full p-2 border border-slate-300 rounded focus:ring-2 focus:ring-medical-500 outline-none text-sm"
                               >
                                 <option value="">- Select -</option>
                                 {availableColumns.map(c => <option key={c} value={c}>{c}</option>)}
                               </select>
                            </div>
                            <div>
                               <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Variable 2 (Outcome/Y)</label>
                               <select 
                                 value={variable2}
                                 onChange={(e) => setVariable2(e.target.value)}
                                 className="w-full p-2 border border-slate-300 rounded focus:ring-2 focus:ring-medical-500 outline-none text-sm"
                               >
                                 <option value="">- Select -</option>
                                 {availableColumns.map(c => <option key={c} value={c}>{c}</option>)}
                               </select>
                            </div>
                         </div>

                         {/* Advanced Adjustments Section */}
                         {studyType === StudyType.RWE && (
                             <div className="mt-6 pt-4 border-t border-slate-200">
                                 <h4 className="text-sm font-semibold text-slate-800 mb-3 flex items-center">
                                     <Settings className="w-4 h-4 mr-2 text-slate-500" />
                                     Advanced Adjustments (RWE)
                                 </h4>
                                 <div className="space-y-4">
                                     <div>
                                         <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Covariates (Confounders)</label>
                                         <select 
                                             multiple
                                             value={covariates}
                                             onChange={(e) => {
                                                 const options = Array.from(e.target.selectedOptions, option => option.value);
                                                 setCovariates(options);
                                             }}
                                             className="w-full p-2 border border-slate-300 rounded focus:ring-2 focus:ring-medical-500 outline-none text-sm h-24"
                                         >
                                             {availableColumns.map(c => <option key={c} value={c}>{c}</option>)}
                                         </select>
                                         <p className="text-[10px] text-slate-400 mt-1">Hold Ctrl/Cmd to select multiple.</p>
                                     </div>
                                     <div className="grid grid-cols-2 gap-4">
                                         <div>
                                             <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Missing Data Imputation</label>
                                             <select 
                                                 value={imputationMethod}
                                                 onChange={(e) => setImputationMethod(e.target.value)}
                                                 className="w-full p-2 border border-slate-300 rounded focus:ring-2 focus:ring-medical-500 outline-none text-sm"
                                             >
                                                 <option value="None">None (Drop Missing)</option>
                                                 <option value="Mean/Mode Imputation">Mean/Mode Imputation</option>
                                                 <option value="Multiple Imputation (MICE)">Multiple Imputation (MICE)</option>
                                                 <option value="Last Observation Carried Forward (LOCF)">LOCF</option>
                                             </select>
                                         </div>
                                         <div className="flex items-end pb-1">
                                             <label className="flex items-center space-x-2 cursor-pointer">
                                                 <input 
                                                     type="checkbox" 
                                                     checked={applyPSM}
                                                     onChange={(e) => setApplyPSM(e.target.checked)}
                                                     className="rounded border-slate-300 text-medical-600 focus:ring-medical-500"
                                                 />
                                                 <span className="text-sm font-medium text-slate-700">Apply Propensity Score Matching (PSM)</span>
                                             </label>
                                         </div>
                                     </div>
                                 </div>
                             </div>
                         )}
                         
                         {/* Suggestions Display */}
                         {suggestions.length > 0 && (
                             <div className="mt-4 bg-indigo-50 rounded-lg p-3 border border-indigo-100">
                                 <p className="text-xs font-bold text-indigo-700 mb-2 uppercase flex items-center"><Sparkles className="w-3 h-3 mr-1"/> Recommended</p>
                                 <div className="space-y-2">
                                     {suggestions.map((s, idx) => (
                                         <button key={idx} onClick={() => applySuggestion(s)} className="w-full text-left p-2 bg-white rounded border border-indigo-100 hover:border-indigo-300 text-xs flex justify-between items-center group transition-all">
                                             <span className="font-medium text-slate-700">{s.testType}: {s.var1} vs {s.var2}</span>
                                             <ArrowRight className="w-3 h-3 text-indigo-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                                         </button>
                                     ))}
                                 </div>
                             </div>
                         )}
                      </div>
                   </div>

                   <div className="space-y-6">
                       {/* Usage Mode Card */}
                       <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
                           <h3 className="font-bold text-slate-800 mb-4">GxP Usage Mode</h3>
                           <div className="space-y-3">
                               <button 
                                 onClick={() => setUsageMode(UsageMode.EXPLORATORY)}
                                 className={`w-full p-3 rounded-lg border text-left transition-all ${usageMode === UsageMode.EXPLORATORY ? 'bg-blue-50 border-blue-500 ring-1 ring-blue-500' : 'bg-white border-slate-200 hover:bg-slate-50'}`}
                               >
                                   <div className="flex items-center mb-1">
                                       <FlaskConical className={`w-4 h-4 mr-2 ${usageMode === UsageMode.EXPLORATORY ? 'text-blue-600' : 'text-slate-400'}`} />
                                       <span className={`font-bold text-sm ${usageMode === UsageMode.EXPLORATORY ? 'text-blue-800' : 'text-slate-700'}`}>Exploratory</span>
                                   </div>
                                   <p className="text-xs text-slate-500">Sandbox mode. Code is not signed. Results are for internal hypothesis generation only.</p>
                               </button>

                               <button 
                                 onClick={() => setUsageMode(UsageMode.OFFICIAL)}
                                 className={`w-full p-3 rounded-lg border text-left transition-all ${usageMode === UsageMode.OFFICIAL ? 'bg-green-50 border-green-500 ring-1 ring-green-500' : 'bg-white border-slate-200 hover:bg-slate-50'}`}
                               >
                                   <div className="flex items-center mb-1">
                                       <ShieldAlert className={`w-4 h-4 mr-2 ${usageMode === UsageMode.OFFICIAL ? 'text-green-600' : 'text-slate-400'}`} />
                                       <span className={`font-bold text-sm ${usageMode === UsageMode.OFFICIAL ? 'text-green-800' : 'text-slate-700'}`}>Official (GxP)</span>
                                   </div>
                                   <p className="text-xs text-slate-500">Requires audit trail, version control, and code review signatures. For CSRs.</p>
                               </button>
                           </div>
                       </div>

                       <button
                         onClick={handleGenerateCode}
                         disabled={isGenerating || !selectedFileId || availableColumns.length === 0}
                         className={`w-full py-4 rounded-xl font-bold flex items-center justify-center shadow-lg transition-all text-sm ${
                             isGenerating || !selectedFileId || availableColumns.length === 0
                             ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                             : 'bg-medical-600 text-white hover:bg-medical-700 hover:shadow-xl'
                         }`}
                       >
                         {isGenerating ? <Layout className="w-5 h-5 mr-2 animate-spin" /> : <Code className="w-5 h-5 mr-2" />}
                         {isGenerating ? 'Drafting Code...' : 'Generate Analysis Code'}
                       </button>
                   </div>
                </div>
             </div>
          </div>
        )}

        {/* STEP 2: CODE REVIEW (PYTHON & SAS) */}
        {step === StatAnalysisStep.CODE_REVIEW && (
           <div className="flex-1 flex flex-col h-full bg-[#1e1e1e]">
               {/* Header Toolbar */}
               <div className="px-6 py-4 bg-[#252526] border-b border-[#3e3e3e] flex justify-between items-center">
                   <div className="flex items-center">
                       <button onClick={() => setStep(StatAnalysisStep.CONFIGURATION)} className="text-slate-400 hover:text-white mr-4">
                           <ArrowLeft className="w-5 h-5" />
                       </button>
                       <div>
                           <h3 className="text-white font-bold flex items-center text-sm">
                               <Terminal className="w-4 h-4 mr-2 text-blue-400" />
                               Review & Execute
                           </h3>
                           <p className="text-[#a0a0a0] text-xs">Review the generated Python code or translate to SAS.</p>
                       </div>
                   </div>
                   
                   <div className="flex items-center space-x-4">
                       <div className="flex bg-[#333] rounded p-1">
                           <button 
                             onClick={() => setActiveCodeTab('PYTHON')}
                             className={`px-3 py-1.5 rounded text-xs font-bold transition-all ${activeCodeTab === 'PYTHON' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}
                           >
                             Python (Execution)
                           </button>
                           <button 
                             onClick={() => setActiveCodeTab('SAS')}
                             className={`px-3 py-1.5 rounded text-xs font-bold transition-all ${activeCodeTab === 'SAS' ? 'bg-orange-600 text-white' : 'text-slate-400 hover:text-white'}`}
                           >
                             SAS (Validation)
                           </button>
                       </div>

                       <button 
                          onClick={handleRunAnalysis}
                          disabled={isRunning || !generatedCode}
                          className={`px-6 py-2 rounded font-bold text-sm flex items-center transition-all ${
                              isRunning ? 'bg-green-800 text-green-200 cursor-wait' : 'bg-green-600 hover:bg-green-500 text-white'
                          }`}
                       >
                           {isRunning ? <Play className="w-4 h-4 mr-2 animate-spin" /> : <Play className="w-4 h-4 mr-2" />}
                           {isRunning ? 'Executing...' : 'Run Analysis'}
                       </button>
                   </div>
               </div>

               {/* Editor Area */}
               <div className="flex-1 flex overflow-hidden">
                   {/* Line Numbers (Fake) */}
                   <div className="w-12 bg-[#1e1e1e] border-r border-[#333] text-[#666] text-right pr-3 pt-4 text-xs font-mono select-none hidden md:block">
                       {Array.from({length: 20}).map((_, i) => <div key={i}>{i+1}</div>)}
                   </div>

                   {/* Code Content */}
                   <div className="flex-1 overflow-auto p-4 font-mono text-sm">
                       {activeCodeTab === 'PYTHON' ? (
                           <textarea 
                             value={generatedCode}
                             onChange={(e) => setGeneratedCode(e.target.value)}
                             className="w-full h-full bg-transparent text-[#d4d4d4] outline-none resize-none"
                             spellCheck={false}
                           />
                       ) : (
                           // SAS View
                           <div className="h-full flex flex-col">
                               {sasCode ? (
                                   <textarea 
                                     value={sasCode}
                                     onChange={(e) => setSasCode(e.target.value)}
                                     className="w-full h-full bg-transparent text-[#d4d4d4] outline-none resize-none"
                                     spellCheck={false}
                                   />
                               ) : (
                                   <div className="flex-1 flex flex-col items-center justify-center text-[#666]">
                                       <Globe className="w-16 h-16 mb-4 opacity-20" />
                                       <p className="mb-6 max-w-md text-center">
                                           Generate SAS code (SAS 9.4+ compatible) equivalent to the current Python logic for regulatory validation.
                                       </p>
                                       <button 
                                         onClick={handleGenerateSAS}
                                         disabled={isGeneratingSas}
                                         className="px-6 py-3 bg-orange-700 hover:bg-orange-600 text-white rounded font-bold transition-colors flex items-center"
                                       >
                                           {isGeneratingSas ? <Sparkles className="w-4 h-4 mr-2 animate-spin" /> : <Code className="w-4 h-4 mr-2" />}
                                           Generate SAS Translation
                                       </button>
                                   </div>
                               )}
                           </div>
                       )}
                   </div>
               </div>
           </div>
        )}

        {/* STEP 3: RESULTS */}
        {step === StatAnalysisStep.RESULTS && result && (
            <div className="flex-1 overflow-y-auto p-8 animate-fadeIn">
                <div className="max-w-6xl mx-auto">
                    {/* Header */}
                    <div className="flex justify-between items-start mb-8">
                        <div>
                             <div className="flex items-center space-x-3 mb-2">
                                <button onClick={() => setStep(StatAnalysisStep.CODE_REVIEW)} className="text-slate-400 hover:text-slate-600">
                                    <ArrowLeft className="w-5 h-5" />
                                </button>
                                <h2 className="text-2xl font-bold text-slate-800">Analysis Results</h2>
                                {usageMode === UsageMode.OFFICIAL && (
                                    <span className="px-2 py-0.5 bg-green-100 text-green-800 text-xs font-bold rounded border border-green-200 flex items-center">
                                        <Lock className="w-3 h-3 mr-1" /> GxP Locked
                                    </span>
                                )}
                             </div>
                             <p className="text-slate-500">{activeSession?.name}</p>
                        </div>
                        <div className="flex space-x-3">
                             {/* Download Buttons */}
                        </div>
                    </div>
                    
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                        {/* Left: Stats & Interpretation */}
                        <div className="space-y-6">
                            <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
                                <h3 className="font-bold text-slate-800 mb-4 flex items-center">
                                    <Calculator className="w-5 h-5 mr-2 text-blue-500" />
                                    Calculated Metrics
                                </h3>
                                <div className="space-y-0 divide-y divide-slate-100">
                                    {Object.entries(result.metrics).map(([key, val]) => (
                                        <div key={key} className="py-3 flex justify-between items-center">
                                            <span className="text-sm font-medium text-slate-500 capitalize">{key.replace(/_/g, ' ')}</span>
                                            <span className="text-sm font-bold text-slate-800 font-mono">{val}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="bg-indigo-50 p-6 rounded-xl border border-indigo-100 shadow-sm">
                                <h3 className="font-bold text-indigo-900 mb-3 flex items-center">
                                    <Lightbulb className="w-5 h-5 mr-2" />
                                    Clinical Interpretation
                                </h3>
                                <p className="text-indigo-800 text-sm leading-relaxed">
                                    {result.interpretation}
                                </p>
                            </div>

                            {/* Code Toggle Section */}
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

                        {/* Right: Visualization */}
                        <div className="lg:col-span-2">
                            <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm h-full flex flex-col">
                                <h3 className="font-bold text-slate-800 mb-4 flex items-center">
                                    <BarChart3 className="w-5 h-5 mr-2 text-purple-500" />
                                    Visualization
                                </h3>
                                <div className="flex-1 min-h-[400px]">
                                    <Chart data={result.chartConfig.data} layout={result.chartConfig.layout} />
                                </div>
                                <p className="text-center text-xs text-slate-400 mt-4">
                                    Figure 1. {activeSession?.name}
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        )}
      </div>
    </div>
  );
};