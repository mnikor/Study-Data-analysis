import { ClinicalFile, DataType } from '../types';
import { parseCsv } from './dataProcessing';

export type DatasetProfileKind =
  | 'DOCUMENT'
  | 'DEMOGRAPHICS'
  | 'ADVERSE_EVENTS'
  | 'LABS'
  | 'EXPOSURE'
  | 'DISPOSITION'
  | 'VISITS'
  | 'CONMEDS'
  | 'TUMOR'
  | 'MOLECULAR'
  | 'ADSL'
  | 'ADAE'
  | 'ADLB'
  | 'ADTTE'
  | 'BDS'
  | 'GENERIC';

export type DatasetModel = 'DOCUMENT' | 'RAW_CLINICAL' | 'STANDARDIZED' | 'ADAM';
export type AnalysisRole = 'ADSL' | 'ADAE' | 'ADLB' | 'ADTTE' | 'ADEX' | 'DS';
export type RecommendationConfidence = 'High' | 'Medium' | 'Low';
export type QuestionSupportStatus = 'READY' | 'PARTIAL' | 'MISSING';

export interface DatasetProfile {
  kind: DatasetProfileKind;
  model: DatasetModel;
  label: string;
  shortLabel: string;
  guidance?: string;
}

export interface FileRoleRecommendation {
  requiredRoles: AnalysisRole[];
  optionalRoles: AnalysisRole[];
  selectedByRole: Partial<Record<AnalysisRole, ClinicalFile>>;
  alternativesByRole: Partial<Record<AnalysisRole, ClinicalFile[]>>;
  missingRequiredRoles: AnalysisRole[];
  rationaleByFileId: Record<string, string>;
  confidenceByFileId: Record<string, RecommendationConfidence>;
  whyNotSelectedByFileId: Record<string, string>;
  supportAssessment: QuestionSupportAssessment;
}

export interface QuestionSupportCheck {
  label: string;
  status: 'MET' | 'PARTIAL' | 'MISSING';
  detail: string;
}

export interface QuestionSupportAssessment {
  status: QuestionSupportStatus;
  summary: string;
  checks: QuestionSupportCheck[];
}

const normalize = (value: string) => value.trim().toLowerCase();

const normalizeToken = (value: string) => normalize(value).replace(/[^a-z0-9]/g, '');

export const findHeaderByAlias = (headers: string[], aliases: string[]): string | null => {
  const normalizedHeaders = headers.map((header) => ({
    raw: header,
    lower: normalizeToken(header),
  }));

  for (const alias of aliases) {
    const normalizedAlias = normalizeToken(alias);
    const exact = normalizedHeaders.find((header) => header.lower === normalizedAlias);
    if (exact) return exact.raw;
    const partial = normalizedHeaders.find((header) => header.lower.includes(normalizedAlias));
    if (partial) return partial.raw;
  }

  return null;
};

const hasAnyHeader = (headers: string[], aliases: string[]) => Boolean(findHeaderByAlias(headers, aliases));

const parseHeadersSafely = (file: ClinicalFile): string[] => {
  if (!file.content) return [];
  try {
    return parseCsv(file.content).headers;
  } catch {
    return [];
  }
};

const isAdaMAdsl = (name: string, headers: string[]) =>
  /\badsl\b/.test(name) ||
  (hasAnyHeader(headers, ['USUBJID']) &&
    hasAnyHeader(headers, ['TRT01A', 'TRTA', 'TRT01P', 'ARM', 'ACTARM']) &&
    hasAnyHeader(headers, ['AGE', 'SEX']));

const isAdaMAdae = (name: string, headers: string[]) =>
  /\badae\b/.test(name) ||
  (hasAnyHeader(headers, ['USUBJID']) &&
    hasAnyHeader(headers, ['AETERM', 'AEDECOD', 'PT']) &&
    hasAnyHeader(headers, ['TRTEMFL', 'SAFFL', 'TRTA', 'TRT01A', 'AESER']));

