import { AnalysisConcept, ClinicalFile, DataType, StatAnalysisResult, StatTestType } from "../types";
import { parseCsv } from "../utils/dataProcessing";
import { executeLocalStatisticalAnalysis } from "../utils/statisticsEngine";
import { inferDatasetProfileFromHeaders, mapProfileKindToAnalysisRole } from "../utils/datasetProfile";
import {
  buildAnalysisWorkspace,
  classifyAnalysisCapabilities,
  requestAnalysisPlan,
  runBackendAnalysis,
  type FastApiAnalysisSpec,
  type FastApiDatasetReference,
} from "./fastapiAnalysisService";
import {
  buildDeterministicChartConfig,
  buildDeterministicExecutedCode,
  buildStructuredNarrative,
  metricsListToRecord,
} from "./deterministicAnalysisFormatter";

export interface StatisticalExecutionOptions {
  question?: string;
  sourceFiles?: ClinicalFile[];
  covariates?: string[];
  imputationMethod?: string;
  applyPSM?: boolean;
  backendSpec?: FastApiAnalysisSpec | null;
}

export const buildDatasetReference = (file: ClinicalFile): FastApiDatasetReference => {
  if (!file.content) {
    return {
      file_id: file.id,
      name: file.name,
      role: file.metadata?.datasetRole as string | undefined,
      column_names: [],
    };
  }

  try {
    const { headers, rows } = parseCsv(file.content);
    const profile = inferDatasetProfileFromHeaders(file.name, file.type, headers);
    const role = mapProfileKindToAnalysisRole(profile.kind) || file.metadata?.datasetRole as string | undefined;

    return {
      file_id: file.id,
      name: file.name,
      role,
      row_count: rows.length,
      column_names: headers,
      content: file.content,
    };
  } catch {
    return {
      file_id: file.id,
      name: file.name,
      role: file.metadata?.datasetRole as string | undefined,
      column_names: [],
    };
  }
};

const buildBackendExecutionQuestion = (
  testType: StatTestType,
  var1: string,
  var2: string,
  question?: string
): string => {
  if (question?.trim()) return question.trim();

  switch (testType) {
    case StatTestType.KAPLAN_MEIER:
      return `Compare survival between ${var1} groups using ${var2} as the time variable.`;
    case StatTestType.COX_PH:
      return `Estimate the hazard ratio by ${var1} using ${var2} as the time variable.`;
    case StatTestType.CHI_SQUARE:
      return `Compare incidence or proportions across ${var1} using ${var2} as the outcome.`;
    case StatTestType.T_TEST:
      return `Compare the mean of ${var2} across ${var1} groups.`;
    case StatTestType.ANOVA:
      return `Compare the mean of ${var2} across ${var1} categories using ANOVA.`;
    case StatTestType.REGRESSION:
      return `Model ${var2} using ${var1} as a predictor.`;
    case StatTestType.CORRELATION:
      return `Assess the correlation between ${var1} and ${var2}.`;
    default:
      return `${testType}: ${var1} vs ${var2}`;
  }
};

