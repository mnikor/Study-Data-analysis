import React, { useState } from 'react';
import { ShieldCheck, Scale, AlertTriangle, CheckCircle, Users, Activity, Play, Loader2, Info, Building2 } from 'lucide-react';
import { ClinicalFile, DataType, BiasReport, ProvenanceRecord, ProvenanceType } from '../types';
import { generateBiasAudit } from '../services/geminiService';
import { InfoTooltip } from './InfoTooltip';

interface BiasAuditProps {
  files: ClinicalFile[];
  onRecordProvenance: (record: ProvenanceRecord) => void;
  currentUser: string;
}

export const BiasAudit: React.FC<BiasAuditProps> = ({ files, onRecordProvenance, currentUser }) => {
  const [dmFileId, setDmFileId] = useState<string>('');
  const [aeFileId, setAeFileId] = useState<string>('');
  const [indication, setIndication] = useState<string>('');
  const [isAuditing, setIsAuditing] = useState(false);
  const [report, setReport] = useState<BiasReport | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const rawFiles = files.filter(f => f.type === DataType.RAW || f.type === DataType.STANDARDIZED);

  const handleRunAudit = async () => {
    if (!dmFileId || !indication) return;
    
    setIsAuditing(true);
    setReport(null);
    setErrorMsg(null);

    const dmFile = files.find(f => f.id === dmFileId)!;
    const aeFile = aeFileId ? files.find(f => f.id === aeFileId) : undefined;

    try {
        const result = await generateBiasAudit(dmFile, indication, aeFile);
        if (result) {
            setReport(result);
            
            // Record Provenance
            onRecordProvenance({
                id: crypto.randomUUID(),
                timestamp: new Date().toISOString(),
                userId: currentUser,
                actionType: ProvenanceType.BIAS_AUDIT,
                details: `Bias Audit run for ${indication}. Risk Level: ${result.riskLevel}`,
                inputs: aeFile ? [dmFileId, aeFileId] : [dmFileId],
                outputs: []
            });
        } else {
            setErrorMsg("Failed to generate bias audit. Please try again.");
        }
    } catch (e: any) {
        console.error("Audit failed", e);
        setErrorMsg(e.message || "An error occurred during the audit.");
    } finally {
        setIsAuditing(false);
    }
  };

  const getScoreColor = (score: number) => {
      if (score >= 80) return 'text-green-600';
      if (score >= 60) return 'text-yellow-600';
      return 'text-red-600';
  };

  const getStatusColor = (status: string) => {
      switch(status) {
          case 'OPTIMAL': return 'bg-green-100 text-green-800 border-green-200';
          case 'WARN': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
          case 'CRITICAL': return 'bg-red-100 text-red-800 border-red-200';
          default: return 'bg-slate-100 text-slate-800';
      }
  };

  return (
    <div className="p-8 h-full overflow-y-auto bg-slate-50">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-slate-800 flex items-center">
            <Scale className="w-6 h-6 mr-3 text-medical-600" />
            Bias Audit
            <InfoTooltip className="ml-2" content="Checks whether the dataset or analysis setup may systematically favor one group or outcome over another." />
        </h2>
        <p className="text-slate-500">
            AI-driven assessment of demographic parity, site heterogeneity, and safety signal reporting bias.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* CONFIGURATION PANEL */}
          <div className="lg:col-span-1 space-y-6">
              <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                  <h3 className="font-bold text-slate-800 mb-4 flex items-center">
                      <ShieldCheck className="w-5 h-5 mr-2 text-slate-400" />
                      Audit Configuration
                  </h3>
                  
                  <div className="space-y-4">
                      <div>
                          <label className="block text-sm font-semibold text-slate-700 mb-2">Indication / Therapeutic Area</label>
                          <input 
                              type="text" 
                              value={indication}
                              onChange={(e) => setIndication(e.target.value)}
                              placeholder="e.g. Type 2 Diabetes, Oncology..."
                              className="w-full p-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-medical-500 outline-none text-sm"
                          />
                          <p className="text-xs text-slate-400 mt-1">Used to determine medical population norms.</p>
                      </div>

                      <div>
                          <label className="block text-sm font-semibold text-slate-700 mb-2">Demographics File (Required)</label>
                          <div className="relative">
                            <select 
                                value={dmFileId}
                                onChange={(e) => setDmFileId(e.target.value)}
                                className="w-full p-2.5 pl-9 border border-slate-300 rounded-lg focus:ring-2 focus:ring-medical-500 outline-none text-sm bg-white appearance-none"
                            >
                                <option value="">-- Select DM Dataset --</option>
                                {rawFiles.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                            </select>
                            <Users className="absolute left-3 top-2.5 w-4 h-4 text-slate-400 pointer-events-none" />
                          </div>
                      </div>

                      <div>
                          <label className="block text-sm font-semibold text-slate-700 mb-2">Adverse Events File (Optional)</label>
                          <div className="relative">
                            <select 
                                value={aeFileId}
                                onChange={(e) => setAeFileId(e.target.value)}
                                className="w-full p-2.5 pl-9 border border-slate-300 rounded-lg focus:ring-2 focus:ring-medical-500 outline-none text-sm bg-white appearance-none"
                            >
                                <option value="">-- Select AE Dataset --</option>
                                {rawFiles.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                            </select>
                            <Activity className="absolute left-3 top-2.5 w-4 h-4 text-slate-400 pointer-events-none" />
                          </div>
                      </div>

                      <button
                        onClick={handleRunAudit}
                        disabled={isAuditing || !dmFileId || !indication}
                        className={`w-full py-3 rounded-lg font-bold flex items-center justify-center shadow-md transition-all mt-2 ${
                            isAuditing || !dmFileId || !indication
                            ? 'bg-slate-200 text-slate-400 cursor-not-allowed' 
                            : 'bg-indigo-600 text-white hover:bg-indigo-700 hover:shadow-lg'
                        }`}
                      >
                        {isAuditing ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : <Play className="w-5 h-5 mr-2" />}
                        {isAuditing ? 'Auditing Data...' : 'Run Bias Check'}
                      </button>

                      {errorMsg && (
                          <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600 flex items-start">
                              <AlertTriangle className="w-5 h-5 mr-2 flex-shrink-0" />
                              <span>{errorMsg}</span>
                          </div>
                      )}
                  </div>
              </div>

              {/* Tips Panel */}
              <div className="bg-blue-50 p-6 rounded-xl border border-blue-100">
                  <h4 className="font-bold text-blue-800 mb-2 flex items-center">
                      <Info className="w-4 h-4 mr-2" />
                      Why perform this audit?
                  </h4>
                  <ul className="text-sm text-blue-700 space-y-2 list-disc pl-4">
                      <li>Ensure regulatory compliance with diversity action plans (FDA/EMA).</li>
                      <li>Detect under-reporting of safety signals in specific sub-groups.</li>
                      <li>Identify site-specific operational anomalies early.</li>
                  </ul>
              </div>
          </div>

          {/* RESULTS PANEL */}
          <div className="lg:col-span-2 space-y-6">
              {!report && !isAuditing && (
                  <div className="h-full min-h-[400px] flex flex-col items-center justify-center border-2 border-dashed border-slate-300 rounded-xl text-slate-400">
                      <Scale className="w-16 h-16 mb-4 opacity-20" />
                      <p className="font-medium">Configure and run audit to view results.</p>
                  </div>
              )}

              {report && (
                  <div className="space-y-6 animate-fadeIn">
                      {/* Scorecard */}
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col items-center justify-center text-center">
                              <span className="text-slate-500 text-xs font-bold uppercase tracking-wider mb-2">Fairness Score</span>
                              <div className="relative">
                                  <svg className="w-32 h-32 transform -rotate-90">
                                      <circle cx="64" cy="64" r="56" stroke="currentColor" strokeWidth="12" fill="transparent" className="text-slate-100" />
                                      <circle cx="64" cy="64" r="56" stroke="currentColor" strokeWidth="12" fill="transparent" 
                                        strokeDasharray={351.86} 
                                        strokeDashoffset={351.86 - (351.86 * report.overallFairnessScore) / 100}
                                        className={`${getScoreColor(report.overallFairnessScore)} transition-all duration-1000 ease-out`} 
                                      />
                                  </svg>
                                  <span className={`absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 text-3xl font-bold ${getScoreColor(report.overallFairnessScore)}`}>
                                      {report.overallFairnessScore}
                                  </span>
                              </div>
                          </div>

                          <div className="col-span-2 bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
                              <div className="flex justify-between items-start mb-4">
                                  <h3 className="font-bold text-slate-800">Risk Assessment</h3>
                                  <span className={`px-3 py-1 rounded-full text-xs font-bold ${
                                      report.riskLevel === 'HIGH' ? 'bg-red-100 text-red-700' : 
                                      report.riskLevel === 'MEDIUM' ? 'bg-yellow-100 text-yellow-700' : 
                                      'bg-green-100 text-green-700'
                                  }`}>
                                      {report.riskLevel} RISK
                                  </span>
                              </div>
                              <p className="text-slate-600 text-sm leading-relaxed">
                                  {report.narrativeAnalysis}
                              </p>
                          </div>
                      </div>

                      {/* Demographic Breakdown */}
                      <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
                          <h3 className="font-bold text-slate-800 mb-6 flex items-center">
                              <Users className="w-5 h-5 mr-2 text-indigo-500" />
                              Demographic Parity Analysis
                          </h3>
                          <div className="space-y-4">
                              {report.demographicAnalysis.map((metric, idx) => (
                                  <div key={idx} className="p-4 bg-slate-50 rounded-lg border border-slate-100">
                                      <div className="flex justify-between items-center mb-2">
                                          <h4 className="font-semibold text-slate-700">{metric.category}</h4>
                                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${getStatusColor(metric.status)}`}>
                                              {metric.status}
                                          </span>
                                      </div>
                                      <p className="text-sm text-slate-600 mb-3">{metric.finding}</p>
                                      {/* Progress Bar representation of the score */}
                                      <div className="w-full bg-slate-200 rounded-full h-2">
                                          <div 
                                            className={`h-2 rounded-full ${
                                                metric.score > 80 ? 'bg-green-500' : metric.score > 50 ? 'bg-yellow-500' : 'bg-red-500'
                                            }`} 
                                            style={{ width: `${metric.score}%` }}
                                          ></div>
                                      </div>
                                  </div>
                              ))}
                          </div>
                      </div>

                      {/* Site Anomalies */}
                      {report.siteAnomalies && report.siteAnomalies.length > 0 && (
                          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
                              <h3 className="font-bold text-slate-800 mb-6 flex items-center">
                                  <Building2 className="w-5 h-5 mr-2 text-orange-500" />
                                  Site-Specific Anomalies
                              </h3>
                              <div className="overflow-x-auto">
                                  <table className="w-full text-left text-sm">
                                      <thead className="bg-slate-50 text-slate-500 font-semibold">
                                          <tr>
                                              <th className="px-4 py-3 rounded-l-lg">Site ID</th>
                                              <th className="px-4 py-3">Detected Issue</th>
                                              <th className="px-4 py-3 rounded-r-lg">Deviation</th>
                                          </tr>
                                      </thead>
                                      <tbody className="divide-y divide-slate-100">
                                          {report.siteAnomalies.map((anom, idx) => (
                                              <tr key={idx}>
                                                  <td className="px-4 py-3 font-mono text-slate-700 font-medium">{anom.siteId}</td>
                                                  <td className="px-4 py-3 text-red-600">{anom.issue}</td>
                                                  <td className="px-4 py-3 text-slate-500">{anom.deviation}</td>
                                              </tr>
                                          ))}
                                      </tbody>
                                  </table>
                              </div>
                          </div>
                      )}

                      {/* Recommendations */}
                      <div className="bg-green-50 p-6 rounded-xl border border-green-100">
                          <h3 className="font-bold text-green-800 mb-4 flex items-center">
                              <CheckCircle className="w-5 h-5 mr-2" />
                              Actionable Recommendations
                          </h3>
                          <ul className="space-y-2">
                              {report.recommendations.map((rec, idx) => (
                                  <li key={idx} className="flex items-start text-green-700 text-sm">
                                      <span className="mr-2 mt-1.5 w-1.5 h-1.5 bg-green-500 rounded-full flex-shrink-0" />
                                      {rec}
                                  </li>
                              ))}
                          </ul>
                      </div>
                  </div>
              )}
          </div>
      </div>
    </div>
  );
};
