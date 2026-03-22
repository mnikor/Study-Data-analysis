import { describe, expect, it } from 'vitest';
import { ClinicalFile, DataType } from '../types';
import { retrieveRelevantContext } from './rag';

const documentFile: ClinicalFile = {
  id: 'doc-1',
  name: 'Protocol.txt',
  type: DataType.DOCUMENT,
  uploadDate: new Date().toISOString(),
  size: '1 KB',
  content: [
    'Background',
    'This section discusses general study setup and monitoring cadence.',
    '',
    'Dose modification rules',
    'Subjects with dermatologic toxicity should interrupt treatment for Grade 2 rash and reduce dose after recurrence.',
    '',
    'Schedule of assessments',
    'Visits occur every 4 weeks.',
  ].join('\n'),
};

const tableFile: ClinicalFile = {
  id: 'tab-1',
  name: 'adae.csv',
  type: DataType.STANDARDIZED,
  uploadDate: new Date().toISOString(),
  size: '1 KB',
  content: [
    'USUBJID,AETERM,AETOXGR,AESTDY,TRT01A',
    '01,Rash,2,20,DrugA',
    '02,Fatigue,1,15,DrugA',
    '03,Dermatitis,3,32,DrugB',
    '04,Nausea,1,10,DrugB',
  ].join('\n'),
};

describe('retrieveRelevantContext', () => {
  it('retrieves the document chunk most relevant to the user query', () => {
    const result = retrieveRelevantContext('What are the dose reduction rules for grade 2 rash?', [documentFile]);

    expect(result.contextText).toContain('RETRIEVED CHUNK 1');
    expect(result.contextText).toContain('Dose modification rules');
    expect(result.contextText).toContain('Grade 2 rash');
    expect(result.citations[0]?.sourceId).toBe('Protocol.txt');
    expect(result.citations[0]?.title).toBe('Document excerpt');
  });

  it('retrieves tabular row windows relevant to the requested variables', () => {
    const result = retrieveRelevantContext('Show rash grade 2 adverse events by treatment', [tableFile]);

    expect(result.contextText).toContain('TABULAR ROW WINDOW');
    expect(result.contextText).toContain('AETERM');
    expect(result.contextText).toContain('Rash');
    expect(result.contextText).toContain('DrugA');
    expect(result.citations[0]?.sourceId).toBe('adae.csv');
    expect(result.citations.some((citation) => citation.kind === 'TABULAR_ROWS')).toBe(true);
    expect(result.citations.some((citation) => /Rows|Dataset profile/.test(citation.title || ''))).toBe(true);
  });
});
