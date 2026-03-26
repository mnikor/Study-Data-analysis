import { AnalysisSession, ClinicalFile, DataType, ResultTable, StatTestType } from '../types';
import { parseCsv, stringifyCsv, toNumber, type CsvRow } from './dataProcessing';
import type { AutopilotAnalysisTask } from './autopilotPlanner';
import { formatComparisonLabel, formatDisplayName } from './displayNames';

const SUBJECT_KEY_ALIASES = ['USUBJID', 'SUBJID', 'SUBJECT_ID', 'PATIENT_ID', 'PARTICIPANT_ID', 'PARTICIPANTID', 'PARTICIPANT'];
const SIGNAL_TEXT_HINTS = ['PT', 'AETERM', 'SOC', 'TEST', 'LBTEST', 'GENE', 'BIOMARKER', 'MUTATION', 'VARIANT'];
const IDENTIFIER_HINTS = ['ID', 'SUBJID', 'USUBJID', 'SUBJECT', 'PATIENT', 'RECORD'];

const normalize = (value: string) => value.trim().toLowerCase();
const baseName = (name: string) => name.replace(/\.[^/.]+$/, '');
const sanitizeToken = (value: string) => value.trim().replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
const countDistinct = (values: string[]) => new Set(values.filter(Boolean)).size;

const formatPValue = (value: number): string => {
  if (!Number.isFinite(value)) return 'N/A';
  if (value < 0.0001) return '< 0.0001';
  return value.toFixed(4);
};