const isAdaMAdlb = (name: string, headers: string[]) =>
  /\badlb\b/.test(name) ||
  (hasAnyHeader(headers, ['USUBJID']) &&
    hasAnyHeader(headers, ['PARAMCD', 'PARAM']) &&
    hasAnyHeader(headers, ['AVAL', 'CHG', 'BASE']) &&
    hasAnyHeader(headers, ['AVISIT', 'AVISITN', 'ADT', 'ADY']));

const isAdaMAdtte = (name: string, headers: string[]) =>
  /\badtte\b/.test(name) ||
  (hasAnyHeader(headers, ['USUBJID']) &&
    hasAnyHeader(headers, ['PARAMCD', 'PARAM']) &&
    hasAnyHeader(headers, ['AVAL']) &&
    hasAnyHeader(headers, ['CNSR']));

const isAdaMBds = (headers: string[]) =>
  hasAnyHeader(headers, ['USUBJID']) &&
  hasAnyHeader(headers, ['PARAMCD', 'PARAM']) &&
  hasAnyHeader(headers, ['AVAL']);

export const inferDatasetProfileFromHeaders = (
  fileName: string,
  type: DataType,
  headers: string[] = []
): DatasetProfile => {
  const name = normalize(fileName);
  const lowerHeaders = headers.map(normalize);
  const headerText = lowerHeaders.join(' ');

  if (type === DataType.DOCUMENT) {
    return {
      kind: 'DOCUMENT',
      model: 'DOCUMENT',
      label: 'Study document',
      shortLabel: 'Document',
    };
  }

  if (isAdaMAdsl(name, headers)) {
    return {
      kind: 'ADSL',
      model: 'ADAM',
      label: 'ADSL subject-level analysis dataset',
      shortLabel: 'ADaM • ADSL',
      guidance: 'Subject-level analysis-ready dataset. Respect analysis population and treatment variables.',
    };
  }

  if (isAdaMAdae(name, headers)) {
    return {
      kind: 'ADAE',
      model: 'ADAM',
      label: 'ADAE adverse event analysis dataset',
      shortLabel: 'ADaM • ADAE',
      guidance: 'Event-level analysis-ready dataset. Confirm treatment-emergent and safety population flags before interpretation.',
    };
  }

  if (isAdaMAdlb(name, headers)) {
    return {
      kind: 'ADLB',
      model: 'ADAM',
      label: 'ADLB lab analysis dataset',
      shortLabel: 'ADaM • ADLB',
      guidance: 'Parameterised analysis dataset. Filter by parameter, visit, and analysis flag before inferential use.',
    };
  }

  if (isAdaMAdtte(name, headers)) {
    return {
      kind: 'ADTTE',
      model: 'ADAM',
      label: 'ADTTE time-to-event analysis dataset',
      shortLabel: 'ADaM • ADTTE',
      guidance: 'Time-to-event dataset. Kaplan-Meier/log-rank and simple single-covariate Cox workflows are supported, but endpoint filtering and censoring assumptions still require review.',
    };
  }

  if ((type === DataType.STANDARDIZED || /\bad/.test(name)) && isAdaMBds(headers)) {
    return {
      kind: 'BDS',
      model: 'ADAM',
      label: 'ADaM BDS-style analysis dataset',
      shortLabel: 'ADaM • BDS',
      guidance: 'Analysis-ready BDS dataset. Use PARAM/PARAMCD and analysis flags to avoid mixing endpoints.',
    };
  }

  if (/demo|demograph|\bdm\b/.test(name) || / age | sex | race /.test(` ${headerText} `)) {
    return {
      kind: 'DEMOGRAPHICS',
      model: type === DataType.STANDARDIZED ? 'STANDARDIZED' : 'RAW_CLINICAL',
      label: 'Demographics dataset',
      shortLabel: 'Demographics',
    };
  }

  if (/adverse|\bae\b/.test(name) || headerText.includes('aeterm') || headerText.includes(' pt ')) {
    return {
      kind: 'ADVERSE_EVENTS',
      model: type === DataType.STANDARDIZED ? 'STANDARDIZED' : 'RAW_CLINICAL',
      label: 'Adverse events dataset',
      shortLabel: 'Adverse events',
    };
  }

  if (/lab|\blb\b/.test(name) || headerText.includes('lbstres') || headerText.includes('lborres')) {
    return {
      kind: 'LABS',
      model: type === DataType.STANDARDIZED ? 'STANDARDIZED' : 'RAW_CLINICAL',
      label: 'Labs dataset',
      shortLabel: 'Labs',
    };
  }

  if (/exposure|dose|therapy/.test(name) || headerText.includes('exstdtc') || headerText.includes('extrt')) {
    return {
      kind: 'EXPOSURE',
      model: type === DataType.STANDARDIZED ? 'STANDARDIZED' : 'RAW_CLINICAL',
      label: 'Exposure dataset',
      shortLabel: 'Exposure',
    };
  }

  if (
    /disposition|\bds\b|compliance|discontinu|adheren|interrupt|reduction|persist|hold/.test(name) ||
    headerText.includes('dsterm') ||
    headerText.includes('dsdecod') ||
    /adheren|compliance|interrupt|reduction|persist|dosehold|misseddose/.test(headerText)
  ) {
    return {
      kind: 'DISPOSITION',
      model: type === DataType.STANDARDIZED ? 'STANDARDIZED' : 'RAW_CLINICAL',
      label: 'Disposition or compliance dataset',
      shortLabel: 'Disposition',
    };
  }

  if (/visit/.test(name) || headerText.includes('visitnum') || headerText.includes('visit')) {
    return {
      kind: 'VISITS',
      model: type === DataType.STANDARDIZED ? 'STANDARDIZED' : 'RAW_CLINICAL',
      label: 'Visit dataset',
      shortLabel: 'Visits',
    };
  }

  if (/concomitant|cm/.test(name) || headerText.includes('cmstdtc') || headerText.includes('cmtrt')) {
    return {
      kind: 'CONMEDS',
      model: type === DataType.STANDARDIZED ? 'STANDARDIZED' : 'RAW_CLINICAL',
      label: 'Concomitant medication dataset',
      shortLabel: 'Conmeds',
    };
  }

  if (/tumor|recist/.test(name)) {
    return {
      kind: 'TUMOR',
      model: type === DataType.STANDARDIZED ? 'STANDARDIZED' : 'RAW_CLINICAL',
      label: 'Tumor assessment dataset',
      shortLabel: 'Tumor',
    };
  }

  if (/molecular|genom|ngs|biomarker|pdl1|egfr|alk|ros1/.test(name) || headerText.includes('mutation')) {
    return {
      kind: 'MOLECULAR',
      model: type === DataType.STANDARDIZED ? 'STANDARDIZED' : 'RAW_CLINICAL',
      label: 'Molecular profile dataset',
      shortLabel: 'Molecular',
    };
  }

  return {
    kind: 'GENERIC',
    model: type === DataType.STANDARDIZED ? 'STANDARDIZED' : 'RAW_CLINICAL',
    label: type === DataType.STANDARDIZED ? 'Standardized clinical dataset' : 'Generic clinical dataset',
    shortLabel: type === DataType.STANDARDIZED ? 'Standardized' : 'Clinical',
  };
};