const maybeExecuteFastApiStatisticalAnalysis = async (
  code: string,
  file: ClinicalFile,
  testType: StatTestType,
  resolvedVar1: string,
  resolvedVar2: string,
  options?: StatisticalExecutionOptions
): Promise<StatAnalysisResult | null> => {
  const sourceFiles = (options?.sourceFiles && options.sourceFiles.length > 0 ? options.sourceFiles : [file])
    .filter((candidate) => (candidate.type === DataType.RAW || candidate.type === DataType.STANDARDIZED) && Boolean(candidate.content));
  if (sourceFiles.length === 0) {
    return null;
  }

  const question = buildBackendExecutionQuestion(testType, resolvedVar1, resolvedVar2, options?.question);
  const datasetRefs = sourceFiles.map(buildDatasetReference);

  try {
    const capability = await classifyAnalysisCapabilities(question, datasetRefs);
    if (
      capability.status !== 'executable' ||
      !['incidence', 'risk_difference', 'logistic_regression', 'kaplan_meier', 'cox', 'mixed_model', 'threshold_search', 'competing_risks', 'feature_importance', 'partial_dependence'].includes(capability.analysis_family)
    ) {
      return null;
    }

    const plan = await requestAnalysisPlan(question, datasetRefs);
    const spec: FastApiAnalysisSpec | undefined =
      plan.spec || options?.backendSpec
        ? ({
            ...(plan.spec || {}),
            ...(options?.backendSpec || {}),
          } as FastApiAnalysisSpec)
        : undefined;
    if (spec) {
      if (options?.covariates && options.covariates.length > 0) {
        spec.covariates = options.covariates;
      }
      const shouldBackfillSurvivalColumnsFromResolvedVars =
        sourceFiles.length === 1 &&
        !options?.backendSpec &&
        (testType === StatTestType.KAPLAN_MEIER || testType === StatTestType.COX_PH);
      if (shouldBackfillSurvivalColumnsFromResolvedVars) {
        if (!spec.treatment_variable && resolvedVar1) {
          spec.treatment_variable = resolvedVar1;
        }
        if (!spec.time_variable && resolvedVar2) {
          spec.time_variable = resolvedVar2;
        }
      }
    }

    const workspace = await buildAnalysisWorkspace(question, datasetRefs, spec);
    const executed = await runBackendAnalysis(question, datasetRefs, spec, workspace.workspace_id);
    if (!executed.executed) {
      if (sourceFiles.length > 1) {
        throw new Error(executed.explanation || 'Backend analysis did not return an executed result.');
      }
      return null;
    }

    return {
      metrics: metricsListToRecord(executed.metrics),
      interpretation: executed.interpretation || executed.explanation,
      chartConfig: buildDeterministicChartConfig(executed.analysis_family, executed.table),
      tableConfig: executed.table
        ? {
            title: executed.table.title,
            columns: executed.table.columns,
            rows: executed.table.rows,
          }
        : undefined,
      executedCode: buildDeterministicExecutedCode(code, executed.analysis_family, executed.workspace_id, sourceFiles),
      backendExecution: {
        engine: 'FASTAPI',
        analysisFamily: executed.analysis_family,
        workspaceId: executed.workspace_id,
        sourceNames: sourceFiles.map((candidate) => candidate.name),
        receipt: executed.receipt
          ? {
              sourceNames: executed.receipt.source_names,
              derivedColumns: executed.receipt.derived_columns,
              rowCount: executed.receipt.row_count,
              columnCount: executed.receipt.column_count,
              subjectIdentifier: executed.receipt.subject_identifier,
              treatmentVariable: executed.receipt.treatment_variable,
              outcomeVariable: executed.receipt.outcome_variable,
              timeVariable: executed.receipt.time_variable,
              eventVariable: executed.receipt.event_variable,
              endpointLabel: executed.receipt.endpoint_label,
              targetDefinition: executed.receipt.target_definition,
              cohortFiltersApplied: executed.receipt.cohort_filters_applied,
            }
          : undefined,
      },
      aiCommentary: (() => {
        const narrative = buildStructuredNarrative(
          executed.analysis_family,
          metricsListToRecord(executed.metrics),
          executed.table,
          executed.receipt,
          executed.interpretation || executed.explanation,
          executed.warnings,
          options?.question
        );
        return {
          source: 'FALLBACK' as const,
          summary: narrative.summary,
          limitations: narrative.limitations,
          caution: narrative.caution,
          sections: narrative.sections,
        };
      })(),
    };
  } catch (error) {
    if (sourceFiles.length > 1) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message || 'Backend execution failed.');
    }
    return null;
  }
};

export const executeStatisticalCode = async (
  code: string,
  file: ClinicalFile,
  testType: StatTestType,
  var1?: string,
  var2?: string,
  concept?: AnalysisConcept | null,
  options?: StatisticalExecutionOptions
): Promise<StatAnalysisResult> => {
  try {
    const { headers } = parseCsv(file.content);
    const resolvedVar1 = var1 && headers.includes(var1) ? var1 : headers[0];
    const resolvedVar2 = var2 && headers.includes(var2) ? var2 : headers.find((h) => h !== resolvedVar1) || '';

    if (!resolvedVar1) {
      throw new Error("Unable to infer analysis variables from dataset headers.");
    }

    const backendResult = await maybeExecuteFastApiStatisticalAnalysis(
      code,
      file,
      testType,
      resolvedVar1,
      resolvedVar2,
      options
    );
    if (backendResult) {
      return backendResult;
    }

    const result = executeLocalStatisticalAnalysis(file, testType, resolvedVar1, resolvedVar2, concept);
    return { ...result, executedCode: code || result.executedCode };
  } catch (error) {
    console.error("Deterministic execution error", error);
    const message = error instanceof Error ? error.message : "Analysis execution failed.";
    throw new Error(message);
  }
};
