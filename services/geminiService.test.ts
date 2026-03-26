import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClinicalFile, DataType, QCIssue, StatTestType } from '../types';
import {
  buildChatContextText,
  buildTabularChatContext,
  executeStatisticalCode,
  extractCohortFiltersFromProtocol,
  extractPreSpecifiedAnalysisPlan,
  generateAnalysis,
  generateCleaningSuggestion,
  runQualityCheck,
} from './geminiService';

const protocolFile: ClinicalFile = {
  id: 'p1',
  name: 'Protocol.txt',
  type: DataType.DOCUMENT,
  uploadDate: new Date().toISOString(),
  size: '1 KB',
  content: [
    'Inclusion Criteria:',
    '- Age >= 18 years',
    '- Sex = Female',
    'Exclusion Criteria:',
    '- Exclude Age < 18',
  ].join('\n'),
};

const sourceFile: ClinicalFile = {
  id: 's1',
  name: 'analysis.csv',
  type: DataType.RAW,
  uploadDate: new Date().toISOString(),
  size: '1 KB',
  content: [
    'ARM,AETERM,AGE,CHG_SCORE',
    'Placebo,Headache,45,1.2',
    'Active,Rash,52,3.5',
    'Active,Dermatitis,49,2.8',
  ].join('\n'),
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('extractCohortFiltersFromProtocol', () => {
  it('extracts filters from protocol text using fallback parser', async () => {
    const originalKey = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = '';
    try {
      const { filters } = await extractCohortFiltersFromProtocol(protocolFile, ['AGE', 'SEX', 'ARM']);
      const ageFilters = filters.filter((f) => f.field === 'AGE');
      const sexFilters = filters.filter((f) => f.field === 'SEX');

      expect(ageFilters.length).toBeGreaterThan(0);
      expect(sexFilters.length).toBeGreaterThan(0);
      expect(sexFilters.some((f) => f.operator === 'EQUALS' && f.value.toLowerCase().includes('female'))).toBe(true);
    } finally {
      process.env.GEMINI_API_KEY = originalKey;
    }
  });
});

describe('extractPreSpecifiedAnalysisPlan', () => {
  it('extracts at least one mapped pre-specified analysis with fallback path', async () => {
    const originalKey = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = '';
    try {
      const { plan } = await extractPreSpecifiedAnalysisPlan(
        {
          ...protocolFile,
          content: [
            'Statistical Analysis Plan',
            'Primary analysis: Compare adverse event incidence by treatment arm using chi-square test.',
            'Secondary analysis: compare CHG_SCORE by treatment arm using t-test.',
          ].join('\n'),
        },
        sourceFile
      );

      expect(plan.length).toBeGreaterThan(0);
      expect(plan.some((p) => p.var1 === 'ARM')).toBe(true);
    } finally {
      process.env.GEMINI_API_KEY = originalKey;
    }
  });
});

describe('executeStatisticalCode', () => {
  it('throws a readable execution error for invalid statistical setup', async () => {
    const badFile: ClinicalFile = {
      id: 'bad',
      name: 'bad.csv',
      type: DataType.RAW,
      uploadDate: new Date().toISOString(),
      size: '1 KB',
      content: [
        'ARM,CHG_SCORE',
        'Active,1.2',
        'Active,2.0',
        'Active,1.8',
      ].join('\n'),
    };

    await expect(
      executeStatisticalCode('print("run")', badFile, StatTestType.T_TEST, 'ARM', 'CHG_SCORE')
    ).rejects.toThrow('T-Test requires exactly two groups');
  });

  it('returns a normal statistical result shape when FastAPI execution succeeds', async () => {
    const adtteFile: ClinicalFile = {
      id: 'adtte_backend',
      name: 'adtte.csv',
      type: DataType.STANDARDIZED,
      uploadDate: new Date().toISOString(),
      size: '1 KB',
      content: [
        'USUBJID,TRT01A,PARAMCD,PARAM,AVAL,CNSR',
        '01,DrugA,OS,Overall Survival,10,0',
        '02,DrugA,OS,Overall Survival,12,1',
        '03,DrugB,OS,Overall Survival,8,0',
        '04,DrugB,OS,Overall Survival,14,1',
      ].join('\n'),
    };

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'executable',
          analysis_family: 'cox',
          executable: true,
          requires_row_level_data: true,
          missing_roles: [],
          warnings: [],
          explanation: 'supported',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'executable',
          spec: {
            analysis_family: 'cox',
            term_filters: [],
            cohort_filters: [],
            covariates: [],
            interaction_terms: [],
            requested_outputs: ['hazard_ratio', 'confidence_interval'],
            notes: [],
          },
          missing_roles: [],
          warnings: [],
          explanation: 'planned',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'executable',
          workspace_id: 'ws_mock',
          source_names: ['adtte.csv'],
          missing_roles: [],
          row_count: 4,
          column_count: 4,
          derived_columns: ['SURVIVAL_TIME', 'SURVIVAL_EVENT'],
          notes: [],
          explanation: 'built',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'executable',
          executed: true,
          analysis_family: 'cox',
          workspace_id: 'ws_mock',
          interpretation: 'Computed a Cox proportional hazards model from the survival workspace.',
          metrics: [
            { name: 'analysis_method', value: 'cox_proportional_hazards' },
            { name: 'subjects_used', value: 4 },
          ],
          table: {
            title: 'Cox proportional hazards coefficients',
            columns: ['predictor', 'coefficient', 'hazard_ratio', 'ci_lower_95', 'ci_upper_95', 'p_value'],
            rows: [
              {
                predictor: 'TRT01A_DrugB',
                coefficient: 0.5,
                hazard_ratio: 1.65,
                ci_lower_95: 0.9,
                ci_upper_95: 3.0,
                p_value: 0.12,
              },
            ],
          },
          warnings: [],
          explanation: 'executed',
        }),
      });

    vi.stubGlobal('fetch', fetchMock);

    const result = await executeStatisticalCode(
      'print("backend")',
      adtteFile,
      StatTestType.COX_PH,
      'TRT01A',
      'AVAL',
      null,
      { question: 'Estimate the hazard ratio for overall survival by treatment.' }
    );

    expect(result.metrics.analysis_method).toBe('cox_proportional_hazards');
    expect(result.tableConfig?.title).toMatch(/Cox proportional hazards/i);
    expect(result.executedCode).toMatch(/Deterministic analysis engine execution/i);
    expect(result.backendExecution?.analysisFamily).toBe('cox');
    expect(result.backendExecution?.workspaceId).toBe('ws_mock');
  });

  it('does not overwrite backend-planned survival variables from transformed workspace headers in multi-file execution', async () => {
    const transformedWorkspaceFile: ClinicalFile = {
      id: 'workspace_dm',
      name: 'workspace_dm.csv',
      type: DataType.STANDARDIZED,
      uploadDate: new Date().toISOString(),
      size: '1 KB',
      content: [
        'DM_ARM_MODE,SITEID,DERIVED_SCORE',
        'ArmA,S1,1.2',
        'ArmB,S2,2.1',
      ].join('\n'),
    };

    const adslFile: ClinicalFile = {
      id: 'adsl_backend',
      name: 'NCT06120140_ADSL.csv',
      type: DataType.STANDARDIZED,
      uploadDate: new Date().toISOString(),
      size: '1 KB',
      content: [
        'USUBJID,TRT01A,AGE,SEX,RACE',
        '01,DrugA,70,F,ASIAN',
        '02,DrugA,68,F,ASIAN',
        '03,DrugB,73,F,ASIAN',
      ].join('\n'),
    };

    const adaeFile: ClinicalFile = {
      id: 'adae_backend',
      name: 'NCT06120140_ADAE.csv',
      type: DataType.STANDARDIZED,
      uploadDate: new Date().toISOString(),
      size: '1 KB',
      content: [
        'USUBJID,AETOXGR,AESTDY,AEENDY,AETERM',
        '01,2,20,28,Rash',
        '02,2,18,31,Dermatitis',
        '03,3,17,27,Rash',
      ].join('\n'),
    };

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'executable',
          analysis_family: 'cox',
          executable: true,
          requires_row_level_data: true,
          missing_roles: [],
          warnings: [],
          explanation: 'supported',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'executable',
          spec: {
            analysis_family: 'cox',
            target_definition: 'time_to_resolution_grade_2_plus_dae',
            term_filters: [],
            cohort_filters: [],
            covariates: [],
            interaction_terms: ['treatment*all'],
            requested_outputs: ['hazard_ratio', 'confidence_interval'],
            notes: [],
          },
          missing_roles: [],
          warnings: [],
          explanation: 'planned',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'executable',
          workspace_id: 'ws_mock',
          source_names: ['NCT06120140_ADSL.csv', 'NCT06120140_ADAE.csv'],
          missing_roles: [],
          row_count: 3,
          column_count: 6,
          derived_columns: ['AE_TIME_TO_RESOLUTION', 'AE_RESOLUTION_EVENT'],
          notes: [],
          explanation: 'built',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'executable',
          executed: true,
          analysis_family: 'cox',
          workspace_id: 'ws_mock',
          interpretation: 'Computed a Cox proportional hazards model for time to resolution.',
          metrics: [{ name: 'analysis_method', value: 'cox_proportional_hazards' }],
          warnings: [],
          explanation: 'executed',
        }),
      });

    vi.stubGlobal('fetch', fetchMock);

    await executeStatisticalCode(
      'print("backend")',
      transformedWorkspaceFile,
      StatTestType.COX_PH,
      'DM_ARM_MODE',
      'SITEID',
      null,
      {
        question:
          'Among participants who develop Grade >=2 DAEIs, what factors predict time to resolution (faster vs slower recovery), and do these predictors differ by arm?',
        sourceFiles: [adslFile, adaeFile],
        backendSpec: {
          analysis_family: 'cox',
          target_definition: 'time_to_resolution_grade_2_plus_dae',
          interaction_terms: ['treatment*all'],
          cohort_filters: [],
          covariates: [],
          requested_outputs: ['hazard_ratio'],
          notes: [],
        },
      }
    );

    const workspaceRequest = JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body || '{}'));
    expect(workspaceRequest.spec?.treatment_variable).toBeUndefined();
    expect(workspaceRequest.spec?.time_variable).toBeUndefined();
  });

  it('supports exploratory feature importance through the FastAPI execution bridge', async () => {
    const adslFile: ClinicalFile = {
      id: 'adsl_backend',
      name: 'adsl.csv',
      type: DataType.STANDARDIZED,
      uploadDate: new Date().toISOString(),
      size: '1 KB',
      content: [
        'USUBJID,TRT01A,AGE,SEX,RACE',
        '01,DrugA,70,F,ASIAN',
        '02,DrugA,68,F,ASIAN',
        '03,DrugB,73,F,ASIAN',
        '04,DrugB,66,F,ASIAN',
      ].join('\n'),
    };

    const adaeFile: ClinicalFile = {
      id: 'adae_backend',
      name: 'adae.csv',
      type: DataType.STANDARDIZED,
      uploadDate: new Date().toISOString(),
      size: '1 KB',
      content: [
        'USUBJID,AETOXGR,AESTDY,AETERM',
        '01,2,20,Rash',
        '03,3,18,Dermatitis',
      ].join('\n'),
    };

    const adlbFile: ClinicalFile = {
      id: 'adlb_backend',
      name: 'adlb.csv',
      type: DataType.STANDARDIZED,
      uploadDate: new Date().toISOString(),
      size: '1 KB',
      content: [
        'USUBJID,PARAMCD,AVAL,ABLFL',
        '01,HGB,11.2,Y',
        '02,HGB,12.8,Y',
        '03,HGB,10.4,Y',
        '04,HGB,13.1,Y',
      ].join('\n'),
    };

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'executable',
          analysis_family: 'feature_importance',
          executable: true,
          requires_row_level_data: true,
          missing_roles: [],
          warnings: [],
          explanation: 'supported',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'executable',
          spec: {
            analysis_family: 'feature_importance',
            term_filters: ['rash'],
            cohort_filters: [],
            covariates: ['AGE'],
            interaction_terms: [],
            requested_outputs: ['feature_importance', 'partial_dependence'],
            notes: [],
          },
          missing_roles: [],
          warnings: [],
          explanation: 'planned',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'executable',
          workspace_id: 'ws_ml',
          source_names: ['adsl.csv', 'adae.csv', 'adlb.csv'],
          missing_roles: [],
          row_count: 4,
          column_count: 7,
          derived_columns: ['AE_OUTCOME_FLAG', 'LAB_HGB'],
          notes: [],
          explanation: 'built',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'executable',
          executed: true,
          analysis_family: 'feature_importance',
          workspace_id: 'ws_ml',
          interpretation: 'Computed exploratory feature importance.',
          metrics: [
            { name: 'analysis_method', value: 'random_forest_feature_importance' },
            { name: 'subjects_used', value: 4 },
          ],
          table: {
            title: 'Exploratory feature importance ranking',
            columns: ['predictor', 'importance'],
            rows: [
              { predictor: 'AGE', importance: 0.42 },
              { predictor: 'LAB_HGB', importance: 0.31 },
            ],
          },
          warnings: [],
          explanation: 'executed',
        }),
      });

    vi.stubGlobal('fetch', fetchMock);

    const result = await executeStatisticalCode(
      'print("backend")',
      adslFile,
      StatTestType.REGRESSION,
      'TRT01A',
      'AGE',
      null,
      {
        question: 'Which baseline variables are the strongest predictors of Grade >=2 dermatologic adverse events by Week 12?',
        sourceFiles: [adslFile, adaeFile, adlbFile],
      }
    );

    expect(result.metrics.analysis_method).toBe('random_forest_feature_importance');
    expect(result.tableConfig?.title).toMatch(/feature importance/i);
    expect(result.backendExecution?.analysisFamily).toBe('feature_importance');
  });
});