export const inferDatasetProfile = (file: ClinicalFile): DatasetProfile =>
  inferDatasetProfileFromHeaders(file.name, file.type, parseHeadersSafely(file));

export const isAdamDatasetProfile = (profile: DatasetProfile): boolean => profile.model === 'ADAM';

export const mapProfileKindToAnalysisRole = (kind: DatasetProfileKind): string | undefined => {
  switch (kind) {
    case 'ADSL':
    case 'DEMOGRAPHICS':
      return 'ADSL';
    case 'ADAE':
    case 'ADVERSE_EVENTS':
      return 'ADAE';
    case 'ADLB':
    case 'LABS':
      return 'ADLB';
    case 'ADTTE':
      return 'ADTTE';
    case 'EXPOSURE':
      return 'ADEX';
    case 'DISPOSITION':
      return 'DS';
    default:
      return undefined;
  }
};

const QUERY_ROLE_PATTERNS: Array<{
  role: AnalysisRole;
  required: RegExp[];
  optional?: RegExp[];
}> = [
  {
    role: 'ADSL',
    required: [
      /\basian\b/i,
      /\bwomen\b|\bfemale\b|\bsex\b/i,
      /\bage\b|>=\s*\d+|≥\s*\d+/i,
      /\bsubgroup\b/i,
      /\btreatment arm\b|\barm\b|\benhanced dm\b|\bsoc dm\b/i,
    ],
  },
  {
    role: 'ADAE',
    required: [
      /\bdae/i,
      /\bdaei/i,
      /\badverse event/i,
      /\bgrade\s*[>=]?\s*\d+/i,
      /\bincidence\b/i,
      /\bonset\b/i,
      /\bresolution\b/i,
      /\btime to\b/i,
      /\bearlier onset\b/i,
    ],
  },
  {
    role: 'ADEX',
    required: [
      /\bdose\b/i,
      /\bdosing\b/i,
      /\bexposure\b/i,
      /\bweight\b/i,
      /\bkg\b/i,
      /\btier\b/i,
      /\bamivantamab\b/i,
    ],
  },
  {
    role: 'ADLB',
    required: [
      /\blab\b/i,
      /\bbiomarker\b/i,
      /\bhemoglobin\b/i,
      /\bldh\b/i,
      /\balp\b/i,
      /\bbaseline lab/i,
    ],
  },
  {
    role: 'ADTTE',
    required: [],
    optional: [
      /\bonset\b/i,
      /\bearlier onset\b/i,
      /\btime to\b/i,
      /\bsurvival\b/i,
      /\bhazard\b/i,
      /\bkaplan\b/i,
      /\bcox\b/i,
      /\bresolution\b/i,
    ],
  },
  {
    role: 'DS',
    required: [
      /\badherence\b/i,
      /\bcompliance\b/i,
      /\bdiscontinu/i,
      /\binterrupt(?:ion|ions)?\b/i,
      /\breduct(?:ion|ions)?\b/i,
      /\bpersist(?:ence)?\b/i,
    ],
  },
];

