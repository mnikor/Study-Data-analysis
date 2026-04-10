import { ClinicalFile, DataType } from "../types";
import { parseCsv } from "../utils/dataProcessing";
import {
  buildQuestionFileRecommendation,
  inferDatasetProfileFromHeaders,
  mapProfileKindToAnalysisRole,
} from "../utils/datasetProfile";
import { callAiModel, JsonType } from "./aiProxy";

export interface QuestionPlanningAssist {
  questionIntentSummary: string;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  requiredRoles: string[];
  optionalRoles: string[];
  predictorFamiliesNeeded: string[];
  recommendedFileNames: string[];
  whyTheseFiles: string[];
  keyRisks: string[];
  notes: string[];
}

export interface PlanningReadinessContext {
  status: 'idle' | 'loading' | 'ready' | 'missing_data' | 'unsupported' | 'error';
  summary: string;
  explanation?: string;
  missingRoles?: string[];
  sourceNames?: string[];
}

export interface ExplorationQuestionSuggestion {
  question: string;
  rationale: string;
  analysisFamily: string;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  supportStatus: 'READY' | 'PARTIAL' | 'MISSING';
  supportSummary: string;
  recommendedFileNames: string[];
}

const parseHeadersSafely = (file: ClinicalFile): string[] => {
  if (!file.content) return [];
  try {
    return parseCsv(file.content).headers;
  } catch {
    return [];
  }
};

const describeClinicalFileForPlanning = (file: ClinicalFile): Record<string, unknown> => {
  const headers = file.content ? parseHeadersSafely(file) : [];
  const profile = inferDatasetProfileFromHeaders(file.name, file.type, headers);
  const role = mapProfileKindToAnalysisRole(profile.kind);

  return {
    name: file.name,
    type: file.type,
    inferred_profile: profile.shortLabel,
    inferred_role: role || null,
    header_sample: headers.slice(0, 18),
  };
};

const selectRepresentativePlanningFiles = (files: ClinicalFile[], limit = 18): ClinicalFile[] => {
  const tabularFiles = files.filter((file) => file.type === DataType.RAW || file.type === DataType.STANDARDIZED);
  const documentFiles = files.filter((file) => file.type === DataType.DOCUMENT).slice(0, 2);
  const buckets = new Map<string, ClinicalFile[]>();

  for (const file of tabularFiles) {
    const headers = file.content ? parseHeadersSafely(file) : [];
    const profile = inferDatasetProfileFromHeaders(file.name, file.type, headers);
    const bucketKey = mapProfileKindToAnalysisRole(profile.kind) || profile.kind;
    const existing = buckets.get(bucketKey) || [];
    existing.push(file);
    buckets.set(bucketKey, existing);
  }

  const rankFile = (file: ClinicalFile) => {
    let score = 0;
    if (file.type === DataType.STANDARDIZED) score += 5;
    if (/^workspace_/i.test(file.name)) score -= 8;
    if (/^sdtm_/i.test(file.name)) score -= 2;
    if (/\bad[a-z]+/i.test(file.name)) score += 2;
    return score;
  };

  const selected: ClinicalFile[] = [];
  for (const filesForBucket of buckets.values()) {
    const ranked = [...filesForBucket].sort((a, b) => rankFile(b) - rankFile(a));
    selected.push(...ranked.slice(0, 2));
  }

  const seen = new Set<string>();
  const deduped = [...selected, ...documentFiles].filter((file) => {
    if (seen.has(file.id)) return false;
    seen.add(file.id);
    return true;
  });

  return deduped.slice(0, limit);
};

