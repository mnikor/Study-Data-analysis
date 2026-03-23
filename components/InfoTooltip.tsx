import React from 'react';
import { Info } from 'lucide-react';

interface InfoTooltipProps {
  content: string;
  className?: string;
}

export const InfoTooltip: React.FC<InfoTooltipProps> = ({ content, className = '' }) => {
  return (
    <span className={`group relative inline-flex items-center ${className}`}>
      <span
        aria-label="More information"
        className="inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full text-slate-400 transition-colors hover:text-slate-600"
      >
        <Info className="h-3.5 w-3.5" />
      </span>
      <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-2 hidden w-60 -translate-x-1/2 rounded-lg border border-slate-200 bg-slate-900 px-3 py-2 text-left text-[11px] font-medium leading-5 text-white shadow-xl group-hover:block">
        {content}
      </span>
    </span>
  );
};
