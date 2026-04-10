import { ClinicalFile, DataType } from '../types';
import { buildQuestionFileRecommendation, DatasetProfile, FileRoleRecommendation } from './datasetProfile';

export interface ChatAnalysisResolution {
  resolvedFiles: ClinicalFile[];
  note: string;
  recommendation: FileRoleRecommendation | null;
  autoSelected: boolean;
}

const uniqueFilesById = (files: ClinicalFile[]): ClinicalFile[] =>
  Array.from(new Map(files.map((file) => [file.id, file])).values());

const isTabularContextFile = (file: ClinicalFile) =>
  (file.type === DataType.RAW || file.type === DataType.STANDARDIZED) && Boolean(file.content);

const sameFileSet = (left: ClinicalFile[], right: ClinicalFile[]): boolean => {
  const leftIds = new Set(left.map((file) => file.id));
  const rightIds = new Set(right.map((file) => file.id));
  if (leftIds.size !== rightIds.size) return false;
  for (const id of leftIds) {
    if (!rightIds.has(id)) return false;
  }
  return true;
};

export const resolveChatAnalysisContext = (
  question: string,
  selectedFiles: ClinicalFile[],
  allFiles: ClinicalFile[],
  profilesByFileId?: Map<string, DatasetProfile>
): ChatAnalysisResolution => {
  const trimmedQuestion = question.trim();
  const availableFiles = allFiles.filter(
    (file) => file.type === DataType.DOCUMENT || file.type === DataType.RAW || file.type === DataType.STANDARDIZED
  );
  const selectedDocuments = selectedFiles.filter((file) => file.type === DataType.DOCUMENT);
  const selectedTabular = selectedFiles.filter(isTabularContextFile);

  if (!trimmedQuestion) {
    return {
      resolvedFiles: selectedFiles.length > 0 ? selectedFiles : availableFiles,
      note: '',
      recommendation: null,
      autoSelected: false,
    };
  }

  const selectedRecommendation =
    selectedTabular.length > 0
      ? buildQuestionFileRecommendation(trimmedQuestion, selectedTabular, profilesByFileId)
      : null;
  const selectedResolved = uniqueFilesById([
    ...selectedDocuments,
    ...((Object.values(selectedRecommendation?.selectedByRole || {}).filter(Boolean) as ClinicalFile[])),
  ]);
  const selectedSupportsQuestion =
    Boolean(selectedRecommendation) &&
    selectedResolved.some((file) => isTabularContextFile(file)) &&
    (selectedRecommendation?.missingRequiredRoles.length || 0) === 0;

  const projectRecommendation = buildQuestionFileRecommendation(trimmedQuestion, availableFiles, profilesByFileId);
  const projectResolved = uniqueFilesById([
    ...selectedDocuments,
    ...((Object.values(projectRecommendation.selectedByRole).filter(Boolean) as ClinicalFile[])),
  ]);

  if (selectedSupportsQuestion && selectedResolved.length > 0) {
    return {
      resolvedFiles: selectedResolved,
      note: '',
      recommendation: selectedRecommendation,
      autoSelected: false,
    };
  }

  if (projectResolved.length > 0) {
    const autoSelected = !sameFileSet(projectResolved, selectedFiles);
    return {
      resolvedFiles: projectResolved,
      recommendation: projectRecommendation,
      autoSelected,
      note: autoSelected
        ? [
            '### Auto-selected relevant sources',
            `Used the best-matching available files for this question: ${projectResolved.map((file) => `\`${file.name}\``).join(', ')}.`,
            selectedFiles.length > 0
              ? 'The app did not stay rigidly bound to the currently selected files because they were incomplete, duplicated, or less relevant for this question.'
              : 'The app searched the available project files to assemble the most relevant context.',
          ].join('\n')
        : '',
    };
  }

  return {
    resolvedFiles: selectedFiles.length > 0 ? selectedFiles : availableFiles,
    note: '',
    recommendation: projectRecommendation,
    autoSelected: false,
  };
};