export const generateQuestionPlanningAssist = async (
  question: string,
  files: ClinicalFile[],
  readinessContext?: PlanningReadinessContext | null
): Promise<QuestionPlanningAssist | null> => {
  const trimmedQuestion = question.trim();
  if (!trimmedQuestion || files.length === 0) return null;

  const allCandidateFiles = files
    .filter((file) => file.type === DataType.RAW || file.type === DataType.STANDARDIZED || file.type === DataType.DOCUMENT)
  const candidateFiles = selectRepresentativePlanningFiles(allCandidateFiles);

  if (allCandidateFiles.length === 0 || candidateFiles.length === 0) return null;

  const deterministicRecommendation = buildQuestionFileRecommendation(trimmedQuestion, allCandidateFiles);
  const fileSummaries = candidateFiles.map(describeClinicalFileForPlanning);

  const prompt = `
You are helping a clinical analytics user decide whether their selected files can answer a question.

Question:
${trimmedQuestion}

Available files (metadata only):
${JSON.stringify(fileSummaries, null, 2)}

Deterministic recommendation summary:
${JSON.stringify({
  required_roles: deterministicRecommendation.requiredRoles,
  optional_roles: deterministicRecommendation.optionalRoles,
  selected_files: Object.fromEntries(
    Object.entries(deterministicRecommendation.selectedByRole).map(([role, file]) => [role, file?.name || null])
  ),
  missing_required_roles: deterministicRecommendation.missingRequiredRoles,
  support_status: deterministicRecommendation.supportAssessment.status,
  support_summary: deterministicRecommendation.supportAssessment.summary,
}, null, 2)}

Execution readiness check:
${JSON.stringify(
  readinessContext
    ? {
        status: readinessContext.status,
        summary: readinessContext.summary,
        explanation: readinessContext.explanation || '',
        missing_roles: readinessContext.missingRoles || [],
        checked_files: readinessContext.sourceNames || [],
      }
    : {
        status: 'not_run',
        summary: 'No deterministic execution-readiness result was provided.',
      },
  null,
  2
)}

Return a concise JSON object that:
- restates the question intent in plain language
- identifies required and optional dataset roles
- identifies which predictor families are likely needed
- recommends the best file names from the provided list
- explains why those files are a good fit
- highlights key risks or missing pieces
- gives an overall confidence level

If the execution readiness check says data is missing or unsupported, align your advice with it.
Do not contradict the execution readiness result.

Do not invent files that are not in the list.
Keep the answer practical for an end user, not technical.
`;

  const schema = {
    type: JsonType.OBJECT,
    properties: {
      questionIntentSummary: { type: JsonType.STRING },
      confidence: { type: JsonType.STRING, description: 'HIGH, MEDIUM, or LOW' },
      requiredRoles: { type: JsonType.ARRAY, items: { type: JsonType.STRING } },
      optionalRoles: { type: JsonType.ARRAY, items: { type: JsonType.STRING } },
      predictorFamiliesNeeded: { type: JsonType.ARRAY, items: { type: JsonType.STRING } },
      recommendedFileNames: { type: JsonType.ARRAY, items: { type: JsonType.STRING } },
      whyTheseFiles: { type: JsonType.ARRAY, items: { type: JsonType.STRING } },
      keyRisks: { type: JsonType.ARRAY, items: { type: JsonType.STRING } },
      notes: { type: JsonType.ARRAY, items: { type: JsonType.STRING } },
    },
  };

  try {
    const response = await callAiModel({
      prompt,
      responseMimeType: 'application/json',
      responseSchema: schema,
      temperature: 0.2,
    });

    if (!response.text) return null;
    const parsed = JSON.parse(response.text.replace(/```json/g, '').replace(/```/g, '').trim()) as Partial<QuestionPlanningAssist>;
    if (!parsed.questionIntentSummary) return null;

    return {
      questionIntentSummary: parsed.questionIntentSummary,
      confidence:
        parsed.confidence === 'HIGH' || parsed.confidence === 'LOW' || parsed.confidence === 'MEDIUM'
          ? parsed.confidence
          : 'MEDIUM',
      requiredRoles: Array.isArray(parsed.requiredRoles) ? parsed.requiredRoles : [],
      optionalRoles: Array.isArray(parsed.optionalRoles) ? parsed.optionalRoles : [],
      predictorFamiliesNeeded: Array.isArray(parsed.predictorFamiliesNeeded) ? parsed.predictorFamiliesNeeded : [],
      recommendedFileNames: Array.isArray(parsed.recommendedFileNames) ? parsed.recommendedFileNames : [],
      whyTheseFiles: Array.isArray(parsed.whyTheseFiles) ? parsed.whyTheseFiles : [],
      keyRisks: Array.isArray(parsed.keyRisks) ? parsed.keyRisks : [],
      notes: Array.isArray(parsed.notes) ? parsed.notes : [],
    };
  } catch (error) {
    console.error('generateQuestionPlanningAssist failed', error);
    return null;
  }
};

