import type { MorningBrief } from "../ai/morning-brief-contract";

const DATABASE_NAME = "panlayer-local-archive";
const STORE_NAME = "morning-briefs";
const DATABASE_VERSION = 1;

function openArchiveDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "date" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("本机早参存储不可用"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("本机早参保存失败"));
    transaction.onabort = () => reject(transaction.error ?? new Error("本机早参保存已中止"));
  });
}

export async function syncBriefArchiveToLocal(
  briefs: MorningBrief[],
  cutoffDate: string,
): Promise<number> {
  if (typeof indexedDB === "undefined") return 0;
  const database = await openArchiveDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const keysRequest = store.getAllKeys();
    const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
      keysRequest.onsuccess = () => resolve(keysRequest.result);
      keysRequest.onerror = () => reject(keysRequest.error);
    });
    keys.forEach((key) => {
      if (typeof key === "string" && key < cutoffDate) store.delete(key);
    });
    briefs.forEach((brief) => store.put(brief));
    await transactionDone(transaction);
    return briefs.length;
  } finally {
    database.close();
  }
}

export async function readLocalBriefArchive(cutoffDate: string): Promise<MorningBrief[]> {
  if (typeof indexedDB === "undefined") return [];
  const database = await openArchiveDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).getAll();
    const rows = await new Promise<MorningBrief[]>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result as MorningBrief[]);
      request.onerror = () => reject(request.error);
    });
    await transactionDone(transaction);
    return rows
      .filter((brief) => brief.date >= cutoffDate)
      .sort((left, right) => right.date.localeCompare(left.date));
  } finally {
    database.close();
  }
}
