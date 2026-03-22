import { describe, expect, it } from 'vitest';
import { ClinicalFile, DataType } from '../types';
import { inferDatasetProfile, mapProfileKindToAnalysisRole } from './datasetProfile';

const makeFile = (overrides: Partial<ClinicalFile>): ClinicalFile => ({
  id: crypto.randomUUID(),
  name: 'file.csv',
  type: DataType.RAW,
  uploadDate: new Date().toISOString(),
  size: '1 KB',
  content: 'A,B\n1,2',
  ...overrides,
});

describe('datasetProfile', () => {
  it('recognizes ADSL datasets', () => {
    const profile = inferDatasetProfile(
      makeFile({
        name: 'adsl.csv',
        type: DataType.STANDARDIZED,
        content: 'USUBJID,TRT01A,AGE,SEX,ITTFL\n01,DrugA,65,M,Y',
      })
    );

    expect(profile.kind).toBe('ADSL');
    expect(profile.model).toBe('ADAM');
  });

  it('recognizes ADLB datasets', () => {
    const profile = inferDatasetProfile(
      makeFile({
        name: 'adlb.csv',
        type: DataType.STANDARDIZED,
        content: 'USUBJID,PARAMCD,PARAM,AVAL,AVISIT\n01,HGB,Hemoglobin,13.1,Week 1',
      })
    );

    expect(profile.kind).toBe('ADLB');
    expect(profile.shortLabel).toBe('ADaM • ADLB');
  });

  it('recognizes ADTTE datasets', () => {
    const profile = inferDatasetProfile(
      makeFile({
        name: 'adtte.csv',
        type: DataType.STANDARDIZED,
        content: 'USUBJID,PARAMCD,PARAM,AVAL,CNSR\n01,OS,Overall Survival,12,0',
      })
    );

    expect(profile.kind).toBe('ADTTE');
    expect(profile.guidance).toMatch(/Kaplan-Meier\/log-rank/i);
  });

  it('maps raw DM, AE, and LB style files to backend analysis roles', () => {
    const dmProfile = inferDatasetProfile(
      makeFile({
        name: 'dm.csv',
        type: DataType.RAW,
        content: 'USUBJID,ARM,AGE,SEX,RACE\n01,DrugA,65,F,ASIAN',
      })
    );
    const aeProfile = inferDatasetProfile(
      makeFile({
        name: 'ae.csv',
        type: DataType.RAW,
        content: 'USUBJID,AETERM,AEDECOD,AETOXGR,AESTDY\n01,Rash,Rash,2,14',
      })
    );
    const lbProfile = inferDatasetProfile(
      makeFile({
        name: 'lb.csv',
        type: DataType.RAW,
        content: 'USUBJID,LBTESTCD,LBTEST,LBSTRESN\n01,HGB,Hemoglobin,13.1',
      })
    );

    expect(dmProfile.kind).toBe('ADSL');
    expect(aeProfile.kind).toBe('ADVERSE_EVENTS');
    expect(lbProfile.kind).toBe('LABS');
    expect(mapProfileKindToAnalysisRole(dmProfile.kind)).toBe('ADSL');
    expect(mapProfileKindToAnalysisRole(aeProfile.kind)).toBe('ADAE');
    expect(mapProfileKindToAnalysisRole(lbProfile.kind)).toBe('ADLB');
  });

  it('maps disposition and compliance style files to DS', () => {
    const dsProfile = inferDatasetProfile(
      makeFile({
        name: 'ds.csv',
        type: DataType.RAW,
        content: 'USUBJID,DSTERM,DSDECOD,DSSTDY\n01,Treatment Discontinued,DISCONTINUED,45',
      })
    );

    expect(dsProfile.kind).toBe('DISPOSITION');
    expect(mapProfileKindToAnalysisRole(dsProfile.kind)).toBe('DS');
  });
});
