import React, { useEffect, useRef } from 'react';

declare global {
  interface Window {
    Plotly: any;
  }
}

interface ChartProps {
  data: any[];
  layout: any;
}

export const Chart: React.FC<ChartProps> = ({ data, layout }) => {
  const plotRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (window.Plotly && plotRef.current) {
      // Ensure layout is responsive
      const responsiveLayout = {
        ...layout,
        autosize: true,
        margin: { l: 50, r: 20, t: 40, b: 40, ...layout.margin },
      };
      
      const config = { 
        responsive: true, 
        displayModeBar: true,
        displaylogo: false
      };

      window.Plotly.newPlot(plotRef.current, data, responsiveLayout, config);
    }
  }, [data, layout]);

  return <div ref={plotRef} className="w-full h-96 bg-white rounded-lg border border-slate-200 shadow-sm" />;
};