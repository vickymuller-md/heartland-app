import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/offline/db';
import { flushQueue } from '@/lib/offline/sync';
import { registerSyncListeners } from '@/lib/offline/register-sync';

describe('Legacy Offline Sync Shutdown', () => {
  beforeEach(async () => {
    await db.sync_queue.clear();
  });

  it('purges queued PHI and reports no network synchronization', async () => {
    await db.sync_queue.add({
      id: 'legacy',
      table: 'vitals',
      payload: { patient_id: 'p1', weight_lbs: 180 },
      status: 'pending',
      attempts: 0,
      created_at: Date.now(),
    });

    await expect(flushQueue()).resolves.toEqual({ synced: 0, failed: 0 });
    expect(await db.sync_queue.count()).toBe(0);
  });

  it('registers no online, visibility, service-worker, or Background Sync trigger', () => {
    const addWindowSpy = vi.spyOn(window, 'addEventListener');
    const addDocumentSpy = vi.spyOn(document, 'addEventListener');

    const cleanup = registerSyncListeners();

    expect(addWindowSpy).not.toHaveBeenCalledWith('online', expect.any(Function));
    expect(addDocumentSpy).not.toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    expect(cleanup).toBeTypeOf('function');
    expect(() => cleanup()).not.toThrow();

    addWindowSpy.mockRestore();
    addDocumentSpy.mockRestore();
  });
});