describe('generateAnalysis', () => {
  it('runs deterministic exploratory analysis in chat for a single selected tabular dataset', async () => {
    const response = await generateAnalysis(
      'Compare age by arm and show the distribution',
      [
        {
          id: 'chat_dm',
          name: 'dm.csv',
          type: DataType.RAW,
          uploadDate: new Date().toISOString(),
          size: '1 KB',
          content: [
            'ARM,AGE',
            'Placebo,61',
            'Placebo,59',
            'Active,66',
            'Active,70',
          ].join('\n'),
        },
      ],
      'RAG',
      []
    );

    expect(response.answer).toMatch(/Exploratory analysis executed/i);
    expect(response.chartConfig).toBeTruthy();
    expect(response.tableConfig).toBeTruthy();
    expect(response.keyInsights?.[0]).toMatch(/deterministic exploratory/i);
  });

  it('runs Kaplan-Meier exploratory analysis in chat when an ADTTE dataset is selected', async () => {
    const response = await generateAnalysis(
      'Compare overall survival between treatment arms',
      [
        {
          id: 'chat_adtte',
          name: 'adtte.csv',
          type: DataType.STANDARDIZED,
          uploadDate: new Date().toISOString(),
          size: '1 KB',
          content: [
            'USUBJID,TRT01A,PARAMCD,PARAM,AVAL,CNSR',
            '01,DrugA,OS,Overall Survival,10,0',
            '02,DrugA,OS,Overall Survival,12,1',
            '03,DrugB,OS,Overall Survival,8,0',
            '04,DrugB,OS,Overall Survival,14,1',
          ].join('\n'),
        },
      ],
      'RAG',
      []
    );

    expect(response.answer).toMatch(/Kaplan-Meier/i);
    expect(response.chartConfig?.layout?.title?.text).toMatch(/Kaplan-Meier/i);
    expect(response.tableConfig?.columns).toContain('median_survival');
  });

  it('routes multi-file survival requests to the FastAPI backend guard instead of answering from summaries', async () => {
    const response = await generateAnalysis(
      'Estimate the hazard ratio for overall survival by treatment using baseline age as a covariate.',
      [
        {
          id: 'adsl_survival_chat',
          name: 'adsl.csv',
          type: DataType.STANDARDIZED,
          uploadDate: new Date().toISOString(),
          size: '1 KB',
          content: [
            'USUBJID,TRT01A,AGE',
            '01,DrugA,68',
            '02,DrugA,72',
            '03,DrugB,64',
            '04,DrugB,70',
          ].join('\n'),
        },
        {
          id: 'adtte_survival_chat',
          name: 'adtte.csv',
          type: DataType.STANDARDIZED,
          uploadDate: new Date().toISOString(),
          size: '1 KB',
          content: [
            'USUBJID,PARAMCD,PARAM,AVAL,CNSR',
            '01,OS,Overall Survival,10,0',
            '02,OS,Overall Survival,12,1',
            '03,OS,Overall Survival,8,0',
            '04,OS,Overall Survival,14,1',
          ].join('\n'),
        },
      ],
      'RAG',
      []
    );

    expect(response.answer).toMatch(/full analysis run/i);
    expect(response.tableConfig).toBeUndefined();
  });

  it('blocks advanced multi-dataset chat requests instead of generating illustrative charts', async () => {
    const response = await generateAnalysis(
      'Which baseline variables are the strongest predictors of Grade 2+ adverse events by Week 12? Provide feature importance and partial dependence summaries.',
      [
        {
          id: 'adsl_chat',
          name: 'adsl.csv',
          type: DataType.STANDARDIZED,
          uploadDate: new Date().toISOString(),
          size: '1 KB',
          content: [
            'USUBJID,TRT01A,AGE,SEX,RACE',
            '01,DrugA,65,F,Asian',
            '02,DrugB,70,M,White',
          ].join('\n'),
        },
        {
          id: 'adae_chat',
          name: 'adae.csv',
          type: DataType.STANDARDIZED,
          uploadDate: new Date().toISOString(),
          size: '1 KB',
          content: [
            'USUBJID,AETERM,AETOXGR,AESTDY',
            '01,Rash,2,15',
            '02,Nausea,1,20',
          ].join('\n'),
        },
      ],
      'STUFFING',
      []
    );

    expect(response.answer).toMatch(/full analysis run/i);
    expect(response.answer).toMatch(/cannot be answered from summaries alone|not enough for questions such as/i);
    expect(response.chartConfig).toBeUndefined();
  });

  it('answers dataset-feasibility questions in plain language instead of backend jargon', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: 'executable',
        analysis_family: 'risk_difference',
        executable: true,
        requires_row_level_data: true,
        missing_roles: [],
        warnings: ['Week-window incidence questions require event timing fields and deterministic endpoint derivation.'],
        explanation: 'supported',
      }),
    });

    vi.stubGlobal('fetch', fetchMock);

    const response = await generateAnalysis(
      'Can I answer this question with this dataset: Among Asian women >=65, what is the cumulative incidence of Grade ≥2 DAEIs by Week 12 and the risk difference with 95% CI?',
      [
        {
          id: 'adsl_feasibility',
          name: 'adsl.csv',
          type: DataType.STANDARDIZED,
          uploadDate: new Date().toISOString(),
          size: '1 KB',
          content: [
            'USUBJID,TRT01A,AGE,SEX,RACE',
            '01,DrugA,70,F,ASIAN',
            '02,DrugB,68,F,ASIAN',
          ].join('\n'),
        },
        {
          id: 'adae_feasibility',
          name: 'adae.csv',
          type: DataType.STANDARDIZED,
          uploadDate: new Date().toISOString(),
          size: '1 KB',
          content: [
            'USUBJID,AETERM,AETOXGR,AESTDY',
            '01,Rash,2,15',
            '02,Dermatitis,3,20',
          ].join('\n'),
        },
      ],
      'RAG',
      []
    );

    expect(response.answer).toMatch(/Yes, this dataset looks capable/i);
    expect(response.answer).toMatch(/run the analysis rather than just assess feasibility/i);
    expect(response.answer).not.toMatch(/executed backend workflow/i);
    expect(response.answer).not.toMatch(/\*\*Dataset roles:\*\*/i);
  });

  it('mentions applied cohort filters in executed incidence answers', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'executable',
          analysis_family: 'risk_difference',
          executable: true,
          requires_row_level_data: true,
          missing_roles: [],
          warnings: [],
          explanation: 'supported',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'executable',
          spec: {
            analysis_family: 'risk_difference',
            cohort_filters: [],
            requested_outputs: ['risk_difference', 'confidence_interval'],
            notes: [],
          },
          missing_roles: [],
          warnings: [],
          explanation: 'planned',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'executable',
          workspace_id: 'ws_subgroup',
          source_names: ['adsl.csv', 'adae.csv'],
          missing_roles: [],
          row_count: 20,
          column_count: 8,
          derived_columns: ['AE_OUTCOME_FLAG'],
          notes: [],
          explanation: 'built',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'executable',
          executed: true,
          analysis_family: 'risk_difference',
          workspace_id: 'ws_subgroup',
          interpretation: 'Computed subject-level incidence by treatment and a two-group risk difference within the filtered cohort (AGE >= 65, SEX = female, RACE contains ASIAN).',
          metrics: [
            { name: 'analysis_method', value: 'incidence_by_treatment' },
            { name: 'total_subjects', value: 20 },
            { name: 'event_subjects', value: 13 },
            { name: 'risk_difference', value: 0.23 },
            { name: 'cohort_filters_applied', value: 'AGE >= 65, SEX = female, RACE contains ASIAN' },
          ],
          table: {
            title: 'Incidence by treatment group',
            columns: ['TRT01A', 'n', 'event_n', 'incidence_pct'],
            rows: [
              { TRT01A: 'Enhanced dermatologic management', n: 11, event_n: 6, incidence_pct: 54.55 },
              { TRT01A: 'Standard-of-care dermatologic management', n: 9, event_n: 7, incidence_pct: 77.78 },
            ],
          },
          warnings: [],
          explanation: 'executed',
        }),
      });

    vi.stubGlobal('fetch', fetchMock);

    const response = await generateAnalysis(
      'Among Asian women >=65, what is the cumulative incidence of Grade ≥2 DAEIs by Week 12 and what is the risk difference + 95% CI?',
      [
        {
          id: 'adsl_subgroup_chat',
          name: 'adsl.csv',
          type: DataType.STANDARDIZED,
          uploadDate: new Date().toISOString(),
          size: '1 KB',
          content: [
            'USUBJID,TRT01A,AGE,SEX,RACE',
            '01,DrugA,70,F,ASIAN',
            '02,DrugB,68,F,ASIAN',
          ].join('\n'),
        },
        {
          id: 'adae_subgroup_chat',
          name: 'adae.csv',
          type: DataType.STANDARDIZED,
          uploadDate: new Date().toISOString(),
          size: '1 KB',
          content: [
            'USUBJID,AETERM,AETOXGR,AESTDY',
            '01,Rash,2,15',
            '02,Dermatitis,3,20',
          ].join('\n'),
        },
      ],
      'RAG',
      []
    );

    expect(response.answer).toMatch(/AGE >= 65, SEX = female, RACE contains ASIAN/i);
    expect(response.keyInsights?.some((insight) => /Applied cohort filters/i.test(insight))).toBe(true);
  });
});

