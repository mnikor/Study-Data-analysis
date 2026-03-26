import { describe, expect, it } from 'vitest';
import { classifyPredictorFamily, summarizeQuestionSupport } from './questionSupport';

describe('classifyPredictorFamily', () => {
  it('classifies common predictor families', () => {
    expect(classifyPredictorFamily('AE_FIRST_QUALIFYING_DAY')).toBe('event_derived');
    expect(classifyPredictorFamily('TRT01A_Enhanced DM')).toBe('treatment');
    expect(classifyPredictorFamily('EX_WEIGHT_TIER_GE80KG')).toBe('exposure');
    expect(classifyPredictorFamily('LAB_ALBUMIN_BASELINE')).toBe('labs');
    expect(classifyPredictorFamily('CM_PROPHYLACTIC_STEROID_USE')).toBe('management');
    expect(classifyPredictorFamily('AGE')).toBe('baseline_clinical');
  });
});

describe('summarizeQuestionSupport', () => {
  it('flags factor questions that only have event-derived and treatment predictors', () => {
    const summary = summarizeQuestionSupport(
      'Among participants who develop Grade >=2 DAEIs, what factors predict time to resolution and do these predictors differ by arm? Provide model outputs and key drivers.',
      ['TRT01A_Standard-of-care dermatologic management', 'AE_FIRST_QUALIFYING_DAY', 'AE_QUALIFYING_EVENT_COUNT']
    );

    expect(summary.hasMeaningfulPredictorFamily).toBe(false);
    expect(summary.hasBroadPredictorPool).toBe(false);
    expect(summary.details.some((detail) => /does not contain any clear baseline, exposure, lab, or management predictor family/i.test(detail))).toBe(true);
  });

  it('flags generic key-driver questions that only retain a narrow baseline predictor pool', () => {
    const summary = summarizeQuestionSupport(
      'Among participants who develop Grade >=2 DAEIs, what factors predict time to resolution and what are the key drivers?',
      ['TRT01A_Standard-of-care dermatologic management', 'AGE', 'SEX_Male', 'RACE_White', 'ECOG']
    );

    expect(summary.hasMeaningfulPredictorFamily).toBe(true);
    expect(summary.hasBroadPredictorPool).toBe(false);
    expect(summary.details.some((detail) => /only contains a narrow predictor pool/i.test(detail))).toBe(true);
  });

  it('requires exposure family for dose and weight-tier questions', () => {
    const summary = summarizeQuestionSupport(
      'Does higher amivantamab dosing by weight (>=80 kg dosing tier) correlate with increased Grade >=2 DAEIs or earlier onset, and does COCOON DM mitigate that relationship?',
      ['TRT01A_Standard-of-care dermatologic management', 'AGE', 'AE_FIRST_QUALIFYING_DAY']
    );

    expect(summary.missingFamilies).toContain('exposure');
    expect(summary.details.some((detail) => /dose, weight, or dosing-tier predictor family/i.test(detail))).toBe(true);
  });
});
