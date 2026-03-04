import React, { useState } from 'react';
import { ShieldCheck, User, Activity, Briefcase } from 'lucide-react';
import { UserRole } from '../types';

interface LoginProps {
  onLogin: (name: string, role: UserRole) => void;
}

export const Login: React.FC<LoginProps> = ({ onLogin }) => {
  const [name, setName] = useState('Dr. Smith');
  const [role, setRole] = useState<UserRole>(UserRole.ADMIN);
  const [isLoading, setIsLoading] = useState(false);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    // Simulate network delay
    setTimeout(() => {
      onLogin(name, role);
      setIsLoading(false);
    }, 800);
  };

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col justify-center items-center p-4">
      <div className="mb-8 text-center animate-fadeIn">
        <div className="w-16 h-16 bg-medical-500 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-medical-500/20">
          <Activity className="w-10 h-10 text-white" />
        </div>
        <h1 className="text-3xl font-bold text-white tracking-tight">ClinicalInsights AI</h1>
        <p className="text-slate-400 mt-2">GxP-Compliant Data Analysis Platform</p>
      </div>

      <div className="bg-white rounded-2xl p-8 w-full max-w-md shadow-2xl animate-fadeIn">
        <h2 className="text-xl font-bold text-slate-800 mb-6 flex items-center">
          <ShieldCheck className="w-5 h-5 mr-2 text-medical-600" />
          Secure Workspace
        </h2>

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">Username</label>
            <div className="relative">
              <User className="absolute left-3 top-3 w-5 h-5 text-slate-400" />
              <input 
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full pl-10 pr-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-medical-500 outline-none transition-all"
                required
                placeholder="Enter your name"
              />
            </div>
          </div>

          <div>
             <label className="block text-sm font-semibold text-slate-700 mb-2">Select Role</label>
             <div className="relative">
                <Briefcase className="absolute left-3 top-3 w-5 h-5 text-slate-400" />
                <select 
                    value={role}
                    onChange={(e) => setRole(e.target.value as UserRole)}
                    className="w-full pl-10 pr-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-medical-500 outline-none transition-all bg-white"
                >
                    <option value={UserRole.ADMIN}>Admin (Full Access)</option>
                    <option value={UserRole.PROGRAMMER}>Clinical Programmer (Data Ops)</option>
                    <option value={UserRole.MEDICAL_MONITOR}>Medical Monitor (Reviewer)</option>
                    <option value={UserRole.STATISTICIAN}>Statistician (Analysis)</option>
                    <option value={UserRole.AUDITOR}>Quality Assurance (Auditor)</option>
                </select>
             </div>
             <p className="text-xs text-slate-400 mt-1 ml-1">
                 {role === UserRole.PROGRAMMER ? 'Access to Ingestion, Mapping, Pipelines.' : 
                  role === UserRole.MEDICAL_MONITOR ? 'Access to Bias Audit, Analysis, Dashboard.' :
                  role === UserRole.STATISTICIAN ? 'Access to Statistics, Analysis, Dashboard.' :
                  role === UserRole.AUDITOR ? 'Read-Only Access to Provenance & Logs.' :
                  'Full access to all modules.'}
             </p>
          </div>

          <div className="pt-4">
            <button 
              type="submit"
              disabled={isLoading}
              className="w-full bg-medical-600 text-white py-3 rounded-xl font-bold hover:bg-medical-700 transition-all shadow-lg shadow-medical-500/30 flex justify-center items-center"
            >
              {isLoading ? (
                <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
              ) : (
                'Enter Application'
              )}
            </button>
          </div>
        </form>

        <div className="mt-6 pt-6 border-t border-slate-100 text-center">
           <p className="text-xs text-slate-400">
             Authorized Use Only. Activities are logged for audit purposes.
           </p>
        </div>
      </div>
    </div>
  );
};