const uniqueRoles = (roles: AnalysisRole[]): AnalysisRole[] => Array.from(new Set(roles));

const inferRolesFromQuestion = (question: string): { requiredRoles: AnalysisRole[]; optionalRoles: AnalysisRole[] } => {
  const requiredRoles: AnalysisRole[] = [];
  const optionalRoles: AnalysisRole[] = [];

  for (const entry of QUERY_ROLE_PATTERNS) {
    if (entry.required.some((pattern) => pattern.test(question))) {
      requiredRoles.push(entry.role);
      continue;
    }
    if (entry.optional?.some((pattern) => pattern.test(question))) {
      optionalRoles.push(entry.role);
    }
  }

  const normalizedQuestion = question.toLowerCase();
  const asksAboutAeOutcomes =
    /\badverse event|\bae\b|\bdae\b|\bdaei\b|incidence|frequency|severity|max(?:imum)? severity/.test(normalizedQuestion);
  const asksAboutExposureOrAdherence =
    /\bdose\b|\bdosing\b|\bexposure\b|\bweight\b|\bkg\b|\btier\b|\bamivantamab\b|\badherence\b|\bcompliance\b|\bdiscontinu|\binterruption\b|\breduction\b|\bpersist/.test(normalizedQuestion);
  const asksForSubjectLevelAssociation =
    /\bcorrelate\b|\bcorrelation\b|\bassociate\b|\bassociation\b|\brelationship\b|\bcompare\b|\bimpact\b|\beffect\b/.test(normalizedQuestion);

  if ((asksAboutAeOutcomes && asksAboutExposureOrAdherence) || (asksAboutAeOutcomes && asksForSubjectLevelAssociation)) {
    requiredRoles.push('ADSL');
  }

  return {
    requiredRoles: uniqueRoles(requiredRoles),
    optionalRoles: uniqueRoles(optionalRoles.filter((role) => !requiredRoles.includes(role))),
  };
};

