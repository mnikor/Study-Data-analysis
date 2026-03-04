import React, { useState, useEffect, useMemo } from 'react';
import { LayoutDashboard, FileInput, Map, GitMerge, MessageSquareText, History, BarChart2, Activity, LogOut, Scale, Database, ShieldCheck, HeartPulse, Filter, TestTube, Microscope, Folder } from 'lucide-react';
import { Ingestion } from './components/Ingestion';
import { Mapping } from './components/Mapping';
import { Pipeline } from './components/Pipeline';
import { Analysis } from './components/Analysis';
import { Statistics } from './components/Statistics';
import { Provenance } from './components/Provenance';
import { Dashboard } from './components/Dashboard';
import { Login } from './components/Login';
import { BiasAudit } from './components/BiasAudit';
import { CohortBuilder } from './components/CohortBuilder';
import { ProjectSelector } from './components/ProjectSelector';
import { ClinicalFile, ProvenanceRecord, MappingSpec, ChatMessage, AnalysisSession, User, UserRole, ProvenanceType, StudyType, Project } from './types';
import { MOCK_FILES, INITIAL_PROVENANCE, MOCK_MAPPING } from './constants';

enum View {
  DASHBOARD = 'DASHBOARD',
  INGESTION = 'INGESTION',
  MAPPING = 'MAPPING',
  TRANSFORMATION = 'TRANSFORMATION',
  COHORT_BUILDER = 'COHORT_BUILDER', // New View for RWE
  STATISTICS = 'STATISTICS',
  ANALYSIS = 'ANALYSIS',
  BIAS_AUDIT = 'BIAS_AUDIT',
  PROVENANCE = 'PROVENANCE'
}

// Simple SHA-256 simulation for browser
const generateHash = async (message: string) => {
    const msgBuffer = new TextEncoder().encode(message);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return hashHex;
};

interface NavItemProps {
  view: View;
  icon: any;
  label: string;
  currentView: View;
  onNavigate: (view: View) => void;
}

const NavItem: React.FC<NavItemProps> = ({ view, icon: Icon, label, currentView, onNavigate }) => {
  return (
    <button
      onClick={() => onNavigate(view)}
      className={`w-full flex items-center space-x-3 px-4 py-2.5 rounded-lg transition-all duration-200 mb-1 ${
        currentView === view 
          ? 'bg-medical-800 text-white shadow-md' 
          : 'text-slate-400 hover:text-white hover:bg-slate-800'
      }`}
    >
      <Icon className="w-5 h-5" />
      <span className="font-medium text-sm">{label}</span>
    </button>
  );
};

