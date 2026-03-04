import { ClinicalFile, DataType, MappingSpec, ProvenanceRecord, ProvenanceType } from './types';

export const MOCK_FILES: ClinicalFile[] = [
  {
    id: 'f1',
    name: 'raw_dm_extract_v1.csv',
    type: DataType.RAW,
    uploadDate: '2023-10-25T10:00:00Z',
    size: '1.2MB',
    content: 'SUBJID,AGE,SEX,RACE,ARM\n001,45,M,White,Placebo\n002,52,F,Asian,Active 10mg'
  },
  {
    id: 'f2',
    name: 'raw_ae_extract_v1.csv',
    type: DataType.RAW,
    uploadDate: '2023-10-25T10:05:00Z',
    size: '3.4MB',
    content: 'SUBJID,AETERM,AESTDT,AESEV\n001,Headache,2023-01-01,Mild\n002,Nausea,2023-01-02,Moderate'
  },
  {
    id: 'f3',
    name: 'sdtm_dm_spec.json',
    type: DataType.MAPPING,
    uploadDate: '2023-10-26T09:00:00Z',
    size: '15KB',
    content: JSON.stringify({ source: 'raw_dm', target: 'DM', map: [] })
  },
  {
    id: 'f4',
    name: 'Protocol_v3.pdf',
    type: DataType.DOCUMENT,
    uploadDate: '2023-10-20T14:00:00Z',
    size: '4.5MB',
    content: 'Protocol Title: A Phase 3 Study... Objective: To evaluate safety and efficacy...'
  },
  {
    id: 'f5',
    name: 'SAP_v1.pdf',
    type: DataType.DOCUMENT,
    uploadDate: '2023-10-21T11:30:00Z',
    size: '2.1MB',
    content: 'Statistical Analysis Plan: Primary endpoint is change from baseline in...'
  }
];

export const INITIAL_PROVENANCE: ProvenanceRecord[] = [
  {
    id: 'p1',
    timestamp: '2023-10-25T10:00:00Z',
    userId: 'user_123',
    actionType: ProvenanceType.INGESTION,
    details: 'Uploaded raw_dm_extract_v1.csv',
    inputs: ['f1']
  }
];

export const MOCK_MAPPING: MappingSpec = {
  id: 'm1',
  sourceDomain: 'RAW_DM',
  targetDomain: 'SDTM_DM',
  mappings: [
    { sourceCol: 'SUBJID', targetCol: 'USUBJID', transformation: 'Concat with StudyID' },
    { sourceCol: 'AGE', targetCol: 'AGE' },
    { sourceCol: 'SEX', targetCol: 'SEX' },
    { sourceCol: 'RACE', targetCol: 'RACE' },
    { sourceCol: 'ARM', targetCol: 'ARM' }
  ]
};