const scoreFileForRole = (file: ClinicalFile, role: AnalysisRole, profile: DatasetProfile): number => {
  const mappedRole = mapProfileKindToAnalysisRole(profile.kind) as AnalysisRole | undefined;
  const normalizedName = normalize(file.name);
  let score = 0;

  if (mappedRole === role) score += 100;
  if (profile.kind === role) score += 20;
  if (profile.model === 'ADAM') score += 15;
  if (file.type === DataType.STANDARDIZED) score += 8;
  if (file.type === DataType.RAW) score += 5;
  if (/^workspace_/i.test(file.name)) score -= 35;
  if (/^sdtm_/i.test(file.name)) score -= 5;

  if (role === 'ADTTE' && /\badtte\b/.test(normalizedName)) score += 25;
  if (role === 'ADAE' && /\badae\b|\bae\b|adverse/.test(normalizedName)) score += 15;
  if (role === 'ADSL' && /\badsl\b|\bdm\b|baseline|demograph/.test(normalizedName)) score += 15;
  if (role === 'ADEX' && /exposure|dose|dosing|amivantamab/.test(normalizedName)) score += 15;
  if (role === 'ADLB' && /adlb|lab/.test(normalizedName)) score += 15;
  if (role === 'DS' && /disposition|adherence|compliance|discontinu/.test(normalizedName)) score += 15;

  return score;
};

const scoreToConfidence = (score: number): RecommendationConfidence => {
  if (score >= 120) return 'High';
  if (score >= 80) return 'Medium';
  return 'Low';
};

const roleReasonText = (role: AnalysisRole) =>
  role === 'ADSL'
    ? 'subject-level baseline and treatment information'
    : role === 'ADAE'
      ? 'adverse events with grade and event timing'
      : role === 'ADTTE'
        ? 'time-to-event or onset information'
        : role === 'ADEX'
          ? 'exposure, dosing, or weight-tier information'
          : role === 'ADLB'
            ? 'lab or biomarker measurements'
            : 'treatment status or adherence outcomes';

const hasHeaderPair = (headers: string[], aliasGroups: string[][]) =>
  aliasGroups.every((aliases) => Boolean(findHeaderByAlias(headers, aliases)));

const summarizeSupportStatus = (checks: QuestionSupportCheck[]): QuestionSupportAssessment => {
  const missingCount = checks.filter((check) => check.status === 'MISSING').length;
  const partialCount = checks.filter((check) => check.status === 'PARTIAL').length;

  if (missingCount > 0) {
    return {
      status: 'MISSING',
      summary:
        missingCount === 1
          ? 'The proposed files are missing one critical ingredient for this question.'
          : 'The proposed files are missing several critical ingredients for this question.',
      checks,
    };
  }

  if (partialCount > 0) {
    return {
      status: 'PARTIAL',
      summary: 'The proposed files partially support this question, but some important fields are still weak or indirect.',
      checks,
    };
  }

  return {
    status: 'READY',
    summary: 'The proposed files look likely to support this question directly.',
    checks,
  };
};

