import React, { useMemo, useState, useEffect } from 'react';
import { Users, FileWarning, Database, Activity, Clock, FileCheck, AlertTriangle, FileText, Settings, HeartPulse, ToggleLeft, ToggleRight, Layout, Filter, Globe } from 'lucide-react';
import { ClinicalFile, ProvenanceRecord, DataType, User, UserRole, StudyType } from '../types';
import { Chart } from './Chart';

interface DashboardProps {
  files: ClinicalFile[];
  provenance: ProvenanceRecord[];
  onNavigate: (view: any) => void;
  currentUser?: User;
  studyType: StudyType;
}

export const Dashboard: React.FC<DashboardProps> = ({ files, provenance, onNavigate, currentUser, studyType }) => {
  const [viewMode, setViewMode] = useState<'OPS' | 'CLINICAL'>('OPS');

  // Auto-switch view based on role
  useEffect(() => {
    if (currentUser) {
        if (currentUser.role === UserRole.MEDICAL_MONITOR || currentUser.role === UserRole.STATISTICIAN) {
            setViewMode('CLINICAL');
        } else {
            setViewMode('OPS');
        }
    }
  }, [currentUser]);

  // 1. Calculate Metrics
  const metrics = useMemo(() => {
    let subjectCount = 0;
    let aeCount = 0;
    let seriousAE = 0;
    let totalIssues = 0;
    let qcFailures = 0;
    let ingestionEvents = provenance.filter(p => p.actionType === 'INGESTION').length;
    let cohortEvents = provenance.filter(p => p.actionType === 'COHORT_CREATION').length;
    let uniqueStudies = new Set(files.map(f => f.studyId).filter(Boolean)).size;
    
    files.forEach(f => {
      if (f.qcIssues) totalIssues += f.qcIssues.length;
      if (f.qcStatus === 'FAIL' || f.qcStatus === 'WARN') qcFailures++;
      
      if (f.content && f.type !== DataType.DOCUMENT) {
        const lines = f.content.trim().split('\n');
        if (lines.length > 1) {
            // Check for DM or Demographics
            if (f.name.toLowerCase().includes('dm') || f.name.toLowerCase().includes('demo')) {
                subjectCount += (lines.length - 1);
            }
            // Check for AE
            if (f.name.toLowerCase().includes('ae') || f.name.toLowerCase().includes('adverse')) {
                const count = lines.length - 1;
                aeCount += count;
                // Fake serious calc based on data snippet presence
                seriousAE += Math.floor(count * 0.15); 
            }
        }
      }
    });

    return { subjectCount, aeCount, totalIssues, seriousAE, qcFailures, ingestionEvents, cohortEvents, uniqueStudies };
  }, [files, provenance]);

  // 2. Prepare Charts
  const chartConfig = useMemo(() => {
    if (viewMode === 'OPS') {
        const counts = { PASS: 0, WARN: 0, FAIL: 0, PENDING: 0 };
        files.forEach(f => {
            if (f.qcStatus) counts[f.qcStatus]++;
            else counts.PENDING++;
        });

        return {
            data: [{
                values: [counts.PASS, counts.WARN, counts.FAIL],
                labels: ['Pass', 'Warning', 'Fail'],
                type: 'pie',
                marker: { colors: ['#22c55e', '#eab308', '#ef4444'] },
                hole: 0.4,
                textinfo: 'label+value',
                showlegend: true
            }],
            layout: { 
                height: 300, 
                margin: { t: 20, b: 20, l: 20, r: 20 },
                showlegend: true,
                legend: { orientation: 'h', y: -0.1 }
            }
        };
    } else {
        // Clinical View: Adverse Events by Body System (Mock)
        return {
            data: [{
                x: ['Cardiac', 'Gastro', 'Nervous', 'Skin', 'General'],
                y: [metrics.aeCount * 0.1, metrics.aeCount * 0.4, metrics.aeCount * 0.2, metrics.aeCount * 0.1, metrics.aeCount * 0.2],
                type: 'bar',
                marker: { color: studyType === StudyType.RCT ? '#6366f1' : '#9333ea' }
            }],
            layout: {
                height: 300,
                margin: { t: 20, b: 40, l: 40, r: 20 },
                xaxis: { title: 'System Organ Class' },
                yaxis: { title: 'Event Count' }
            }
        };
    }
  }, [files, viewMode, metrics, studyType]);

  const MetricCard = ({ title, value, icon: Icon, color, subtext }: any) => (
    <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex items-start space-x-4">
      <div className={`p-3 rounded-lg ${color} bg-opacity-10 text-opacity-100`}>
        <Icon className={`w-6 h-6 ${color.replace('bg-', 'text-')}`} />
      </div>
      <div>
        <p className="text-sm font-medium text-slate-500">{title}</p>
        <h3 className="text-2xl font-bold text-slate-800 mt-1">{value}</h3>
        {subtext && <p className="text-xs text-slate-400 mt-1">{subtext}</p>}
      </div>
    </div>
  );

  return (
    <div className="p-8 h-full overflow-y-auto bg-slate-50">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-8">
        <div>
          <h2 className="text-2xl font-bold text-slate-800 flex items-center">
            <Layout className="w-6 h-6 mr-3 text-slate-700" />
            Study Dashboard
            <span className={`ml-3 px-2 py-0.5 rounded text-xs font-bold border ${
                studyType === StudyType.RCT ? 'bg-medical-50 text-medical-700 border-medical-200' : 'bg-purple-50 text-purple-700 border-purple-200'
            }`}>
                {studyType} MODE
            </span>
            {metrics.uniqueStudies > 1 && (
              <span className="ml-2 px-2 py-0.5 rounded text-xs font-bold border bg-indigo-50 text-indigo-700 border-indigo-200 flex items-center">
                <Globe className="w-3 h-3 mr-1" />
                CROSS-TRIAL ({metrics.uniqueStudies} STUDIES)
              </span>
            )}
          </h2>
          <p className="text-slate-500">
             Welcome back, {currentUser?.name}. 
             {viewMode === 'OPS' ? ' Monitoring Data Quality & Pipelines.' : ' Reviewing Clinical Safety & Efficacy.'}
          </p>
        </div>
        
        <div className="flex bg-white rounded-lg p-1 border border-slate-200 shadow-sm mt-4 md:mt-0">
            <button
                onClick={() => setViewMode('OPS')}
                className={`px-4 py-2 rounded-md text-sm font-bold flex items-center transition-all ${
                    viewMode === 'OPS' 
                    ? 'bg-slate-100 text-slate-800 shadow-inner' 
                    : 'text-slate-400 hover:text-slate-600'
                }`}
            >
                <Database className="w-4 h-4 mr-2" />
                Data Ops
            </button>
            <div className="w-px bg-slate-200 mx-1 my-1"></div>
            <button
                onClick={() => setViewMode('CLINICAL')}
                className={`px-4 py-2 rounded-md text-sm font-bold flex items-center transition-all ${
                    viewMode === 'CLINICAL' 
                    ? 'bg-indigo-50 text-indigo-700 shadow-inner' 
                    : 'text-slate-400 hover:text-slate-600'
                }`}
            >
                <HeartPulse className="w-4 h-4 mr-2" />
                Scientific
            </button>
        </div>
      </div>

      {/* Metrics Grid - DYNAMIC BASED ON STUDY TYPE */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8 animate-fadeIn">
        {viewMode === 'OPS' ? (
            <>
                <MetricCard 
                    title="Total Files" 
                    value={files.length} 
                    icon={FileText} 
                    color="bg-blue-500 text-blue-600" 
                    subtext={`${metrics.ingestionEvents} ingestions tracked`}
                />
                <MetricCard 
                    title="QC Issues" 
                    value={metrics.totalIssues} 
                    icon={FileWarning} 
                    color="bg-orange-500 text-orange-600" 
                    subtext={`${metrics.qcFailures} files require attention`}
                />
                
                {/* DYNAMIC CARD 3 */}
                {studyType === StudyType.RCT ? (
                     <MetricCard 
                        title="ETL Pipelines" 
                        value={provenance.filter(p => p.actionType === 'TRANSFORMATION').length} 
                        icon={Activity} 
                        color="bg-green-500 text-green-600" 
                        subtext="SDTM Conversions"
                    />
                ) : (
                    <MetricCard 
                        title="Cohorts Built" 
                        value={metrics.cohortEvents} 
                        icon={Filter} 
                        color="bg-purple-500 text-purple-600" 
                        subtext="Filters applied"
                    />
                )}

                <MetricCard 
                    title="Validation Rate" 
                    value="92%" 
                    icon={FileCheck} 
                    color="bg-slate-500 text-slate-600" 
                    subtext="18/20 Files Validated"
                />
            </>
        ) : (
            <>
                <MetricCard 
                    title={studyType === StudyType.RCT ? "Enrolled Subjects" : "Total Lives"} 
                    value={metrics.subjectCount} 
                    icon={Users} 
                    color="bg-indigo-500 text-indigo-600" 
                    subtext={studyType === StudyType.RCT ? "Across 3 sites" : "Real-World Data"}
                />
                <MetricCard 
                    title="Total AEs" 
                    value={metrics.aeCount} 
                    icon={Activity} 
                    color="bg-yellow-500 text-yellow-600" 
                    subtext="Events Reported"
                />
                <MetricCard 
                    title="Serious AEs" 
                    value={metrics.seriousAE} 
                    icon={AlertTriangle} 
                    color="bg-red-500 text-red-600" 
                    subtext="Requires Expedited Reporting"
                />
                <MetricCard 
                    title={studyType === StudyType.RCT ? "Avg. Time on Study" : "Data Sources"} 
                    value={studyType === StudyType.RCT ? "42 Days" : "5 Registries"} 
                    icon={studyType === StudyType.RCT ? Clock : Globe} 
                    color="bg-teal-500 text-teal-600" 
                    subtext={studyType === StudyType.RCT ? "Cohort 1" : "Harmonized"}
                />
            </>
        )}
      </div>

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
              <h3 className="font-bold text-slate-800 mb-4">
                  {viewMode === 'OPS' ? 'Data Quality Overview' : (studyType === StudyType.RCT ? 'Safety Signals Overview' : 'Real-World Outcomes')}
              </h3>
              <div className="h-64 w-full">
                  <Chart data={chartConfig.data} layout={chartConfig.layout} />
              </div>
          </div>

          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
              <h3 className="font-bold text-slate-800 mb-4">
                  {viewMode === 'OPS' ? 'Recent Activity' : 'Key Findings'}
              </h3>
              <div className="space-y-4 max-h-[300px] overflow-y-auto pr-2">
                  {viewMode === 'OPS' ? (
                      provenance.slice().reverse().slice(0, 5).map((rec, i) => (
                          <div key={i} className="flex items-start pb-3 border-b border-slate-50 last:border-0">
                              <div className={`mt-1 w-2 h-2 rounded-full mr-3 ${
                                  rec.actionType === 'INGESTION' ? 'bg-blue-400' : 
                                  rec.actionType === 'TRANSFORMATION' ? 'bg-green-400' : 
                                  rec.actionType === 'COHORT_CREATION' ? 'bg-purple-400' :
                                  'bg-slate-400'
                              }`} />
                              <div>
                                  <p className="text-sm font-medium text-slate-700">{rec.actionType}</p>
                                  <p className="text-xs text-slate-500 truncate w-40">{rec.details}</p>
                                  <p className="text-[10px] text-slate-400 mt-1">{new Date(rec.timestamp).toLocaleTimeString()}</p>
                              </div>
                          </div>
                      ))
                  ) : (
                      <ul className="space-y-3">
                          <li className="p-3 bg-red-50 rounded-lg border border-red-100">
                              <div className="flex items-center text-red-700 text-xs font-bold uppercase mb-1">
                                  <AlertTriangle className="w-3 h-3 mr-1" /> Safety Alert
                              </div>
                              <p className="text-sm text-slate-700">Abnormal LFTs detected in Site 002 (Subject 002-105).</p>
                          </li>
                          <li className="p-3 bg-indigo-50 rounded-lg border border-indigo-100">
                              <div className="flex items-center text-indigo-700 text-xs font-bold uppercase mb-1">
                                  <Activity className="w-3 h-3 mr-1" /> Insight
                              </div>
                              <p className="text-sm text-slate-700">Enrollment rate for Females is 15% lower than Protocol target.</p>
                          </li>
                          <li className="p-3 bg-green-50 rounded-lg border border-green-100">
                              <div className="flex items-center text-green-700 text-xs font-bold uppercase mb-1">
                                  <FileCheck className="w-3 h-3 mr-1" /> Review
                              </div>
                              <p className="text-sm text-slate-700">Bias Audit for 'Oncology Cohort A' Passed with score 92.</p>
                          </li>
                      </ul>
                  )}
              </div>
          </div>
      </div>
    </div>
  );
};