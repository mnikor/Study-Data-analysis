export type PredictorFamily =
  | 'interaction'
  | 'treatment'
  | 'event_derived'
  | 'exposure'
  | 'labs'
  | 'management'
  | 'baseline_clinical'
  | 'other';

export type QuestionSupportSummary = {
  requiredFamilies: PredictorFamily[];
  presentFamilies: PredictorFamily[];
  missingFamilies: PredictorFamily[];
  hasMeaningfulPredictorFamily: boolean;
  hasBroadPredictorPool: boolean;
  details: string[];
};

export const normalizeSupportToken = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export const classifyPredictorFamily = (predictor: string): PredictorFamily => {
  const normalized = normalizeSupportToken(predictor);

  if (/^int\b|^int__|\binteraction\b/.test(normalized)) return 'interaction';
  if (/^ae_|qualifying event|qualifying day|qualifying grade|time to event|time to resolution|resolution event|onset/.test(normalized)) {
    return 'event_derived';
  }
  if (/^trt[0-9a-z]*\b|\btrt\b|\barm\b|\btreatment\b/.test(normalized)) return 'treatment';
  if (/^ex\b|^ex_|^adex_|^aedex_|\bexposure\b|\bdose\b|\bdosing\b|\bweight\b|\bkg\b|\btier\b|\binfusion\b|\bcumulative dose\b/.test(normalized)) {
    return 'exposure';
  }
  if (/^lab_|^lb_|\balbumin\b|\bhgb\b|\bhemoglobin\b|\banc\b|\bcrp\b|\bldh\b|\balt\b|\bast\b|\bbilirubin\b|\bcreatinine\b|\bplatelet\b|\bneutrophil\b|\blymphocyte\b/.test(normalized)) {
    return 'labs';
  }
  if (/^cm_|^adcm_|\bprophyl\b|\brescue\b|\bconsult\b|\btopical\b|\bsteroid\b|\bdoxy\b|\bminocycline\b|\bmanagement\b|\bmoisturi\b|\bderm consult\b|\bconcomitant\b/.test(normalized)) {
    return 'management';
  }
  if (/^dm_|^adsl_|^mh_|^vs_|^mp_|^mol_|\bage\b|\bsex\b|\brace\b|\becog\b|\bbmi\b|\bstage\b|\bsmoking\b|\bmutation\b|\bhistory\b|\bdiabetes\b|\bhypertension\b|\beczema\b|\bkidney\b|\bvte\b|\bsiteid\b|\bregion\b|\bcountry\b/.test(normalized)) {
    return 'baseline_clinical';
  }
  return 'other';
};

const needsDoseFamily = (question: string) =>
  /\bdose\b|\bdosing\b|\bweight\b|\bkg\b|\btier\b|>=\s*80\s*kg|≥\s*80\s*kg/i.test(question);

const needsLabFamily = (question: string) =>
  /\blab\b|\bbiomarker\b|\balbumin\b|\bcrp\b|\bhgb\b|\bldh\b|\bhemoglobin\b/i.test(question);

const needsManagementFamily = (question: string) =>
  /\bprophylaxis\b|\bprophylactic\b|\brescue\b|\bmanagement\b|\bderm consult\b|\bconcomitant meds?\b|\btopical\b|\bsteroid\b/i.test(question);

const needsPredictorFamilies = (question: string) =>
  /\bfactor\b|\bfactors\b|\bpredictor\b|\bpredictors\b|\bkey drivers\b|\bdriver\b|\bfeature importance\b|\bwhat predicts\b/i.test(question);

const needsBroadPredictorPool = (question: string) =>
  needsPredictorFamilies(question) && !needsDoseFamily(question) && !needsLabFamily(question) && !needsManagementFamily(question);

const dedupeFamilies = (families: PredictorFamily[]) => Array.from(new Set(families));

export const summarizeQuestionSupport = (
  question: string | undefined,
  predictors: string[]
): QuestionSupportSummary => {
  const normalizedQuestion = (question || '').toLowerCase();
  const predictorFamilies = dedupeFamilies(
    predictors
      .map((predictor) => classifyPredictorFamily(predictor))
      .filter((family): family is PredictorFamily => Boolean(family))
  );

  const requiredFamilies: PredictorFamily[] = [];
  if (needsPredictorFamilies(normalizedQuestion)) {
    requiredFamilies.push('baseline_clinical');
  }
  if (needsDoseFamily(normalizedQuestion)) {
    requiredFamilies.push('exposure');
  }
  if (needsLabFamily(normalizedQuestion)) {
    requiredFamilies.push('labs');
  }
  if (needsManagementFamily(normalizedQuestion)) {
    requiredFamilies.push('management');
  }

  const dedupedRequired = dedupeFamilies(requiredFamilies);
  const meaningfulFamilies = predictorFamilies.filter((family) =>
    ['baseline_clinical', 'exposure', 'labs', 'management'].includes(family)
  );
  const hasBroadPredictorPool = meaningfulFamilies.length >= 2;
  const missingFamilies = dedupedRequired.filter((family) => !predictorFamilies.includes(family));
  const details: string[] = [];

  if (needsPredictorFamilies(normalizedQuestion) && meaningfulFamilies.length === 0) {
    details.push('The fitted model does not contain any clear baseline, exposure, lab, or management predictor family; it is dominated by treatment and event-derived variables.');
  }
  if (needsBroadPredictorPool(normalizedQuestion) && meaningfulFamilies.length > 0 && !hasBroadPredictorPool) {
    details.push('The fitted model only contains a narrow predictor pool. For a general factors or key-drivers question, a fuller answer usually needs at least two broad predictor families such as baseline clinical, exposure, labs, management, or comorbidities.');
  }
  if (needsDoseFamily(normalizedQuestion) && !predictorFamilies.includes('exposure')) {
    details.push('The fitted model does not contain a direct exposure, dose, weight, or dosing-tier predictor family.');
  }
  if (needsLabFamily(normalizedQuestion) && !predictorFamilies.includes('labs')) {
    details.push('The fitted model does not contain the requested lab or biomarker predictor family.');
  }
  if (needsManagementFamily(normalizedQuestion) && !predictorFamilies.includes('management')) {
    details.push('The fitted model does not contain the requested management or prophylaxis predictor family.');
  }

  return {
    requiredFamilies: dedupedRequired,
    presentFamilies: predictorFamilies,
    missingFamilies,
    hasMeaningfulPredictorFamily: meaningfulFamilies.length > 0,
    hasBroadPredictorPool,
    details,
  };
};
