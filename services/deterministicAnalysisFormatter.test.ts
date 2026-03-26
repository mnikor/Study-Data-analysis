import { describe, expect, it } from 'vitest';
import { buildStructuredNarrative } from './deterministicAnalysisFormatter';

describe('buildStructuredNarrative', () => {
  it('downgrades factor questions when the fitted cox model only contains event-derived predictors', () => {
    const narrative = buildStructuredNarrative(
      'cox',
      {
        subjects_used: 111,
        event_subjects: 111,
        concordance_index: 0.595,
      },
      {
        title: 'Cox coefficients',
        columns: ['predictor', 'hazard_ratio', 'p_value'],
        rows: [
          { predictor: 'TRT01A_Standard-of-care dermatologic management', hazard_ratio: 0.94, p_value: 0.81 },
          { predictor: 'AE_FIRST_QUALIFYING_DAY', hazard_ratio: 0.97, p_value: 0.001 },
          { predictor: 'AE_QUALIFYING_EVENT_COUNT', hazard_ratio: 1.14, p_value: 0.17 },
        ],
      },
      {
        endpoint_label: 'Time to resolution of Grade >=2 dermatologic adverse events',
        time_variable: 'AE_TIME_TO_RESOLUTION',
        event_variable: 'AE_RESOLUTION_EVENT',
        treatment_variable: 'TRT01A',
      },
      'Computed a Cox proportional hazards model for time to resolution among subjects with qualifying adverse events.',
      [],
      'Among participants who develop Grade >=2 DAEIs, what factors predict time to resolution (faster vs slower recovery), and do these predictors differ by arm? Provide model outputs and key drivers.'
    );

    expect(narrative.sections.status).toBe('Partial answer only');
    expect(narrative.sections.directAnswer).toMatch(/does not contain any clear baseline, exposure, lab, or management predictor family/i);
    expect(narrative.sections.mainFindings).toMatch(/dominated by treatment and event-derived variables/i);
  });
});