const App: React.FC = () => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [currentView, setCurrentView] = useState<View>(View.DASHBOARD);
  
  const [projects, setProjects] = useState<Project[]>(() => {
    const saved = localStorage.getItem('clinical_ai_projects');
    if (saved) return JSON.parse(saved);
    
    return [{
      id: 'default-mock-project',
      name: 'Demo Clinical Trial',
      description: 'Pre-loaded with mock data for demonstration.',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ownerId: 'admin',
      studyType: StudyType.RCT,
      files: MOCK_FILES,
      provenance: INITIAL_PROVENANCE,
      mappingSpecs: [MOCK_MAPPING],
      chatMessages: [{
        id: 'welcome',
        role: 'model',
        content: 'Hello. I am ready to analyze your clinical data. Please select a mode and documents to begin.',
        timestamp: new Date().toISOString()
      }],
      statSessions: []
    }];
  });
  
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [activeStatSessionId, setActiveStatSessionId] = useState<string>('NEW');

  useEffect(() => {
    localStorage.setItem('clinical_ai_projects', JSON.stringify(projects));
  }, [projects]);

  const activeProject = projects.find(p => p.id === activeProjectId);

  const updateActiveProject = (updater: (prev: Project) => Project) => {
    setProjects(prev => prev.map(p => p.id === activeProjectId ? { ...updater(p), updatedAt: new Date().toISOString() } : p));
  };

  const files = activeProject?.files || [];
  const provenance = activeProject?.provenance || [];
  const mappingSpecs = activeProject?.mappingSpecs || [];
  const chatMessages = activeProject?.chatMessages || [];
  const statSessions = activeProject?.statSessions || [];
  const studyType = activeProject?.studyType || StudyType.RCT;

  const setChatMessages = (updater: any) => {
    updateActiveProject(p => ({
      ...p,
      chatMessages: typeof updater === 'function' ? updater(p.chatMessages) : updater
    }));
  };

  const setStatSessions = (updater: any) => {
    updateActiveProject(p => ({
      ...p,
      statSessions: typeof updater === 'function' ? updater(p.statSessions) : updater
    }));
  };

  const setStudyType = (type: StudyType) => {
    updateActiveProject(p => ({ ...p, studyType: type }));
  };

  const handleLogin = (name: string, role: UserRole) => {
    setCurrentUser({
      id: name.toLowerCase().replace(' ', '_'),
      name,
      role
    });
  };

  const handleLogout = () => {
    setCurrentUser(null);
    setActiveProjectId(null);
    setCurrentView(View.DASHBOARD);
  };

  const handleCreateProject = (name: string, description: string, type: StudyType) => {
    const newProject: Project = {
      id: crypto.randomUUID(),
      name,
      description,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ownerId: currentUser!.id,
      studyType: type,
      files: [],
      provenance: [],
      mappingSpecs: [],
      chatMessages: [{
        id: 'welcome',
        role: 'model',
        content: `Welcome to ${name}. I am ready to analyze your clinical data. Please upload documents to begin.`,
        timestamp: new Date().toISOString()
      }],
      statSessions: []
    };
    setProjects(prev => [...prev, newProject]);
    setActiveProjectId(newProject.id);
    setCurrentView(View.DASHBOARD);
  };

  const handleAddFile = (file: ClinicalFile) => {
    updateActiveProject(p => ({ ...p, files: [...p.files, file] }));
    handleRecordProvenance({
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        userId: currentUser?.name || 'Unknown',
        userRole: currentUser?.role,
        actionType: ProvenanceType.INGESTION,
        details: `Ingested file: ${file.name} (${file.size})`,
        inputs: [],
        outputs: [file.id]
    });
  };

  const handleRemoveFile = (id: string) => {
    updateActiveProject(p => ({ ...p, files: p.files.filter(f => f.id !== id) }));
  };

  const handleRecordProvenance = async (record: ProvenanceRecord) => {
    const dataToHash = `${record.id}|${record.timestamp}|${record.userId}|${record.details}|${record.inputs.join(',')}`;
    const hash = await generateHash(dataToHash);
    
    const finalRecord = { ...record, hash, userRole: currentUser?.role || 'SYSTEM' };
    updateActiveProject(p => ({ ...p, provenance: [...p.provenance, finalRecord] }));
  };

  const handleSaveSpec = (spec: MappingSpec) => {
      updateActiveProject(p => ({ ...p, mappingSpecs: [...p.mappingSpecs, spec] }));
      handleRecordProvenance({
          id: crypto.randomUUID(),
          timestamp: new Date().toISOString(),
          userId: currentUser?.name || 'Unknown',
          userRole: currentUser?.role,
          actionType: ProvenanceType.INGESTION,
          details: `Created mapping spec: ${spec.sourceDomain} -> ${spec.targetDomain}`,
          inputs: [],
          outputs: [spec.id]
      });
  };

  const renderContent = () => {
    switch (currentView) {
      case View.DASHBOARD:
        return <Dashboard files={files} provenance={provenance} onNavigate={setCurrentView} currentUser={currentUser} studyType={studyType} />;
      case View.INGESTION:
        return <Ingestion files={files} onAddFile={handleAddFile} onRemoveFile={handleRemoveFile} />;
      case View.MAPPING:
        return <Mapping files={files} onSaveSpec={handleSaveSpec} />;
      case View.TRANSFORMATION:
        return <Pipeline 
          files={files} 
          mappingSpecs={mappingSpecs} 
          onAddFile={handleAddFile} 
          onRecordProvenance={handleRecordProvenance}
          currentUser={currentUser} 
        />;
      case View.COHORT_BUILDER:
        return <CohortBuilder 
          files={files} 
          onAddFile={handleAddFile}
          onRecordProvenance={handleRecordProvenance}
          currentUser={currentUser}
        />;
      case View.STATISTICS:
        return <Statistics 
          files={files} 
          onRecordProvenance={handleRecordProvenance}
          sessions={statSessions}
          setSessions={setStatSessions}
          activeSessionId={activeStatSessionId}
          setActiveSessionId={setActiveStatSessionId}
          currentUser={currentUser}
          studyType={studyType}
        />;
      case View.ANALYSIS:
        return <Analysis 
          files={files} 
          onRecordProvenance={handleRecordProvenance} 
          messages={chatMessages}
          setMessages={setChatMessages}
        />;
      case View.BIAS_AUDIT:
        return <BiasAudit 
          files={files} 
          onRecordProvenance={handleRecordProvenance}
          currentUser={currentUser.name}
        />;
      case View.PROVENANCE:
        return <Provenance records={provenance} />;
      default:
        return <Dashboard files={files} provenance={provenance} onNavigate={setCurrentView} currentUser={currentUser} studyType={studyType} />;
    }
  };

  // Role-Based Navigation Config
  const navGroups = useMemo(() => {
      const role = currentUser?.role || UserRole.ADMIN;
      const groups = [];

      // 1. General (Everyone)
      groups.push({
          title: 'General',
          items: [
              { view: View.DASHBOARD, icon: LayoutDashboard, label: 'Dashboard' }
          ]
      });

      // 2. Data Engineering (Adaptive based on Study Type)
      if (role === UserRole.ADMIN || role === UserRole.PROGRAMMER) {
          const engineeringItems = [
              { view: View.INGESTION, icon: FileInput, label: 'Ingestion & QC' },
          ];

          if (studyType === StudyType.RCT) {
              // Clinical Trial Workflow: Rigid Mapping & Pipelines
              engineeringItems.push(
                  { view: View.MAPPING, icon: Map, label: 'Mapping Specs (SDTM)' },
                  { view: View.TRANSFORMATION, icon: GitMerge, label: 'ETL Pipeline' }
              );
          } else {
              // RWE Workflow: Cohort Building & Filtering
              engineeringItems.push(
                  { view: View.COHORT_BUILDER, icon: Filter, label: 'Cohort Builder' }
              );
          }

          groups.push({
              title: studyType === StudyType.RCT ? 'RCT Operations' : 'RWE Operations',
              items: engineeringItems
          });
      }

      // 3. Clinical Intelligence (Monitors, Statisticians, Admins)
      if (role === UserRole.ADMIN || role === UserRole.MEDICAL_MONITOR || role === UserRole.STATISTICIAN) {
          groups.push({
              title: 'Clinical Intelligence',
              items: [
                  { view: View.STATISTICS, icon: BarChart2, label: 'Statistical Analysis' },
                  { view: View.BIAS_AUDIT, icon: Scale, label: 'Bias Audit' },
                  { view: View.ANALYSIS, icon: MessageSquareText, label: 'AI Insights Chat' }
              ]
          });
      }

      // 4. Governance (Admins, Monitors, Auditors)
      if (role === UserRole.ADMIN || role === UserRole.MEDICAL_MONITOR || role === UserRole.AUDITOR || role === UserRole.PROGRAMMER) {
          groups.push({
              title: 'Governance',
              items: [
                  { view: View.PROVENANCE, icon: History, label: 'Provenance Log' }
              ]
          });
      }

      return groups;
  }, [currentUser, studyType]);

  if (!currentUser) {
    return <Login onLogin={handleLogin} />;
  }

  if (!activeProjectId || !activeProject) {
    return <ProjectSelector 
      projects={projects} 
      currentUser={currentUser} 
      onSelectProject={(id) => { setActiveProjectId(id); setCurrentView(View.DASHBOARD); }} 
      onCreateProject={handleCreateProject} 
      onLogout={handleLogout} 
    />;
  }

  return (
    <div className="flex h-screen bg-slate-100 font-sans text-slate-900">
      {/* Sidebar */}
      <div className="w-64 bg-slate-900 flex flex-col flex-shrink-0 shadow-xl z-20">
        <div className="px-6 py-6 border-b border-slate-800 mb-4">
          <div className="flex items-center space-x-2 mb-4">
            <div className="w-8 h-8 bg-medical-500 rounded-lg flex items-center justify-center shadow-lg shadow-medical-500/20">
                <Activity className="w-5 h-5 text-white" />
            </div>
            <span className="text-xl font-bold text-white tracking-tight">ClinicalAI</span>
          </div>
          
          {/* Study Mode Switcher */}
          <div className="bg-slate-800 p-1 rounded-lg flex">
              <button
                onClick={() => setStudyType(StudyType.RCT)}
                className={`flex-1 flex items-center justify-center py-1.5 text-[10px] font-bold rounded transition-all ${
                    studyType === StudyType.RCT
                    ? 'bg-medical-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                  <TestTube className="w-3 h-3 mr-1" />
                  RCT
              </button>
              <button
                onClick={() => setStudyType(StudyType.RWE)}
                className={`flex-1 flex items-center justify-center py-1.5 text-[10px] font-bold rounded transition-all ${
                    studyType === StudyType.RWE
                    ? 'bg-purple-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                  <Microscope className="w-3 h-3 mr-1" />
                  RWE
              </button>
          </div>
          <div className="mt-2 text-[10px] text-slate-500 text-center">
              {studyType === StudyType.RCT ? 'Strict Control • Blinding • GxP' : 'Big Data • Cohorts • Retrospective'}
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-4 space-y-6">
          {navGroups.map((group, idx) => (
              <div key={idx} className="animate-fadeIn" style={{ animationDelay: `${idx * 100}ms` }}>
                  <h3 className="px-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2 flex items-center">
                      {group.title.includes('Data Engineering') && <Database className="w-3 h-3 mr-1" />}
                      {group.title.includes('Operations') && <Database className="w-3 h-3 mr-1" />}
                      {group.title === 'Clinical Intelligence' && <HeartPulse className="w-3 h-3 mr-1" />}
                      {group.title === 'Governance' && <ShieldCheck className="w-3 h-3 mr-1" />}
                      {group.title}
                  </h3>
                  <div>
                      {group.items.map(item => (
                          <NavItem 
                            key={item.view} 
                            view={item.view} 
                            icon={item.icon} 
                            label={item.label} 
                            currentView={currentView}
                            onNavigate={setCurrentView}
                          />
                      ))}
                  </div>
              </div>
          ))}
        </nav>

        <div className="mt-auto p-4 border-t border-slate-800 bg-slate-900">
           <button 
             onClick={() => setActiveProjectId(null)}
             className="w-full flex items-center justify-center space-x-2 px-4 py-2 bg-slate-800 text-slate-300 rounded-lg hover:bg-slate-700 hover:text-white transition-colors text-xs font-bold uppercase tracking-wide border border-slate-700 hover:border-slate-600 mb-4"
           >
             <Folder className="w-4 h-4" />
             <span>Switch Project</span>
           </button>
           <div className="flex items-center space-x-3 px-2 mb-4">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white shadow-sm ${
                  currentUser.role === UserRole.ADMIN ? 'bg-purple-600' :
                  currentUser.role === UserRole.MEDICAL_MONITOR ? 'bg-indigo-600' :
                  currentUser.role === UserRole.PROGRAMMER ? 'bg-blue-600' :
                  currentUser.role === UserRole.AUDITOR ? 'bg-orange-600' :
                  'bg-slate-600'
              }`}>
                  {currentUser.name.charAt(0)}
              </div>
              <div className="flex-1 overflow-hidden">
                <p className="text-sm font-medium text-white truncate" title={currentUser.name}>{currentUser.name}</p>
                <p className="text-[10px] text-slate-400 uppercase tracking-wider font-bold">{currentUser.role.replace('_', ' ')}</p>
              </div>
           </div>
           <button 
             onClick={handleLogout}
             className="w-full flex items-center justify-center space-x-2 px-4 py-2 bg-slate-800 text-slate-300 rounded-lg hover:bg-slate-700 hover:text-white transition-colors text-xs font-bold uppercase tracking-wide border border-slate-700 hover:border-slate-600"
           >
             <LogOut className="w-3 h-3" />
             <span>Sign Out</span>
           </button>
        </div>
      </div>

      {/* Main Content */}
      <main className="flex-1 overflow-hidden relative">
        {renderContent()}
      </main>
    </div>
  );
};

export default App;