const buildQuestionSupportAssessment = (
  question: string,
  selectedByRole: Partial<Record<AnalysisRole, ClinicalFile>>
): QuestionSupportAssessment => {
  const normalizedQuestion = question.toLowerCase();
  const checks: QuestionSupportCheck[] = [];

  const adslHeaders = selectedByRole.ADSL ? parseHeadersSafely(selectedByRole.ADSL) : [];
  const adaeHeaders = selectedByRole.ADAE ? parseHeadersSafely(selectedByRole.ADAE) : [];
  const adtteHeaders = selectedByRole.ADTTE ? parseHeadersSafely(selectedByRole.ADTTE) : [];
  const adexHeaders = selectedByRole.ADEX ? parseHeadersSafely(selectedByRole.ADEX) : [];
  const adlbHeaders = selectedByRole.ADLB ? parseHeadersSafely(selectedByRole.ADLB) : [];
  const dsHeaders = selectedByRole.DS ? parseHeadersSafely(selectedByRole.DS) : [];

  if (selectedByRole.ADSL || /asian|women|female|age|arm|enhanced dm|soc dm|baseline|predictor/.test(normalizedQuestion)) {
    const hasSubgroupFields = hasHeaderPair(adslHeaders, [
      ['USUBJID', 'SUBJID', 'SUBJECT_ID', 'PARTICIPANT_ID', 'PATIENT_ID'],
      ['AGE', 'AGEYR', 'AGE_YRS'],
      ['SEX', 'GENDER'],
      ['RACE', 'ETHNIC', 'ETHNICITY'],
      ['TRT01A', 'TRTA', 'ARM', 'ACTARM', 'TREATMENT_ARM'],
    ]);
    checks.push(
      !selectedByRole.ADSL
        ? {
            label: 'Subject baseline and subgroup filters',
            status: 'MISSING',
            detail: 'No subject-level baseline file was identified for age, sex, race, or treatment arm filtering.',
          }
        : hasSubgroupFields
          ? {
              label: 'Subject baseline and subgroup filters',
              status: 'MET',
              detail: `Using ${selectedByRole.ADSL.name} for subject identifiers, subgroup filters, and treatment arm.`,
            }
          : {
              label: 'Subject baseline and subgroup filters',
              status: 'PARTIAL',
              detail: `${selectedByRole.ADSL.name} was selected, but it may not contain all subgroup fields such as age, sex, race, and treatment arm.`,
            }
    );
  }

  if (/grade|adverse event|dae|daei|incidence|week\s*\d+|onset|resolution|time to/.test(normalizedQuestion)) {
    const hasAeGrade = Boolean(findHeaderByAlias(adaeHeaders, ['AETOXGR', 'AEGRADE', 'GRADE', 'AESEV', 'SEVERITY']));
    const hasAeTiming = Boolean(findHeaderByAlias(adaeHeaders, ['AESTDY', 'ASTDY', 'AESTDTC', 'ASTDT', 'AEENDY', 'AEENDTC', 'AEDUR']));
    const hasTteTiming = hasHeaderPair(adtteHeaders, [['AVAL'], ['CNSR']]);

    if (selectedByRole.ADTTE && hasTteTiming) {
      checks.push({
        label: 'Event timing for onset or time-to-event analysis',
        status: 'MET',
        detail: `Using ${selectedByRole.ADTTE.name} as a formal time-to-event dataset.`,
      });
    } else if (selectedByRole.ADAE && hasAeGrade && hasAeTiming) {
      checks.push({
        label: 'Event timing for onset or time-to-event analysis',
        status: /onset|time to|resolution/.test(normalizedQuestion) ? 'PARTIAL' : 'MET',
        detail:
          /onset|time to|resolution/.test(normalizedQuestion)
            ? `${selectedByRole.ADAE.name} has grade and timing fields, so the app may derive the endpoint, but a dedicated time-to-event dataset would be stronger.`
            : `Using ${selectedByRole.ADAE.name} for adverse event grade and event timing.`,
      });
    } else if (selectedByRole.ADAE) {
      checks.push({
        label: 'Adverse event endpoint with grade and timing',
        status: 'PARTIAL',
        detail: `${selectedByRole.ADAE.name} was selected, but grade or timing fields may be incomplete for the requested endpoint.`,
      });
    } else {
      checks.push({
        label: 'Adverse event endpoint with grade and timing',
        status: 'MISSING',
        detail: 'No adverse-events or time-to-event file was identified with the grade and timing fields needed for this endpoint.',
      });
    }
  }

  if (/dose|dosing|weight|kg|tier|amivantamab|exposure/.test(normalizedQuestion)) {
    const hasDoseFields = Boolean(findHeaderByAlias(adexHeaders, ['EXDOSE', 'DOSE', 'DOSE_TIER', 'TIER', 'AMT', 'EXTRT', 'TRTPN']));
    const hasWeightFields = Boolean(findHeaderByAlias(adslHeaders, ['WEIGHT', 'WT', 'WEIGHT_KG', 'BASELINE_WEIGHT_KG', 'GE80KG', 'WEIGHT_TIER']));
    checks.push(
      selectedByRole.ADEX && (hasDoseFields || hasWeightFields)
        ? {
            label: 'Dose, exposure, or weight-tier information',
            status: 'MET',
            detail: `Using ${selectedByRole.ADEX.name} for exposure or dosing information${hasWeightFields ? ' with supporting weight-tier fields available.' : '.'}`,
          }
        : selectedByRole.ADSL && hasWeightFields
          ? {
              label: 'Dose, exposure, or weight-tier information',
              status: 'PARTIAL',
              detail: `${selectedByRole.ADSL.name} appears to contain weight-tier information, but no strong exposure or dosing file was identified.`,
            }
          : {
              label: 'Dose, exposure, or weight-tier information',
              status: 'MISSING',
              detail: 'No clear exposure or weight-tier file was identified for the dosing comparison.',
            }
    );
  }

  if (/lab|biomarker|hemoglobin|ldh|alp|predictor|feature importance|partial dependence/.test(normalizedQuestion)) {
    const hasLabShape =
      Boolean(findHeaderByAlias(adlbHeaders, ['PARAM', 'PARAMCD', 'LBTEST', 'LBTESTCD'])) &&
      Boolean(findHeaderByAlias(adlbHeaders, ['AVAL', 'LBSTRESN', 'RESULT', 'VALUE']));
    const hasWideBaselineLabs = adslHeaders.some((header) => /^baseline_/i.test(header) || /^lab_/i.test(header));
    checks.push(
      selectedByRole.ADLB && hasLabShape
        ? {
            label: 'Baseline labs or biomarker predictors',
            status: 'MET',
            detail: `Using ${selectedByRole.ADLB.name} for lab or biomarker predictors.`,
          }
        : selectedByRole.ADSL && hasWideBaselineLabs
          ? {
              label: 'Baseline labs or biomarker predictors',
              status: 'PARTIAL',
              detail: `${selectedByRole.ADSL.name} appears to contain some baseline lab-style columns, but no dedicated lab dataset was identified.`,
            }
          : {
              label: 'Baseline labs or biomarker predictors',
              status: /lab|biomarker|hemoglobin|ldh|alp/.test(normalizedQuestion) ? 'MISSING' : 'PARTIAL',
              detail: /lab|biomarker|hemoglobin|ldh|alp/.test(normalizedQuestion)
                ? 'No clear lab or biomarker dataset was identified for the requested predictors.'
                : 'No dedicated lab dataset was identified, so the analysis would rely on baseline variables only.',
            }
    );
  }

  if (/adherence|compliance|discontinu|interruption|reduction|persist/.test(normalizedQuestion)) {
    const hasDsShape = Boolean(
      findHeaderByAlias(dsHeaders, [
        'DSTERM',
        'DSDECOD',
        'DISCONTINUE',
        'STATUS',
        'ACTION',
        'ADHERENCE',
        'COMPLIANCE',
        'INTERRUPTION',
        'INTERRUPT',
        'REDUCTION',
        'DOSE_REDUCTION',
        'DOSE_HOLD',
        'MISSED_DOSE',
        'PERSISTENCE',
      ])
    );
    checks.push(
      selectedByRole.DS && hasDsShape
        ? {
            label: 'Disposition, adherence, or persistence outcomes',
            status: 'MET',
            detail: `Using ${selectedByRole.DS.name} for discontinuation, interruption, or adherence-style outcomes.`,
          }
        : {
            label: 'Disposition, adherence, or persistence outcomes',
            status: 'MISSING',
            detail: 'No disposition or adherence dataset was identified for the requested persistence-style outcome.',
          }
    );
  }

  return summarizeSupportStatus(checks);
};