describe('chat context building', () => {
  it('summarizes full tabular survival context instead of using a short fragment', () => {
    const context = buildTabularChatContext({
      id: 'chat_survival_context',
      name: 'adtte.csv',
      type: DataType.STANDARDIZED,
      uploadDate: new Date().toISOString(),
      size: '1 KB',
      content: [
        'USUBJID,TRT01A,PARAMCD,PARAM,AVAL,CNSR',
        '01,DrugA,OS,Overall Survival,10,0',
        '02,DrugA,OS,Overall Survival,12,1',
        '03,DrugB,OS,Overall Survival,8,0',
        '04,DrugB,OS,Overall Survival,14,1',
      ].join('\n'),
    });

    expect(context).toContain('Rows: 4');
    expect(context).toContain('Unique subjects (USUBJID): 4');
    expect(context).toContain('Treatment/group summary: TRT01A: DrugA (2), DrugB (2)');
    expect(context).toContain('Candidate time endpoint summary: AVAL: n=4');
    expect(context).toContain('Candidate censor/event summary: CNSR: 0 (2), 1 (2)');
    expect(context).toContain('Use these full-dataset counts and summaries');
  });

  it('uses structured tabular summaries in RAG mode instead of first-row fragments', () => {
    const context = buildChatContextText(
      [
        {
          id: 'chat_dm_context',
          name: 'dm.csv',
          type: DataType.STANDARDIZED,
          uploadDate: new Date().toISOString(),
          size: '1 KB',
          content: [
            'USUBJID,TRT01A,AGE,SEX',
            '01,DrugA,60,M',
            '02,DrugA,61,F',
            '03,DrugB,58,M',
            '04,DrugB,57,F',
          ].join('\n'),
        },
        protocolFile,
      ],
      'RAG',
      'How does age differ by treatment arm?'
    );

    expect(context).toContain('RETRIEVED CONTEXT:');
    expect(context).toContain('RETRIEVED CHUNK');
    expect(context).toContain('TABULAR');
    expect(context).toContain('Protocol.txt');
    expect(context).not.toContain('[Source: Protocol.txt]:');
  });
});