export const generateExplorationQuestionSuggestions = async (
  files: ClinicalFile[],
  focus?: string
): Promise<ExplorationQuestionSuggestion[]> => {
  const allCandidateFiles = files
    .filter((file) => file.type === DataType.RAW || file.type === DataType.STANDARDIZED || file.type === DataType.DOCUMENT)
  const candidateFiles = selectRepresentativePlanningFiles(allCandidateFiles);

  if (allCandidateFiles.length === 0 || candidateFiles.length === 0) return [];

  const fileSummaries = candidateFiles.map(describeClinicalFileForPlanning);
  const prompt = `
You are helping a clinical analytics user explore selected datasets before choosing one analysis question.

Selected files (metadata only):
${JSON.stringify(fileSummaries, null, 2)}

Optional exploration goal:
${focus?.trim() ? focus.trim() : 'No explicit goal provided. Suggest broad but credible questions.'}

Return 4 to 5 distinct candidate questions that:
- are realistic for the selected files
- are meaningfully different from each other
- sound like concrete clinical analysis questions a user could run next
- avoid repeating the same endpoint with tiny wording changes
- prefer practical questions about safety, efficacy, exposure, labs, subgroup patterns, or cross-file relationships when supported

For each suggestion include:
- question
- short rationale
- likely analysis family label
- confidence (HIGH, MEDIUM, LOW)

Do not invent files or data elements that are not suggested by the metadata.
Keep the wording user-facing, not technical.
`;

  const schema = {
    type: JsonType.OBJECT,
    properties: {
      suggestions: {
        type: JsonType.ARRAY,
        items: {
          type: JsonType.OBJECT,
          properties: {
            question: { type: JsonType.STRING },
            rationale: { type: JsonType.STRING },
            analysisFamily: { type: JsonType.STRING },
            confidence: { type: JsonType.STRING, description: 'HIGH, MEDIUM, or LOW' },
          },
        },
      },
    },
  };

  try {
    const response = await callAiModel({
      prompt,
      responseMimeType: 'application/json',
      responseSchema: schema,
      temperature: 0.3,
    });
    if (!response.text) return [];
    const parsed = JSON.parse(response.text.replace(/```json/g, '').replace(/```/g, '').trim()) as {
      suggestions?: Array<Partial<ExplorationQuestionSuggestion>>;
    };
    const normalizedSuggestions = (parsed.suggestions || [])
      .filter((item) => item.question && item.rationale)
      .map((item) => {
        const question = item.question as string;
        const recommendation = buildQuestionFileRecommendation(question, allCandidateFiles);
        const recommendedFileNames = Object.values(recommendation.selectedByRole)
          .filter(Boolean)
          .map((file) => (file as ClinicalFile).name);

        let confidence: 'HIGH' | 'MEDIUM' | 'LOW' =
          item.confidence === 'HIGH' || item.confidence === 'LOW' || item.confidence === 'MEDIUM'
            ? item.confidence
            : 'MEDIUM';

        if (recommendation.supportAssessment.status === 'MISSING') {
          confidence = 'LOW';
        } else if (recommendation.supportAssessment.status === 'PARTIAL' && confidence === 'HIGH') {
          confidence = 'MEDIUM';
        }

        return {
          question,
          rationale: item.rationale as string,
          analysisFamily: (item.analysisFamily as string) || 'Exploratory analysis',
          confidence,
          supportStatus: recommendation.supportAssessment.status,
          supportSummary: recommendation.supportAssessment.summary,
          recommendedFileNames,
        };
      });

    normalizedSuggestions.sort((a, b) => {
      const supportRank = { READY: 0, PARTIAL: 1, MISSING: 2 } as const;
      const confidenceRank = { HIGH: 0, MEDIUM: 1, LOW: 2 } as const;
      const bySupport = supportRank[a.supportStatus] - supportRank[b.supportStatus];
      if (bySupport !== 0) return bySupport;
      return confidenceRank[a.confidence] - confidenceRank[b.confidence];
    });

    const readyOrPartial = normalizedSuggestions.filter((item) => item.supportStatus !== 'MISSING');
    return (readyOrPartial.length > 0 ? readyOrPartial : normalizedSuggestions).slice(0, 5);
  } catch (error) {
    console.error('generateExplorationQuestionSuggestions failed', error);
    return [];
  }
};
