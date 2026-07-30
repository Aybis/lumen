import type { DataRow } from "./analysis";
import type { AnalysisSkillId } from "./analysis-skills";
import type { DatasetIntelligence } from "./dataset-intelligence";
import type { VisualizationSpec } from "./visualization";

export type StoredChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  model?: string;
};

export type DatasetSession = {
  storageKey: string;
  id: string;
  ownerId: string;
  fileName: string;
  rows: DataRow[];
  rowCount: number;
  fieldCount: number;
  messages: StoredChatMessage[];
  activeAnalysisSkill: AnalysisSkillId;
  intelligence?: DatasetIntelligence;
  visualization?: VisualizationSpec;
  visualizations?: VisualizationSpec[];
  createdAt: string;
  updatedAt: string;
};

export type SessionSummary = Omit<DatasetSession, "rows" | "messages" | "storageKey" | "intelligence" | "visualization" | "visualizations"> & {
  messageCount: number;
};

const DATABASE_NAME = "lumen-private-workspaces";
const STORE_NAME = "dataset-sessions";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "storageKey" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open local session storage."));
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Local session storage failed."));
  });
}

function summary(session: DatasetSession): SessionSummary {
  return {
    id: session.id,
    ownerId: session.ownerId,
    fileName: session.fileName,
    rowCount: session.rowCount,
    fieldCount: session.fieldCount,
    messageCount: session.messages.length,
    activeAnalysisSkill: session.activeAnalysisSkill,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
}

export async function listDatasetSessions(ownerId: string): Promise<SessionSummary[]> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const sessions = await requestResult(transaction.objectStore(STORE_NAME).getAll()) as DatasetSession[];
    return sessions
      .filter((session) => session.ownerId === ownerId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map(summary);
  } finally {
    database.close();
  }
}

export async function getDatasetSession(ownerId: string, id: string): Promise<DatasetSession | undefined> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readonly");
    return await requestResult(transaction.objectStore(STORE_NAME).get(`${ownerId}:${id}`)) as DatasetSession | undefined;
  } finally {
    database.close();
  }
}

export async function putDatasetSession(session: DatasetSession): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    await requestResult(transaction.objectStore(STORE_NAME).put(session));
  } finally {
    database.close();
  }
}

export async function removeDatasetSession(ownerId: string, id: string): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    await requestResult(transaction.objectStore(STORE_NAME).delete(`${ownerId}:${id}`));
  } finally {
    database.close();
  }
}