const parseMetricPValue = (value: string | number | undefined): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.toUpperCase() === 'N/A') return null;
  if (trimmed.startsWith('<')) {
    const parsed = Number(trimmed.slice(1).trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
};

const findSubjectKey = (headers: string[]): string | null => {
  const lowered = headers.map((header) => ({ raw: header, normalized: header.replace(/[^A-Za-z0-9]/g, '').toUpperCase() }));
  for (const alias of SUBJECT_KEY_ALIASES) {
    const normalizedAlias = alias.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    const found = lowered.find((header) => header.normalized === normalizedAlias || header.normalized.includes(normalizedAlias));
    if (found) return found.raw;
  }
  return null;
};

const isDateLikeColumn = (column: string) => /(DATE|DT|DTC)$/i.test(column);

const isNumericColumn = (rows: CsvRow[], column: string): boolean => {
  const sample = rows.slice(0, 300);
  if (sample.length === 0) return false;
  const numericCount = sample.filter((row) => toNumber(row[column]) != null).length;
  return numericCount >= Math.max(3, Math.floor(sample.length * 0.6));
};

const isIdentifierColumn = (rows: CsvRow[], column: string): boolean => {
  const upper = column.toUpperCase();
  if (!IDENTIFIER_HINTS.some((hint) => upper.includes(hint))) return false;
  const values = rows.map((row) => (row[column] || '').trim()).filter(Boolean);
  return values.length > 0 && countDistinct(values) >= Math.max(10, Math.floor(values.length * 0.7));
};

const getDomainPrefix = (fileName: string) =>
  sanitizeToken(baseName(fileName).replace(/^raw_/i, '').replace(/^sdtm_/i, '')).toUpperCase() || 'DATASET';

const modeValue = (values: string[]) => {
  const counts = new Map<string, number>();
  values.filter(Boolean).forEach((value) => counts.set(value, (counts.get(value) || 0) + 1));
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
};

export interface LinkedWorkspaceBuildResult {
  workspaceFile: ClinicalFile;
  sourceNames: string[];
  skippedFiles: string[];
  joinKey: string;
  notes: string[];
  rowCount: number;
  columnCount: number;
  derivedColumns: string[];
  previewTable: ResultTable;
}

const summarizeFileBySubject = (
  file: ClinicalFile,
  isPrimary: boolean,
  customSynonyms: string[]
): { keyColumn: string | null; summaryBySubject: Map<string, CsvRow>; notes: string[] } => {
  const { headers, rows } = parseCsv(file.content);
  const keyColumn = findSubjectKey(headers);
  if (!keyColumn) {
    return {
      keyColumn: null,
      summaryBySubject: new Map(),
      notes: [`Skipped ${file.name}: no subject-level join key found.`],
    };
  }

  const grouped = new Map<string, CsvRow[]>();
  rows.forEach((row) => {
    const key = (row[keyColumn] || '').trim();
    if (!key) return;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(row);
  });

  const prefix = getDomainPrefix(file.name);
  const conceptLabel = customSynonyms.length > 0 ? sanitizeToken(customSynonyms[0]).toUpperCase() || 'CUSTOM_SIGNAL' : null;
  const summaryBySubject = new Map<string, CsvRow>();
  const notes: string[] = [];

  const primaryUnique = isPrimary && Array.from(grouped.values()).every((subjectRows) => subjectRows.length === 1);

  grouped.forEach((subjectRows, subjectId) => {
    const summary: CsvRow = { USUBJID: subjectId };
    let conceptFoundAcrossColumns = false;

    if (primaryUnique) {
      const sourceRow = subjectRows[0];
      headers.forEach((header) => {
        if (header === keyColumn) return;
        summary[header] = sourceRow[header] || '';
      });
      summaryBySubject.set(subjectId, summary);
      return;
    }

    summary[`${prefix}__RECORD_COUNT`] = String(subjectRows.length);
    const numericColumns = headers.filter(
      (header) => header !== keyColumn && !isDateLikeColumn(header) && !isIdentifierColumn(rows, header) && isNumericColumn(rows, header)
    );
    const categoricalColumns = headers.filter(
      (header) => header !== keyColumn && !isDateLikeColumn(header) && !isNumericColumn(rows, header) && !isIdentifierColumn(rows, header)
    );

    numericColumns.slice(0, 8).forEach((column) => {
      const values = subjectRows.map((row) => toNumber(row[column])).filter((value): value is number => value != null);
      if (values.length === 0) return;
      const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
      summary[`${prefix}__${column}__MEAN`] = mean.toFixed(4);
      summary[`${prefix}__${column}__MAX`] = Math.max(...values).toFixed(4);
    });

    categoricalColumns.slice(0, 10).forEach((column) => {
      const values = subjectRows.map((row) => (row[column] || '').trim()).filter(Boolean);
      if (values.length === 0) return;

      const distinct = countDistinct(values);
      const summaryColumnBase = `${prefix}__${column}`;
      if (subjectRows.length === 1 && values[0]) {
        summary[summaryColumnBase] = values[0];
      } else if (distinct <= 12) {
        summary[`${summaryColumnBase}__MODE`] = modeValue(values);
      }

      if (SIGNAL_TEXT_HINTS.some((hint) => column.toUpperCase().includes(hint)) || distinct > 12) {
        const uniqueTerms = Array.from(new Set(values.map((value) => value.toLowerCase()))).slice(0, 12);
        summary[`${summaryColumnBase}__TERMS`] = uniqueTerms.join(' | ');
      }

      if (conceptLabel) {
        conceptFoundAcrossColumns =
          conceptFoundAcrossColumns ||
          values.some((value) =>
          customSynonyms.some((term) => value.toLowerCase().includes(term.toLowerCase()))
        );
      }
    });

    if (conceptLabel) {
      summary[`${prefix}__${conceptLabel}_PRESENT`] = conceptFoundAcrossColumns ? 'Present' : 'Absent';
    }

    summaryBySubject.set(subjectId, summary);
  });

  if (!primaryUnique) {
    notes.push(`${file.name} contributed subject-level summary features instead of row-level records.`);
  }

  return { keyColumn, summaryBySubject, notes };
};

export const buildLinkedAnalysisWorkspace = (
  primaryFile: ClinicalFile,
  supportingFiles: ClinicalFile[],
  customSynonyms: string[] = []
): LinkedWorkspaceBuildResult => {
  const cleanSynonyms = customSynonyms.map((value) => value.trim()).filter(Boolean);
  const primarySummary = summarizeFileBySubject(primaryFile, true, cleanSynonyms);
  if (!primarySummary.keyColumn) {
    throw new Error(`Primary dataset ${primaryFile.name} does not contain a subject identifier that can be linked.`);
  }

  const sourceNames = [primaryFile.name];
  const skippedFiles: string[] = [];
  const notes = [...primarySummary.notes];
  const mergedRows: CsvRow[] = [];
  const supportingSummaries = supportingFiles.map((file) => {
    const summary = summarizeFileBySubject(file, false, cleanSynonyms);
    if (!summary.keyColumn) skippedFiles.push(file.name);
    else sourceNames.push(file.name);
    notes.push(...summary.notes);
    return { file, ...summary };
  });

  primarySummary.summaryBySubject.forEach((primaryRow, subjectId) => {
    const combined: CsvRow = { ...primaryRow, USUBJID: subjectId };
    const linkedSourceCount = 1;
    let matchedSources = linkedSourceCount;

    supportingSummaries.forEach((summary) => {
      if (!summary.keyColumn) return;
      const supportingRow = summary.summaryBySubject.get(subjectId);
      if (!supportingRow) return;
      matchedSources += 1;
      Object.entries(supportingRow).forEach(([key, value]) => {
        if (key === 'USUBJID') return;
        combined[key] = value;
      });
    });

    combined.LINKED_SOURCE_COUNT = String(matchedSources);
    mergedRows.push(combined);
  });

  if (mergedRows.length === 0) {
    throw new Error('Linked workspace could not be built because no subjects remained after joining selected datasets.');
  }

  const allHeaders = Array.from(
    mergedRows.reduce((set, row) => {
      Object.keys(row).forEach((header) => set.add(header));
      return set;
    }, new Set<string>())
  );

  const workspaceContent = stringifyCsv(allHeaders, mergedRows);
  const previewColumns = allHeaders.slice(0, 8);
  const previewTable: ResultTable = {
    title: 'Linked workspace preview',
    columns: previewColumns,
    rows: mergedRows.slice(0, 5).map((row) =>
      previewColumns.reduce<Record<string, string | number>>((acc, column) => {
        acc[column] = row[column] || '';
        return acc;
      }, {})
    ),
  };
  const derivedColumns = allHeaders.filter((header) => header !== 'USUBJID' && header.includes('__'));
  const workspaceFile: ClinicalFile = {
    id: crypto.randomUUID(),
    name: `workspace_${sanitizeToken(baseName(primaryFile.name)).toLowerCase()}_${Date.now()}.csv`,
    type: DataType.STANDARDIZED,
    uploadDate: new Date().toISOString(),
    size: `${(workspaceContent.length / 1024).toFixed(1)} KB`,
    content: workspaceContent,
    metadata: {
      generatedBy: 'LINKED_AUTOPILOT_WORKSPACE',
      sourceFileIds: [primaryFile.id, ...supportingFiles.map((file) => file.id)],
      sourceNames,
      skippedFiles,
      joinKey: primarySummary.keyColumn,
      notes,
      rowCount: mergedRows.length,
      columnCount: allHeaders.length,
      derivedColumns,
    },
  };

  return {
    workspaceFile,
    sourceNames,
    skippedFiles,
    joinKey: primarySummary.keyColumn,
    notes,
    rowCount: mergedRows.length,
    columnCount: allHeaders.length,
    derivedColumns,
    previewTable,
  };
};

const domainFromHeader = (header: string) => {
  const match = header.match(/^([A-Z0-9]+(?:_[A-Z0-9]+)*)__/);
  return match ? match[1] : 'PRIMARY';
};

const isCandidateGroupColumn = (rows: CsvRow[], header: string) => {
  if (header === 'USUBJID' || isIdentifierColumn(rows, header)) return false;
  if (isNumericColumn(rows, header)) return false;
  const distinct = countDistinct(rows.map((row) => (row[header] || '').trim()));
  return distinct >= 2 && distinct <= 8;
};

const isCandidateCategoricalOutcome = (rows: CsvRow[], header: string) => {
  if (header === 'USUBJID' || isIdentifierColumn(rows, header)) return false;
  if (isNumericColumn(rows, header)) return false;
  const distinct = countDistinct(rows.map((row) => (row[header] || '').trim()));
  return distinct >= 2 && distinct <= 10;
};

const isCandidateNumericOutcome = (rows: CsvRow[], header: string) => {
  if (header === 'USUBJID' || isIdentifierColumn(rows, header)) return false;
  if (isDateLikeColumn(header)) return false;
  return isNumericColumn(rows, header);
};

const keywordScore = (header: string) => {
  const upper = header.toUpperCase();
  let score = 0;
  if (/AGE|SEX|RACE|ETHNICITY/.test(upper)) score += 3;
  if (/ARM|TREATMENT|TRT/.test(upper)) score += 4;
  if (/PRESENT|SERIOUS|RELATEDNESS|OUTCOME|ACTION|RESPONSE|GRADE/.test(upper)) score += 5;
  if (/COUNT|MEAN|MAX|RESULT|LAB|BIOMARKER|GENE|MUTATION/.test(upper)) score += 4;
  return score;
};

const stripAggregateSuffix = (value: string) =>
  value
    .replace(/__(MEAN|MAX|MODE|TERMS|PRESENT)$/i, '')
    .replace(/_MEAN$|_MAX$|_MODE$|_TERMS$|_PRESENT$/i, '');

const semanticStem = (header: string) => {
  const parts = header.split('__').filter(Boolean);
  const lastPart = parts[parts.length - 1] || '';
  const lastIsAggregate = /^(MEAN|MAX|MODE|TERMS|PRESENT)$/i.test(lastPart);
  if (parts.length >= 3) {
    const candidate = lastIsAggregate ? parts[parts.length - 2] : parts[parts.length - 1];
    return sanitizeToken(stripAggregateSuffix(candidate)).toUpperCase();
  }
  if (parts.length === 2) {
    const candidate = lastIsAggregate ? parts[0] : parts[1];
    return sanitizeToken(stripAggregateSuffix(candidate)).toUpperCase();
  }
  return sanitizeToken(stripAggregateSuffix(header)).toUpperCase();
};

const scoreGroupColumnCandidate = (header: string) => {
  const upper = header.toUpperCase();
  let score = keywordScore(header);
  if (!header.includes('__')) score += 10;
  if (/ARM|TRT|TREATMENT|GROUP|COHORT/.test(upper)) score += 10;
  if (/SEX|RACE|ETHNIC|AGEGR|WEIGHT_TIER/.test(upper)) score += 4;
  if (/__MODE$/.test(upper)) score -= 1;
  if (/^WORKSPACE_/.test(upper)) score -= 8;
  if (/^SDTM_/.test(upper)) score -= 3;
  score -= Math.min(header.length, 80) / 100;
  return score;
};

export const buildExploratorySignalTasks = (
  workspaceFile: ClinicalFile,
  maxTasks = 6
): AutopilotAnalysisTask[] => {
  const { headers, rows } = parseCsv(workspaceFile.content);
  if (headers.length === 0 || rows.length === 0) return [];

  const groupedGroupColumns = new Map<string, { header: string; score: number }>();
  headers
    .filter((header) => isCandidateGroupColumn(rows, header))
    .forEach((header) => {
      const stem = semanticStem(header);
      const score = scoreGroupColumnCandidate(header);
      const existing = groupedGroupColumns.get(stem);
      if (!existing || score > existing.score) {
        groupedGroupColumns.set(stem, { header, score });
      }
    });
  const groupColumns = Array.from(groupedGroupColumns.values()).map((entry) => entry.header);
  const categoricalOutcomes = headers.filter((header) => isCandidateCategoricalOutcome(rows, header));
  const numericOutcomes = headers.filter((header) => isCandidateNumericOutcome(rows, header));

  const candidates: Array<
    AutopilotAnalysisTask & {
      score: number;
      groupDomain: string;
      outcomeDomain: string;
      signalKey: string;
    }
  > = [];
  const seen = new Set<string>();

  const pushCandidate = (
    task: Omit<AutopilotAnalysisTask, 'id'>,
    score: number,
    groupDomain: string,
    outcomeDomain: string,
    signalKey: string
  ) => {
    const key = `${task.testType}|${task.var1}|${task.var2}`;
    if (task.var1 === task.var2 || seen.has(key)) return;
    seen.add(key);
    candidates.push({ id: crypto.randomUUID(), ...task, score, groupDomain, outcomeDomain, signalKey });
  };

  groupColumns.forEach((groupColumn) => {
    const groupDistinct = countDistinct(rows.map((row) => (row[groupColumn] || '').trim()));
    const groupDomain = domainFromHeader(groupColumn);

    categoricalOutcomes.forEach((outcomeColumn) => {
      if (outcomeColumn === groupColumn) return;
      const outcomeDomain = domainFromHeader(outcomeColumn);
      const score =
        keywordScore(groupColumn) +
        keywordScore(outcomeColumn) +
        (groupDomain !== outcomeDomain ? 6 : 0) +
        (outcomeColumn.toUpperCase().includes('PRESENT') ? 3 : 0);

      pushCandidate(
        {
          label: formatComparisonLabel(groupColumn, outcomeColumn),
          question: `Does ${formatDisplayName(outcomeColumn).toLowerCase()} differ by ${formatDisplayName(groupColumn).toLowerCase()}?`,
          testType: StatTestType.CHI_SQUARE,
          var1: groupColumn,
          var2: outcomeColumn,
          rationale: 'Cross-domain exploratory categorical association in linked workspace.',
        },
        score,
        groupDomain,
        outcomeDomain,
        `${semanticStem(groupColumn)}|${semanticStem(outcomeColumn)}`
      );
    });

    numericOutcomes.forEach((outcomeColumn) => {
      if (outcomeColumn === groupColumn) return;
      const outcomeDomain = domainFromHeader(outcomeColumn);
      const score =
        keywordScore(groupColumn) +
        keywordScore(outcomeColumn) +
        (groupDomain !== outcomeDomain ? 6 : 0) +
        (outcomeColumn.toUpperCase().includes('COUNT') ? 2 : 0);

      pushCandidate(
        {
          label: formatComparisonLabel(groupColumn, outcomeColumn),
          question: `Is ${formatDisplayName(outcomeColumn).toLowerCase()} different across ${formatDisplayName(groupColumn).toLowerCase()} groups?`,
          testType: groupDistinct === 2 ? StatTestType.T_TEST : StatTestType.ANOVA,
          var1: groupColumn,
          var2: outcomeColumn,
          rationale: 'Cross-domain exploratory numeric signal scan in linked workspace.',
        },
        score,
        groupDomain,
        outcomeDomain,
        `${semanticStem(groupColumn)}|${semanticStem(outcomeColumn)}`
      );
    });
  });

  const groupedNumericCandidates = numericOutcomes.filter((header) => groupColumns.indexOf(header) === -1);
  groupedNumericCandidates.forEach((leftColumn) => {
    const leftDomain = domainFromHeader(leftColumn);
    groupedNumericCandidates.forEach((rightColumn) => {
      if (leftColumn === rightColumn) return;
      const rightDomain = domainFromHeader(rightColumn);
      if (leftDomain === rightDomain) return;

      const signalKey = [semanticStem(leftColumn), semanticStem(rightColumn)].sort().join('|');
      const score = keywordScore(leftColumn) + keywordScore(rightColumn) + 5;

      pushCandidate(
        {
          label: formatComparisonLabel(leftColumn, rightColumn),
          question: `Is ${formatDisplayName(rightColumn).toLowerCase()} associated with ${formatDisplayName(leftColumn).toLowerCase()}?`,
          testType: StatTestType.CORRELATION,
          var1: leftColumn,
          var2: rightColumn,
          rationale: 'Cross-domain exploratory numeric association in linked workspace.',
        },
        score,
        leftDomain,
        rightDomain,
        signalKey
      );
    });
  });

  const ranked = candidates.sort((a, b) => b.score - a.score);
  const selected: typeof ranked = [];
  const usedSignalKeys = new Set<string>();
  const usedVar1Stems = new Map<string, number>();
  const usedVar2Stems = new Set<string>();
  const usedDomainPairs = new Map<string, number>();
  const usedTestTypes = new Map<StatTestType, number>();

  for (const candidate of ranked) {
    if (selected.length >= maxTasks) break;
    if (usedSignalKeys.has(candidate.signalKey)) continue;
    const candidateVar1Stem = semanticStem(candidate.var1);
    const candidateVar2Stem = semanticStem(candidate.var2);
    if (usedVar2Stems.has(candidateVar2Stem)) continue;

    const domainPairKey = [candidate.groupDomain, candidate.outcomeDomain].sort().join('|');
    const domainPairCount = usedDomainPairs.get(domainPairKey) || 0;
    const testTypeCount = usedTestTypes.get(candidate.testType) || 0;
    const var1Count = usedVar1Stems.get(candidateVar1Stem) || 0;

    if (domainPairCount >= 2 && testTypeCount >= 2) continue;
    if (candidate.testType === StatTestType.CORRELATION && testTypeCount >= 2) continue;
    if (var1Count >= 2) continue;

    selected.push(candidate);
    usedSignalKeys.add(candidate.signalKey);
    usedVar1Stems.set(candidateVar1Stem, var1Count + 1);
    usedVar2Stems.add(candidateVar2Stem);
    usedDomainPairs.set(domainPairKey, domainPairCount + 1);
    usedTestTypes.set(candidate.testType, testTypeCount + 1);
  }

  return selected.map(({ score, groupDomain, outcomeDomain, signalKey, ...task }) => task);
};

export const applyBenjaminiHochbergAdjustments = (
  sessions: AnalysisSession[],
  method = 'Benjamini-Hochberg FDR'
): AnalysisSession[] => {
  const withP = sessions
    .map((session, index) => ({
      session,
      index,
      pValue:
        parseMetricPValue(session.metrics.p_value) ??
        parseMetricPValue(session.metrics.p_value_slope),
    }))
    .filter((item): item is { session: AnalysisSession; index: number; pValue: number } => item.pValue != null)
    .sort((a, b) => a.pValue - b.pValue);

  if (withP.length <= 1) {
    return sessions;
  }

  const adjusted: number[] = new Array(withP.length);
  for (let i = withP.length - 1; i >= 0; i -= 1) {
    const rank = i + 1;
    const rawAdjusted = (withP[i].pValue * withP.length) / rank;
    adjusted[i] = i === withP.length - 1 ? rawAdjusted : Math.min(rawAdjusted, adjusted[i + 1]);
  }

  const adjustedBySessionId = new Map(
    withP.map((item, index) => [item.session.id, Math.min(1, adjusted[index])])
  );

  return sessions.map((session) => {
    const adjustedValue = adjustedBySessionId.get(session.id);
    if (adjustedValue == null) return session;
    return {
      ...session,
      metrics: {
        ...session.metrics,
        adjusted_p_value: formatPValue(adjustedValue),
        multiple_testing_method: method,
      },
      params: {
        ...session.params,
        autopilotAdjustedPValue: formatPValue(adjustedValue),
        autopilotMultiplicityMethod: method,
      },
    };
  });
};