describe('runQualityCheck', () => {
  it('does not create row-level missing-critical-values issue when required columns are absent', async () => {
    const file: ClinicalFile = {
      id: 'qc1',
      name: 'no_required_columns.csv',
      type: DataType.RAW,
      uploadDate: new Date().toISOString(),
      size: '1 KB',
      content: [
        'ARM,AETERM',
        'Placebo,Headache',
        'Active,Rash',
      ].join('\n'),
    };

    const result = await runQualityCheck(file);
    const missingColumnIssue = result.issues.find((i) => /Missing critical columns/i.test(i.description));
    const missingValueIssue = result.issues.find((i) => /Missing critical values/i.test(i.description));

    expect(result.status).toBe('FAIL');
    expect(missingColumnIssue).toBeTruthy();
    expect(missingColumnIssue?.autoFixable).toBe(false);
    expect(missingValueIssue).toBeUndefined();
  });

  it('accepts source-style exposure headers without requiring treatment arm', async () => {
    const file: ClinicalFile = {
      id: 'qc_ex',
      name: 'raw_exposure.csv',
      type: DataType.RAW,
      uploadDate: new Date().toISOString(),
      size: '1 KB',
      content: [
        'STUDYID,USUBJID,CYCLE,THERAPY_CLASS,DRUG,DOSE,DOSEU,EXSTDTC,ROUTE,ADMIN_STATUS',
        'LC-RAW-001,LC-RAW-001-0001,C1,Chemotherapy,Carboplatin,500,mg,2024-05-04,IV,Completed',
      ].join('\n'),
    };

    const result = await runQualityCheck(file);
    const missingColumnIssue = result.issues.find((i) => /Missing critical columns/i.test(i.description));

    expect(result.status).toBe('PASS');
    expect(missingColumnIssue).toBeUndefined();
  });

  it('accepts concomitant medication datasets that use DRUG and CMSTDTC headers', async () => {
    const file: ClinicalFile = {
      id: 'qc_cm',
      name: 'raw_concomitant_meds.csv',
      type: DataType.RAW,
      uploadDate: new Date().toISOString(),
      size: '1 KB',
      content: [
        'STUDYID,USUBJID,CMID,THERAPY_CLASS,DRUG,CMSTDTC,CMENDTC,ROUTE',
        'LC-RAW-001,LC-RAW-001-0001,CM-001,Supportive,Ondansetron,2024-05-04,2024-05-06,PO',
      ].join('\n'),
    };

    const result = await runQualityCheck(file);
    const missingColumnIssue = result.issues.find((i) => /Missing critical columns/i.test(i.description));

    expect(result.status).toBe('PASS');
    expect(missingColumnIssue).toBeUndefined();
  });

  it('accepts tumor assessment datasets that use ASSTDT as assessment date', async () => {
    const file: ClinicalFile = {
      id: 'qc_tu',
      name: 'raw_tumor_assessments_recist.csv',
      type: DataType.RAW,
      uploadDate: new Date().toISOString(),
      size: '1 KB',
      content: [
        'STUDYID,USUBJID,ASSTDT,DY,BASE_SUMDIAM_MM,SUMDIAM_MM,RESPONSE',
        'LC-RAW-001,LC-RAW-001-0001,2024-06-01,1,52,48,PR',
      ].join('\n'),
    };

    const result = await runQualityCheck(file);
    const missingColumnIssue = result.issues.find((i) => /Missing critical columns/i.test(i.description));

    expect(result.status).toBe('PASS');
    expect(missingColumnIssue).toBeUndefined();
  });

  it('accepts source-style labs datasets that use TEST and TESTCD headers', async () => {
    const file: ClinicalFile = {
      id: 'qc_lb',
      name: 'raw_labs.csv',
      type: DataType.RAW,
      uploadDate: new Date().toISOString(),
      size: '1 KB',
      content: [
        'STUDYID,USUBJID,VISIT,LBDTC,TESTCD,TEST,RESULT,UNIT,REFLOW,REFHIGH,FLAG',
        'LC-RAW-001,LC-RAW-001-0001,SCREEN,2024-04-09,HGB,Hemoglobin,14.7,g/dL,10.5,16.5,NORMAL',
      ].join('\n'),
    };

    const result = await runQualityCheck(file);
    const missingColumnIssue = result.issues.find((i) => /Missing critical columns/i.test(i.description));

    expect(result.status).toBe('PASS');
    expect(missingColumnIssue).toBeUndefined();
  });

  it('accepts wide baseline anthropometry tables that use PARTICIPANT_ID', async () => {
    const file: ClinicalFile = {
      id: 'qc_anthro',
      name: 'NCT06120140_simulated_baseline_labs_anthro.csv',
      type: DataType.RAW,
      uploadDate: new Date().toISOString(),
      size: '1 KB',
      content: [
        'PARTICIPANT_ID,ARM,BASELINE_HEIGHT_CM,BASELINE_WEIGHT_KG,BASELINE_BMI_KG_M2,WEIGHT_TIER',
        'COCOON-0001,Enhanced_DM,166.5,92.2,33.3,1',
      ].join('\n'),
    };

    const result = await runQualityCheck(file);
    const missingColumnIssue = result.issues.find((i) => /Missing critical columns/i.test(i.description));

    expect(result.status).toBe('PASS');
    expect(missingColumnIssue).toBeUndefined();
  });

  it('recognizes ADSL as an ADaM subject-level dataset without failing generic raw checks', async () => {
    const file: ClinicalFile = {
      id: 'qc_adsl',
      name: 'adsl.csv',
      type: DataType.STANDARDIZED,
      uploadDate: new Date().toISOString(),
      size: '1 KB',
      content: [
        'USUBJID,TRT01A,AGE,SEX,ITTFL',
        '01,DrugA,65,M,Y',
        '02,DrugB,59,F,Y',
      ].join('\n'),
    };

    const result = await runQualityCheck(file);

    expect(result.status).toBe('PASS');
    expect(result.issues).toHaveLength(0);
  });

  it('warns when ADLB contains multiple parameters without an analysis flag', async () => {
    const file: ClinicalFile = {
      id: 'qc_adlb',
      name: 'adlb.csv',
      type: DataType.STANDARDIZED,
      uploadDate: new Date().toISOString(),
      size: '1 KB',
      content: [
        'USUBJID,TRT01A,PARAMCD,PARAM,AVAL,AVISIT',
        '01,DrugA,HGB,Hemoglobin,13.1,Week 1',
        '01,DrugA,ALT,Alanine Aminotransferase,32.4,Week 1',
      ].join('\n'),
    };

    const result = await runQualityCheck(file);
    expect(result.status).toBe('WARN');
    expect(result.issues.some((issue) => /analysis parameters|multiple parameters/i.test(issue.description))).toBe(true);
  });

  it('warns that ADTTE needs censoring and population review before survival interpretation', async () => {
    const file: ClinicalFile = {
      id: 'qc_adtte',
      name: 'adtte.csv',
      type: DataType.STANDARDIZED,
      uploadDate: new Date().toISOString(),
      size: '1 KB',
      content: [
        'USUBJID,TRT01A,PARAMCD,PARAM,AVAL,CNSR',
        '01,DrugA,OS,Overall Survival,12,0',
        '02,DrugB,OS,Overall Survival,10,1',
      ].join('\n'),
    };

    const result = await runQualityCheck(file);
    expect(result.status).toBe('WARN');
    expect(result.issues.some((issue) => /censoring semantics|Kaplan-Meier|Cox/i.test(issue.description))).toBe(true);
  });
});

describe('generateCleaningSuggestion', () => {
  it('returns manual-remediation guidance when selected issues are not auto-fixable', async () => {
    const file: ClinicalFile = {
      id: 'qc2',
      name: 'raw.csv',
      type: DataType.RAW,
      uploadDate: new Date().toISOString(),
      size: '1 KB',
      content: 'ARM,AETERM\nPlacebo,Headache',
    };
    const issues: QCIssue[] = [
      {
        severity: 'HIGH',
        description: 'Missing critical columns: SUBJID, AGE, SEX',
        autoFixable: false,
      },
    ];

    const plan = await generateCleaningSuggestion(file, issues);
    expect(plan.code).toContain('No automatic cleaning was generated');
    expect(plan.explanation).toContain('require manual remediation');
  });
});
