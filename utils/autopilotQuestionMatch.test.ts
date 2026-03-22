import { describe, expect, it } from 'vitest';
import { AutopilotDataScope, AutopilotExecutionMode, StatTestType, StatAnalysisResult } from '../types';
import { assessAutopilotQuestionMatch } from './autopilotQuestionMatch';

const linkedSingleContext = {
  analysisScope: 'LINKED_WORKSPACE' as AutopilotDataScope,
  analysisMode: 'SINGLE' as AutopilotExecutionMode,
  testType: StatTestType.CHI_SQUARE,
  var1: 'DM_1774113027906_ARM_MODE',
  var2: 'NCT06120140_SIMULATED_COMORBIDITIES_ARM',
};

describe('assessAutopilotQuestionMatch', () => {
  it('rejects a generic linked-workspace chi-square result for an incidence and risk-difference question', () => {
    const result: StatAnalysisResult = {
      metrics: {
        chi_square_statistic: 0.23,
        p_value: 0.88,
      },
      interpretation: 'Computed a chi-square association between treatment arm and comorbidity arm.',
      chartConfig: {
        data: [],
        layout: { title: { text: 'Arm mode vs comorbidity arm' } },
      },
      tableConfig: {
        title: 'Contingency table',
        columns: ['DM_1774113027906_ARM_MODE', 'NCT06120140_SIMULATED_COMORBIDITIES_ARM', 'COUNT'],
        rows: [
          {
            DM_1774113027906_ARM_MODE: 'Enhanced_DM',
            NCT06120140_SIMULATED_COMORBIDITIES_ARM: 'High',
            COUNT: 12,
          },
        ],
      },
      executedCode: '# local chi-square',
    };

    const assessment = assessAutopilotQuestionMatch(
      'Among Asian women >=65, what is the cumulative incidence of Grade ≥2 DAEIs by Week 12 in COCOON DM (enhanced) vs SoC DM, and what is the risk difference + 95% CI?',
      result,
      linkedSingleContext
    );

    expect(assessment.status).toBe('FAILED');
    expect(assessment.summary).toMatch(/did not answer the requested question/i);
    expect(assessment.details.some((detail) => /risk-difference/i.test(detail) || /risk difference/i.test(detail))).toBe(true);
  });

  it('accepts a backend risk-difference result for the same type of question', () => {
    const result: StatAnalysisResult = {
      metrics: {
        risk_difference: -0.12,
        ci_lower_95: -0.2,
        ci_upper_95: -0.04,
      },
      interpretation: 'Computed subject-level incidence by treatment and estimated the risk difference with a 95% confidence interval.',
      chartConfig: {
        data: [],
        layout: { title: { text: 'Incidence by treatment group' } },
      },
      tableConfig: {
        title: 'Incidence by treatment group',
        columns: ['TRT_ARM', 'N', 'EVENT_N', 'INCIDENCE_PCT'],
        rows: [
          { TRT_ARM: 'Enhanced_DM', N: 40, EVENT_N: 8, INCIDENCE_PCT: 20 },
          { TRT_ARM: 'SoC_DM', N: 42, EVENT_N: 13, INCIDENCE_PCT: 31 },
        ],
      },
      executedCode: '# FastAPI deterministic backend execution',
      backendExecution: {
        engine: 'FASTAPI',
        analysisFamily: 'risk_difference',
        workspaceId: 'ws_1',
        sourceNames: ['dm.csv', 'ae.csv', 'lb.csv'],
      },
    };

    const assessment = assessAutopilotQuestionMatch(
      'Among Asian women >=65, what is the cumulative incidence of Grade ≥2 DAEIs by Week 12 in COCOON DM (enhanced) vs SoC DM, and what is the risk difference + 95% CI?',
      result,
      {
        ...linkedSingleContext,
        testType: StatTestType.CHI_SQUARE,
        var1: 'TRT_ARM',
        var2: 'GRADE2_DAEI_BY_WEEK12',
      }
    );

    expect(assessment.status).toBe('MATCHED');
  });
});
