import fs from 'node:fs/promises';
import path from 'node:path';

const STORE_BACKEND = process.env.PROJECT_STORE_BACKEND || 'local-disk';

export const createProjectStore = (rootDir) => {
  const dataDir = path.join(rootDir, '.app-data');
  const projectsFile = path.join(dataDir, 'projects.json');

  const ensureDataDir = async () => {
    await fs.mkdir(dataDir, { recursive: true });
  };

  const readProjects = async () => {
    if (STORE_BACKEND !== 'local-disk') {
      throw new Error(`Unsupported project store backend: ${STORE_BACKEND}`);
    }

    try {
      const raw = await fs.readFile(projectsFile, 'utf8');
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  };

  const writeProjects = async (projects) => {
    if (STORE_BACKEND !== 'local-disk') {
      throw new Error(`Unsupported project store backend: ${STORE_BACKEND}`);
    }

    await ensureDataDir();
    const tempFile = `${projectsFile}.tmp`;
    await fs.writeFile(tempFile, JSON.stringify(projects, null, 2), 'utf8');
    await fs.rename(tempFile, projectsFile);
  };

  const clearProjects = async () => {
    if (STORE_BACKEND !== 'local-disk') {
      throw new Error(`Unsupported project store backend: ${STORE_BACKEND}`);
    }

    try {
      await fs.unlink(projectsFile);
    } catch (error) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) {
        throw error;
      }
    }
  };

  return {
    backend: STORE_BACKEND,
    readProjects,
    writeProjects,
    clearProjects,
  };
};
