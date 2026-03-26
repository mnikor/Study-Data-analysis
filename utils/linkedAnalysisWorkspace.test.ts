import { describe, expect, it } from 'vitest';
import { AnalysisSession, ClinicalFile, DataType, StatTestType, UsageMode } from '../types';
import {
  applyBenjaminiHochbergAdjustments,
  buildExploratorySignalTasks,
  buildLinkedAnalysisWorkspace,
} from './linkedAnalysisWorkspace';
import { parseCsv } from './dataProcessing';

const makeFile = (name: string, content: string): ClinicalFile => ({
  id: crypto.randomUUID(),
  name,
  type: DataType.RAW,
  uploadDate: new Date().toISOString(),
  size: '1 KB',
  content,
});

describe('linkedAnalysisWorkspace', () => {
  it('builds a subject-level workspace with derived cross-domain columns', () => {
    const dm = makeFile(
      'raw_demographics.csv',
      [
        'USUBJID,TRT_ARM,AGE,SEX',
        'S1,Arm A,60,F',
        'S2,Arm B,48,M',
      ].join('\n')
    );
    const ae = makeFile(
      'raw_adverse_events.csv',
      [
        'USUBJID,PT,SERIOUS,GRADE',
        'S1,Rash,Yes,2',
        'S1,Headache,No,1',
        'S2,Nausea,No,1',
      ].join('\n')
    );

    const workspace = buildLinkedAnalysisWorkspace(dm, [ae], ['rash', 'dermatitis']);
    const parsed = parseCsv(workspace.workspaceFile.content);

    expect(parsed.rows).toHaveLength(2);
    expect(parsed.headers).toContain('AGE');
    expect(parsed.headers).toContain('ADVERSE_EVENTS__RECORD_COUNT');
    expect(parsed.headers).toContain('ADVERSE_EVENTS__GRADE__MAX');
    expect(parsed.headers).toContain('ADVERSE_EVENTS__RASH_PRESENT');
    expect(parsed.rows.find((row) => row.USUBJID === 'S1')?.ADVERSE_EVENTS__RASH_PRESENT).toBe('Present');
    expect(parsed.rows.find((row) => row.USUBJID === 'S2')?.ADVERSE_EVENTS__RASH_PRESENT).toBe('Absent');
  });

  it('creates cross-domain exploratory tasks from linked workspace features', () => {
    const workspaceFile = makeFile(
      'workspace_demo.csv',
      [
        'USUBJID,TRT_ARM,AGE,SEX,ADVERSE_EVENTS__RASH_PRESENT,ADVERSE_EVENTS__RECORD_COUNT',
        'S1,Arm A,60,F,Present,2',
        'S2,Arm B,48,M,Absent,1',
        'S3,Arm A,54,F,Present,3',
        'S4,Arm B,50,M,Absent,0',
      ].join('\n')
    );

    const tasks = buildExploratorySignalTasks(workspaceFile, 4);

    expect(tasks.length).toBeGreaterThan(0);
    expect(
      tasks.some(
        (task) =>
          [task.var1, task.var2].includes('ADVERSE_EVENTS__RASH_PRESENT') &&
          [task.var1, task.var2].some((column) => ['AGE', 'SEX', 'TRT_ARM'].includes(column))
      )
    ).toBe(true);
  });

  it('avoids near-duplicate mean and max variants of the same signal family', () => {
    const workspaceFile = makeFile(
      'workspace_duplicate_signals.csv',
      [
        'USUBJID,TRT_ARM,EARLY_RASH__MEAN,EARLY_RASH__MAX,EARLY_PRURITUS__MEAN,EARLY_PRURITUS__MAX',
        'S1,Arm A,1,2,0,1',
        'S2,Arm B,0,1,1,2',
        'S3,Arm A,2,3,0,1',
        'S4,Arm B,1,1,2,3',
      ].join('\n')
    );

    const tasks = buildExploratorySignalTasks(workspaceFile, 6);
    const var2s = tasks.map((task) => task.var2);

    expect(var2s.filter((value) => value.startsWith('EARLY_RASH')).length).toBeLessThanOrEqual(1);
    expect(var2s.filter((value) => value.startsWith('EARLY_PRURITUS')).length).toBeLessThanOrEqual(1);
  });

  it('does not repeat the same arm-style grouping semantics across duplicate columns', () => {
    const workspaceFile = makeFile(
      'workspace_duplicate_groups.csv',
      [
        'USUBJID,ARM,DM__ARM__MODE,AE__ARM__MODE,EARLY_RASH__MEAN,EARLY_PRURITUS__MEAN',
        'S1,Arm A,Arm A,Arm A,1,0',
        'S2,Arm B,Arm B,Arm B,0,1',
        'S3,Arm A,Arm A,Arm A,2,0',
        'S4,Arm B,Arm B,Arm B,1,2',
      ].join('\n')
    );

    const tasks = buildExploratorySignalTasks(workspaceFile, 6);
    const armComparisons = tasks.filter((task) =>
      ['ARM', 'DM__ARM__MODE', 'AE__ARM__MODE'].includes(task.var1)
    );

    expect(armComparisons.length).toBeLessThanOrEqual(2);
  });

  it('can include a non-group exploratory association in the pack', () => {
    const workspaceFile = makeFile(
      'workspace_numeric_association.csv',
      [
        'USUBJID,TRT_ARM,LAB_ALP__MEAN,AE_QUALIFYING_EVENT_COUNT,EX_DOSE__MEAN',
        'S1,Arm A,10,1,100',
        'S2,Arm B,15,2,120',
        'S3,Arm A,20,3,150',
        'S4,Arm B,25,4,180',
      ].join('\n')
    );

    const tasks = buildExploratorySignalTasks(workspaceFile, 6);

    expect(tasks.some((task) => task.testType === StatTestType.CORRELATION)).toBe(true);
  });

  it('adds adjusted p-values to exploratory sessions', () => {
    const baseSession = (id: string, pValue: string): AnalysisSession => ({
      id,
      timestamp: new Date().toISOString(),
      name: `Session ${id}`,
      usageMode: UsageMode.EXPLORATORY,
      params: {
        fileId: 'f1',
        fileName: 'workspace.csv',
        testType: StatTestType.CHI_SQUARE,
        var1: 'TRT_ARM',
        var2: 'RASH_PRESENT',
      },
      metrics: {
        test: 'Chi-Square',
        p_value: pValue,
      },
      interpretation: 'test',
      chartConfig: { data: [], layout: {} },
      executedCode: '# test',
    });

    const adjusted = applyBenjaminiHochbergAdjustments([
      baseSession('s1', '0.0100'),
      baseSession('s2', '0.0200'),
      baseSession('s3', '0.2000'),
    ]);

    expect(adjusted[0].metrics.adjusted_p_value).toBeDefined();
    expect(adjusted[0].metrics.multiple_testing_method).toBe('Benjamini-Hochberg FDR');
    expect(adjusted[0].params.autopilotAdjustedPValue).toBeDefined();
  });
});
