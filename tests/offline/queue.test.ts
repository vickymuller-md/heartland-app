import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearSynced,
  enqueueSymptoms,
  enqueueVitals,
  getPendingItems,
  OfflineClinicalStorageDisabledError,
} from '@/lib/offline/queue';
import { clearClientSecurityState, clearOfflineData, db } from '@/lib/offline/db';

function createStorageMock(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => Array.from(values.keys())[index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, String(value)); },
  };
}

Object.defineProperty(window, 'localStorage', {
  configurable: true,
  value: createStorageMock(),
});
Object.defineProperty(window, 'sessionStorage', {
  configurable: true,
  value: createStorageMock(),
});

describe('Offline Clinical Storage Shutdown', () => {
  beforeEach(async () => {
    await db.sync_queue.clear();
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('refuses to persist vitals in IndexedDB', async () => {
    await expect(enqueueVitals({ patient_id: 'p1', sbp: 120 })).rejects.toBeInstanceOf(
      OfflineClinicalStorageDisabledError,
    );
    expect(await db.sync_queue.count()).toBe(0);
  });

  it('refuses to persist symptoms in IndexedDB', async () => {
    await expect(enqueueSymptoms({ patient_id: 'p1', dyspnea: 2 })).rejects.toBeInstanceOf(
      OfflineClinicalStorageDisabledError,
    );
    expect(await db.sync_queue.count()).toBe(0);
  });

  it('purges legacy records instead of returning them for sync', async () => {
    await db.sync_queue.add({
      id: 'legacy',
      table: 'vitals',
      payload: { patient_id: 'p1', sbp: 120 },
      status: 'pending',
      attempts: 0,
      created_at: Date.now(),
    });

    await expect(getPendingItems()).resolves.toEqual([]);
    expect(await db.sync_queue.count()).toBe(0);
  });

  it('clearSynced now purges every legacy queue state', async () => {
    await db.sync_queue.bulkAdd([
      { id: '1', table: 'vitals', payload: {}, status: 'pending', attempts: 0, created_at: Date.now() },
      { id: '2', table: 'symptoms', payload: {}, status: 'synced', attempts: 0, created_at: Date.now() },
    ]);

    await expect(clearSynced()).resolves.toBe(2);
    expect(await db.sync_queue.count()).toBe(0);
  });

  it('clearOfflineData is idempotent', async () => {
    await clearOfflineData();
    await clearOfflineData();
    expect(await db.sync_queue.count()).toBe(0);
  });

  it('logout cleanup removes app storage and every origin cache', async () => {
    window.localStorage.setItem('heartland:provider_phone', '555-0100');
    window.localStorage.setItem('unrelated', 'keep');
    window.sessionStorage.setItem('heartland-session-ui', 'value');

    const deleteCache = vi.fn().mockResolvedValue(true);
    vi.stubGlobal('caches', {
      keys: vi.fn().mockResolvedValue(['precache', 'pages-rsc']),
      delete: deleteCache,
    });

    await clearClientSecurityState();

    expect(window.localStorage.getItem('heartland:provider_phone')).toBeNull();
    expect(window.sessionStorage.getItem('heartland-session-ui')).toBeNull();
    expect(window.localStorage.getItem('unrelated')).toBe('keep');
    expect(deleteCache).toHaveBeenCalledTimes(2);
  });
});
