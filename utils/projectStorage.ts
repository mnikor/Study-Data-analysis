import { Project } from '../types';

const PROJECTS_API_ENDPOINT = '/api/projects';
const LEGACY_PROJECTS_STORAGE_KEY = 'clinical_ai_projects';
const LEGACY_DB_NAME = 'clinical-ai-db';
const LEGACY_DB_VERSION = 1;
const LEGACY_STORE_NAME = 'app-state';
const LEGACY_PROJECTS_KEY = 'projects';

const parseProjects = (value: unknown): Project[] | null => (Array.isArray(value) ? (value as Project[]) : null);

const fetchJson = async <T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> => {
  const response = await fetch(input, init);
  const text = await response.text().catch(() => '');
  const payload = text ? JSON.parse(text) : {};

  if (!response.ok) {
    const error = typeof payload?.error === 'string' ? payload.error : `Project storage request failed (${response.status})`;
    throw new Error(error);
  }

  return payload as T;
};

export const loadProjectsFromServer = async (): Promise<Project[] | null> => {
  const payload = await fetchJson<{ projects?: unknown }>(PROJECTS_API_ENDPOINT, {
    method: 'GET',
    headers: { 'Cache-Control': 'no-store' },
  });
  return parseProjects(payload.projects) || [];
};

export const saveProjectsToServer = async (projects: Project[]): Promise<void> => {
  await fetchJson(PROJECTS_API_ENDPOINT, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projects }),
  });
};

export const clearProjectsOnServer = async (): Promise<void> => {
  await fetchJson(PROJECTS_API_ENDPOINT, { method: 'DELETE' });
};

const openLegacyDb = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available in this environment.'));
      return;
    }

    const request = indexedDB.open(LEGACY_DB_NAME, LEGACY_DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(LEGACY_STORE_NAME)) {
        db.createObjectStore(LEGACY_STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Failed to open IndexedDB.'));
  });

const withLegacyStore = async <T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore, resolve: (value: T) => void, reject: (reason?: unknown) => void) => void
): Promise<T> => {
  const db = await openLegacyDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(LEGACY_STORE_NAME, mode);
    const store = tx.objectStore(LEGACY_STORE_NAME);

    tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted.'));
    tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction failed.'));
    tx.oncomplete = () => db.close();

    operation(store, resolve, reject);
  });
};

export const loadLegacyProjectsFromIndexedDb = async (): Promise<Project[] | null> =>
  withLegacyStore<Project[] | null>('readonly', (store, resolve, reject) => {
    const request = store.get(LEGACY_PROJECTS_KEY);
    request.onsuccess = () => resolve(parseProjects(request.result));
    request.onerror = () => reject(request.error || new Error('Failed to load legacy projects from IndexedDB.'));
  });

export const clearLegacyProjectsInIndexedDb = async (): Promise<void> =>
  withLegacyStore<void>('readwrite', (store, resolve, reject) => {
    const request = store.delete(LEGACY_PROJECTS_KEY);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error || new Error('Failed to clear legacy projects from IndexedDB.'));
  });

export const loadLegacyProjectsFromLocalStorage = (): Project[] | null => {
  if (typeof localStorage === 'undefined') return null;
  const saved = localStorage.getItem(LEGACY_PROJECTS_STORAGE_KEY);
  if (!saved) return null;

  try {
    return parseProjects(JSON.parse(saved));
  } catch (error) {
    console.warn('Failed to parse saved projects from localStorage. Resetting storage.', error);
    localStorage.removeItem(LEGACY_PROJECTS_STORAGE_KEY);
    return null;
  }
};

export const clearLegacyProjectsInLocalStorage = (): void => {
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(LEGACY_PROJECTS_STORAGE_KEY);
  }
};