const describeAlternativeReason = (
  file: ClinicalFile,
  profile: DatasetProfile,
  role: AnalysisRole,
  selectedScore: number,
  candidateScore: number
) => {
  const reasons: string[] = [];
  if (/^workspace_/i.test(file.name)) reasons.push('it looks like a derived workspace file rather than a primary source dataset');
  if (profile.model !== 'ADAM') reasons.push('it is a weaker structural match than the selected file');
  if (selectedScore - candidateScore >= 30) reasons.push('it matched fewer of the expected role signals');
  if (reasons.length === 0) {
    reasons.push(`it was a lower-confidence match for ${roleReasonText(role)}`);
  }
  return `Not selected because ${reasons.join(' and ')}.`;
};

export const buildQuestionFileRecommendation = (
  question: string,
  files: ClinicalFile[]
): FileRoleRecommendation => {
  const tabularFiles = files.filter((file) => file.type === DataType.RAW || file.type === DataType.STANDARDIZED);
  const profiles = new Map<string, DatasetProfile>();
  for (const file of tabularFiles) {
    profiles.set(file.id, inferDatasetProfile(file));
  }

  const { requiredRoles, optionalRoles } = inferRolesFromQuestion(question);
  const selectedByRole: Partial<Record<AnalysisRole, ClinicalFile>> = {};
  const alternativesByRole: Partial<Record<AnalysisRole, ClinicalFile[]>> = {};
  const rationaleByFileId: Record<string, string> = {};
  const confidenceByFileId: Record<string, RecommendationConfidence> = {};
  const whyNotSelectedByFileId: Record<string, string> = {};

  const rolesToEvaluate = uniqueRoles([...requiredRoles, ...optionalRoles]);

  for (const role of rolesToEvaluate) {
    const ranked = tabularFiles
      .map((file) => {
        const profile = profiles.get(file.id)!;
        return {
          file,
          profile,
          score: scoreFileForRole(file, role, profile),
        };
      })
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score);

    if (ranked.length === 0) continue;

    selectedByRole[role] = ranked[0].file;
    alternativesByRole[role] = ranked.map((entry) => entry.file);
    confidenceByFileId[ranked[0].file.id] = scoreToConfidence(ranked[0].score);

    rationaleByFileId[ranked[0].file.id] =
      role === 'ADSL'
        ? 'Best match for subject-level baseline and treatment information.'
        : role === 'ADAE'
          ? 'Best match for adverse events with grade or event-level details.'
          : role === 'ADTTE'
            ? 'Best match for time-to-event or onset analysis.'
            : role === 'ADEX'
              ? 'Best match for exposure, dosing, or weight-tier information.'
              : role === 'ADLB'
                ? 'Best match for lab or biomarker measurements.'
                : 'Best match for treatment status or adherence outcomes.';

    for (const alternative of ranked.slice(1)) {
      if (!whyNotSelectedByFileId[alternative.file.id]) {
        whyNotSelectedByFileId[alternative.file.id] = describeAlternativeReason(
          alternative.file,
          alternative.profile,
          role,
          ranked[0].score,
          alternative.score
        );
      }
      if (!confidenceByFileId[alternative.file.id]) {
        confidenceByFileId[alternative.file.id] = scoreToConfidence(alternative.score);
      }
    }
  }

  const missingRequiredRoles = requiredRoles.filter((role) => !selectedByRole[role]);
  const supportAssessment = buildQuestionSupportAssessment(question, selectedByRole);

  return {
    requiredRoles,
    optionalRoles,
    selectedByRole,
    alternativesByRole,
    missingRequiredRoles,
    rationaleByFileId,
    confidenceByFileId,
    whyNotSelectedByFileId,
    supportAssessment,
  };
};
