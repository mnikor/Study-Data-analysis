import { StatAnalysisResult, StatTestType } from "../types";
import { formatComparisonLabel, formatDisplayName } from "../utils/displayNames";
import { buildStructuredNarrative, type StructuredNarrative } from "./deterministicAnalysisFormatter";
import { callAiModel, JsonType } from "./aiProxy";

interface CommentaryContext {
  question: string;
  dataScope: 'SINGLE_DATASET' | 'LINKED_WORKSPACE';
  sourceNames: string[];
  sourceDatasetName: string;
  var1: string;
  var2: string;
  testType: StatTestType;
}

const buildFallbackClinicalCommentary = (
  result: StatAnalysisResult,
  context: Pick<CommentaryContext, 'question' | 'dataScope' | 'sourceNames' | 'var1' | 'var2'>
): NonNullable<StatAnalysisResult['aiCommentary']> => {
  if (result.backendExecution?.engine === 'FASTAPI') {
    const narrative: StructuredNarrative = buildStructuredNarrative(
      result.backendExecution.analysisFamily,
      result.metrics,
      result.tableConfig,
      result.backendExecution.receipt,
      result.interpretation,
      [],
      context.question
    );
    return {
      source: 'FALLBACK',
      summary: narrative.summary,
      limitations: narrative.limitations,
      caution: narrative.caution,
      sections: narrative.sections,
    };
  }

  const adjusted = result.metrics.adjusted_p_value;
  const scopeLabel = context.dataScope === 'LINKED_WORKSPACE' ? 'linked multi-file workspace' : 'single dataset';
  const comparison = formatComparisonLabel(context.var1, context.var2);

  const limitations = [
    context.dataScope === 'LINKED_WORKSPACE'
      ? 'This is an exploratory linked-workspace result; derived subject-level summaries may smooth over visit-level or event-level timing.'
      : 'This result is based on one dataset only and may omit confounding context from related domains.',
  ];

  if (adjusted) {
    limitations.push(`Multiple-testing adjustment was applied (${result.metrics.multiple_testing_method || 'Benjamini-Hochberg FDR'}).`);
  } else if (context.dataScope === 'LINKED_WORKSPACE') {
    limitations.push('Cross-domain signal scans can generate false positives and should be treated as hypothesis-generating.');
  }

  return {
    source: 'FALLBACK',
    summary: `${result.interpretation} This commentary is based on the ${scopeLabel} result for ${comparison} across ${context.sourceNames.length} source dataset(s).`,
    limitations,
    caution:
      context.dataScope === 'LINKED_WORKSPACE'
        ? 'Use linked-workspace findings to prioritize follow-up analyses, not as confirmatory evidence.'
        : 'Interpret in conjunction with protocol context, sample size, and missing-data patterns.',
    sections: {
      mainFindings: result.interpretation,
    },
  };
};

export const generateClinicalCommentary = async (
  result: StatAnalysisResult,
  context: CommentaryContext
): Promise<NonNullable<StatAnalysisResult['aiCommentary']>> => {
  const fallback = buildFallbackClinicalCommentary(result, context);

  const prompt = `
  You are a clinical analytics copilot writing a short, careful commentary for an exploratory analysis result.

  REQUIREMENTS:
  - Stay grounded in the provided result only.
  - Do not invent effect sizes, causality, or medical claims beyond the metrics.
  - Explicitly acknowledge exploratory status when the scope is LINKED_WORKSPACE.
  - Keep the summary to 2-4 sentences.
  - Provide 2-4 limitations.

  RESULT CONTEXT:
  - Scope: ${context.dataScope}
  - Source datasets: ${context.sourceNames.join(', ')}
  - Primary dataset label: ${context.sourceDatasetName}
  - User question: ${context.question || 'Autopilot-selected exploratory analysis'}
  - Test type: ${context.testType}
  - Variables: ${formatDisplayName(context.var1)} vs ${formatDisplayName(context.var2)}
  - Deterministic interpretation: ${result.interpretation}
  - Metrics JSON: ${JSON.stringify(result.metrics)}
  `;

  const schema = {
    type: JsonType.OBJECT,
    properties: {
      summary: { type: JsonType.STRING },
      limitations: { type: JsonType.ARRAY, items: { type: JsonType.STRING } },
      caution: { type: JsonType.STRING },
    },
    required: ['summary', 'limitations'],
  };

  try {
    const response = await callAiModel({
      prompt,
      responseMimeType: 'application/json',
      responseSchema: schema,
      temperature: 0.2,
    });

    if (!response.text) return fallback;
    const parsed = JSON.parse(response.text);
    return {
      source: 'AI',
      summary: parsed.summary || fallback.summary,
      limitations: Array.isArray(parsed.limitations) && parsed.limitations.length > 0 ? parsed.limitations : fallback.limitations,
      caution: parsed.caution || fallback.caution,
      sections: fallback.sections,
    };
  } catch (error) {
    console.error('Clinical commentary generation error', error);
    return fallback;
  }
};
