import { ClinicalFile, DataType } from '../types';
import { parseCsv } from './dataProcessing';

export interface RetrievedContextCitation {
  sourceId: string;
  snippet: string;
  kind?: 'DOCUMENT' | 'TABULAR_PROFILE' | 'TABULAR_ROWS';
  title?: string;
}

export interface RetrievedContextChunk {
  sourceId: string;
  sourceName: string;
  kind: 'DOCUMENT' | 'TABULAR_PROFILE' | 'TABULAR_ROWS';
  text: string;
  snippet: string;
  score: number;
}

interface CandidateChunk extends RetrievedContextChunk {
  searchText: string;
}

const DEFAULT_TOP_K = 6;
const DEFAULT_MAX_PER_FILE = 3;
const DEFAULT_MAX_CONTEXT_CHARS = 7000;

const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'for',
  'from',
  'how',
  'in',
  'is',
  'it',
  'of',
  'on',
  'or',
  'that',
  'the',
  'their',
  'this',
  'to',
  'was',
  'what',
  'when',
  'which',
  'with',
]);

const normalizeText = (text: string): string =>
  text
    .replace(/[_/\\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

const tokenize = (text: string): string[] =>
  normalizeText(text)
    .split(/[^a-z0-9.>=]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !STOP_WORDS.has(token));

const uniqueTokens = (text: string): string[] => Array.from(new Set(tokenize(text)));

const shorten = (text: string, maxLength = 220): string =>
  text.length <= maxLength ? text : `${text.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;

const summarizeHeaders = (headers: string[], maxCount = 6) => {
  if (headers.length <= maxCount) return headers.join(', ');
  return `${headers.slice(0, maxCount).join(', ')}, ...`;
};

const buildCitation = (chunk: RetrievedContextChunk): RetrievedContextCitation => {
  if (chunk.kind === 'DOCUMENT') {
    return {
      sourceId: chunk.sourceName,
      kind: chunk.kind,
      title: 'Document excerpt',
      snippet: shorten(chunk.snippet, 180),
    };
  }

  const sourceMatch = chunk.text.match(/Source:\s*(.+)/);
  const rowsMatch = chunk.text.match(/Rows\s+(\d+-\d+)/i);
  const csvLine = chunk.text
    .split('\n')
    .find((line) => line.includes(',') && !/^Rows\s+/i.test(line) && !/^Source:/i.test(line) && !/^TABULAR/i.test(line));
  const headers = csvLine ? csvLine.split(',').map((item) => item.trim()).filter(Boolean) : [];

  if (chunk.kind === 'TABULAR_PROFILE') {
    const relevantMatch = chunk.text.match(/Query-relevant columns:\s*(.+)/i);
    return {
      sourceId: sourceMatch?.[1]?.trim() || chunk.sourceName,
      kind: chunk.kind,
      title: 'Dataset profile',
      snippet: relevantMatch?.[1] && !/none matched directly/i.test(relevantMatch[1])
        ? `Relevant columns: ${shorten(relevantMatch[1], 160)}`
        : `Available columns: ${shorten(summarizeHeaders(headers.length > 0 ? headers : chunk.text.split('\n').filter((line) => line.startsWith('Headers:')).flatMap((line) => line.replace('Headers:', '').split(',').map((part) => part.trim())).filter(Boolean)), 160)}`,
    };
  }

  return {
    sourceId: sourceMatch?.[1]?.trim() || chunk.sourceName,
    kind: chunk.kind,
    title: rowsMatch ? `Rows ${rowsMatch[1]}` : 'Row window',
    snippet: headers.length > 0
      ? `Columns shown: ${shorten(summarizeHeaders(headers), 160)}`
      : shorten(chunk.snippet, 180),
  };
};

const splitDocumentIntoChunks = (text: string, targetSize = 900): string[] => {
  const normalized = text.trim();
  if (!normalized) return [];

  const paragraphs = normalized
    .split(/\n\s*\n+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (paragraphs.length <= 1) {
    const chunks: string[] = [];
    const step = Math.max(500, targetSize - 180);
    for (let start = 0; start < normalized.length; start += step) {
      chunks.push(normalized.slice(start, start + targetSize).trim());
    }
    return chunks.filter(Boolean);
  }

  const chunks: string[] = [];
  let current = '';
  for (const paragraph of paragraphs) {
    if (!current) {
      current = paragraph;
      continue;
    }

    if (`${current}\n\n${paragraph}`.length <= targetSize) {
      current = `${current}\n\n${paragraph}`;
      continue;
    }

    chunks.push(current);
    current = paragraph;
  }

  if (current) chunks.push(current);
  return chunks;
};

const scoreCandidate = (query: string, candidate: CandidateChunk): number => {
  const normalizedQuery = normalizeText(query);
  const queryTokens = uniqueTokens(query);
  if (queryTokens.length === 0) return 0;

  const candidateText = candidate.searchText;
  const candidateTokens = new Set(uniqueTokens(candidateText));
  let score = 0;

  for (const token of queryTokens) {
    if (candidateTokens.has(token)) {
      score += token.length >= 6 ? 3 : 2;
    } else if (candidateText.includes(token)) {
      score += 1.5;
    }
  }

  if (normalizedQuery && candidateText.includes(normalizedQuery)) {
    score += 6;
  }

  if (candidate.kind === 'TABULAR_ROWS') {
    score += 0.5;
  }

  if (candidate.kind === 'TABULAR_PROFILE') {
    score += 0.25;
  }

  return score;
};

const buildDocumentCandidates = (file: ClinicalFile): CandidateChunk[] => {
  const content = file.content?.trim();
  if (!content) return [];

  return splitDocumentIntoChunks(content).map((chunkText) => ({
    sourceId: file.id,
    sourceName: file.name,
    kind: 'DOCUMENT',
    text: chunkText,
    snippet: shorten(chunkText.replace(/\s+/g, ' ')),
    searchText: normalizeText(`${file.name} ${chunkText}`),
    score: 0,
  }));
};

const formatCsvWindow = (headers: string[], rows: Record<string, string>[], selectedHeaders: string[]): string => {
  const headerLine = selectedHeaders.join(',');
  const rowLines = rows.map((row) => selectedHeaders.map((header) => row[header] ?? '').join(','));
  return [headerLine, ...rowLines].join('\n');
};

const buildTabularCandidates = (file: ClinicalFile, query: string): CandidateChunk[] => {
  const content = file.content?.trim();
  if (!content) return [];

  try {
    const { headers, rows } = parseCsv(content);
    const headerTokens = headers.map((header) => ({ header, text: normalizeText(header) }));
    const queryTokens = new Set(uniqueTokens(query));
    const matchedHeaders = headerTokens
      .filter(({ text }) => Array.from(queryTokens).some((token) => text.includes(token)))
      .map(({ header }) => header);
    const selectedHeaders = Array.from(
      new Set([
        ...matchedHeaders,
        ...headers.filter((header) => /^(USUBJID|SUBJID|STUDYID|TRT|ARM|AGE|SEX|RACE|AETERM|AEDECOD|AETOXGR|AESEV|AESTDY|PARAM|PARAMCD|AVAL|CNSR|STATUS|ADT|ADTTE)$/i.test(header)),
        ...headers.slice(0, 6),
      ])
    ).slice(0, 8);

    const profileText = [
      'TABULAR DATASET PROFILE',
      `Source: ${file.name}`,
      `Rows: ${rows.length}`,
      `Columns: ${headers.length}`,
      `Headers: ${headers.join(', ')}`,
      matchedHeaders.length > 0 ? `Query-relevant columns: ${matchedHeaders.join(', ')}` : 'Query-relevant columns: none matched directly',
    ].join('\n');

    const candidates: CandidateChunk[] = [
      {
        sourceId: file.id,
        sourceName: file.name,
        kind: 'TABULAR_PROFILE',
        text: profileText,
        snippet: shorten(profileText.replace(/\s+/g, ' ')),
        searchText: normalizeText(`${file.name} ${profileText}`),
        score: 0,
      },
    ];

    const windowSize = 10;
    for (let start = 0; start < rows.length; start += windowSize) {
      const windowRows = rows.slice(start, start + windowSize);
      if (windowRows.length === 0) continue;
      const csvWindow = formatCsvWindow(headers, windowRows, selectedHeaders);
      const rowChunkText = [
        `TABULAR ROW WINDOW`,
        `Source: ${file.name}`,
        `Rows ${start + 1}-${start + windowRows.length}`,
        csvWindow,
      ].join('\n');
      candidates.push({
        sourceId: file.id,
        sourceName: file.name,
        kind: 'TABULAR_ROWS',
        text: rowChunkText,
        snippet: shorten(rowChunkText.replace(/\s+/g, ' ')),
        searchText: normalizeText(`${file.name} ${rowChunkText}`),
        score: 0,
      });
    }

    return candidates;
  } catch {
    return [
      {
        sourceId: file.id,
        sourceName: file.name,
        kind: 'TABULAR_PROFILE',
        text: `TABULAR DATASET\nSource: ${file.name}\nRaw content available but could not be chunked as CSV.`,
        snippet: `Source: ${file.name}`,
        searchText: normalizeText(`${file.name} ${content}`),
        score: 0,
      },
    ];
  }
};

const buildCandidates = (file: ClinicalFile, query: string): CandidateChunk[] => {
  if (file.type === DataType.RAW || file.type === DataType.STANDARDIZED) {
    return buildTabularCandidates(file, query);
  }
  return buildDocumentCandidates(file);
};

export const retrieveRelevantContext = (
  query: string,
  contextFiles: ClinicalFile[],
  options?: {
    topK?: number;
    maxPerFile?: number;
    maxContextChars?: number;
  }
): {
  contextText: string;
  chunks: RetrievedContextChunk[];
  citations: RetrievedContextCitation[];
} => {
  if (contextFiles.length === 0) {
    return { contextText: 'No context files selected.', chunks: [], citations: [] };
  }

  const candidates = contextFiles.flatMap((file) => buildCandidates(file, query));
  const scored = candidates
    .map((candidate) => ({ ...candidate, score: scoreCandidate(query, candidate) }))
    .sort((left, right) => right.score - left.score);

  const topK = options?.topK ?? DEFAULT_TOP_K;
  const maxPerFile = options?.maxPerFile ?? DEFAULT_MAX_PER_FILE;
  const maxContextChars = options?.maxContextChars ?? DEFAULT_MAX_CONTEXT_CHARS;
  const selected: RetrievedContextChunk[] = [];
  const perFileCounts = new Map<string, number>();
  let usedChars = 0;

  for (const chunk of scored) {
    if (selected.length >= topK) break;
    const fileCount = perFileCounts.get(chunk.sourceId) || 0;
    if (fileCount >= maxPerFile) continue;
    if (usedChars > 0 && usedChars + chunk.text.length > maxContextChars) continue;
    if (chunk.score <= 0 && selected.length > 0) continue;

    selected.push(chunk);
    perFileCounts.set(chunk.sourceId, fileCount + 1);
    usedChars += chunk.text.length;
  }

  if (selected.length === 0 && scored.length > 0) {
    selected.push(scored[0]);
  }

  const contextText =
    selected.length === 0
      ? 'No context files selected.'
      : `RETRIEVED CONTEXT:\n${selected
          .map(
            (chunk, index) =>
              `--- RETRIEVED CHUNK ${index + 1} | Source: ${chunk.sourceName} | Kind: ${chunk.kind} ---\n${chunk.text}\n--- END CHUNK ---`
          )
          .join('\n\n')}`;

  return {
    contextText,
    chunks: selected,
    citations: selected.map((chunk) => buildCitation(chunk)),
  };
};
