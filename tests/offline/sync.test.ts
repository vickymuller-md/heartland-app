/**
 * Sync Engine & Register Sync Listeners — Unit Tests
 * Requirements: PWA-03 (offline queue + sync), PWA-04 (sync on online/foreground)
 * Source: HEARTLAND Protocol v3.3, Module 5
 */

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { db } from '@/lib/offline/db';

// Mock Supabase client
const mockUpsert = vi.fn();
const mockFrom = vi.fn(() => ({ upsert: mockUpsert }));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ from: mockFrom }),
}));

import { flushQueue } from '@/lib/offline/sync';
import { registerSyncListeners } from '@/lib/offline/register-sync';

describe('Sync Engine', () => {
  beforeEach(async () => {
    await db.sync_queue.clear();
    vi.clearAllMocks();
    mockUpsert.mockResolvedValue({ error: null });
  });

  describe('flushQueue', () => {
    it('reads all pending and failed items from sync_queue', async () => {
      await db.sync_queue.bulkAdd([
        { id: '1', table: 'vitals', payload: { client_id: '1' }, status: 'pending', attempts: 0, created_at: Date.now() },
        { id: '2', table: 'vitals', payload: { client_id: '2' }, status: 'failed', attempts: 1, created_at: Date.now() },
      ]);

      await flushQueue();
      // Both items should have been processed (called upsert twice)
      expect(mockUpsert).toHaveBeenCalledTimes(2);
    });

    it('sets status to "syncing" before attempting Supabase upsert', async () => {
      // Intercept the upsert to check DB state mid-flush
      let statusDuringUpsert: string | undefined;
      mockUpsert.mockImplementation(async () => {
        const item = await db.sync_queue.get('1');
        statusDuringUpsert = item?.status;
        return { error: null };
      });

      await db.sync_queue.add({
        id: '1', table: 'vitals', payload: { client_id: '1' },
        status: 'pending', attempts: 0, created_at: Date.now(),
      });

      await flushQueue();
      expect(statusDuringUpsert).toBe('syncing');
    });

    it('calls Supabase upsert with onConflict "client_id"', async () => {
      const payload = { client_id: '1', weight_lbs: 180 };
      await db.sync_queue.add({
        id: '1', table: 'vitals', payload,
        status: 'pending', attempts: 0, created_at: Date.now(),
      });

      await flushQueue();
      expect(mockFrom).toHaveBeenCalledWith('vitals');
      expect(mockUpsert).toHaveBeenCalledWith(payload, { onConflict: 'client_id' });
    });

    it('marks item as "synced" with synced_at timestamp on success', async () => {
      await db.sync_queue.add({
        id: '1', table: 'vitals', payload: { client_id: '1' },
        status: 'pending', attempts: 0, created_at: Date.now(),
      });

      const before = Date.now();
      await flushQueue();
      const after = Date.now();

      const item = await db.sync_queue.get('1');
      expect(item?.status).toBe('synced');
      expect(item?.synced_at).toBeGreaterThanOrEqual(before);
      expect(item?.synced_at).toBeLessThanOrEqual(after);
    });

    it('marks item as "failed" and increments attempts on error', async () => {
      mockUpsert.mockResolvedValue({ error: new Error('Network error') });

      await db.sync_queue.add({
        id: '1', table: 'vitals', payload: { client_id: '1' },
        status: 'pending', attempts: 2, created_at: Date.now(),
      });

      await flushQueue();

      const item = await db.sync_queue.get('1');
      expect(item?.status).toBe('failed');
      expect(item?.attempts).toBe(3);
    });

    it('skips items with attempts >= 5 (dead letter)', async () => {
      await db.sync_queue.bulkAdd([
        { id: '1', table: 'vitals', payload: { client_id: '1' }, status: 'failed', attempts: 5, created_at: Date.now() },
        { id: '2', table: 'vitals', payload: { client_id: '2' }, status: 'pending', attempts: 0, created_at: Date.now() },
      ]);

      await flushQueue();
      // Only item 2 should be processed
      expect(mockUpsert).toHaveBeenCalledTimes(1);
      expect(mockUpsert).toHaveBeenCalledWith({ client_id: '2' }, { onConflict: 'client_id' });
    });

    it('returns { synced: N, failed: N } counts', async () => {
      mockUpsert
        .mockResolvedValueOnce({ error: null })
        .mockResolvedValueOnce({ error: new Error('fail') });

      await db.sync_queue.bulkAdd([
        { id: '1', table: 'vitals', payload: { client_id: '1' }, status: 'pending', attempts: 0, created_at: Date.now() },
        { id: '2', table: 'vitals', payload: { client_id: '2' }, status: 'pending', attempts: 0, created_at: Date.now() },
      ]);

      const result = await flushQueue();
      expect(result).toEqual({ synced: 1, failed: 1 });
    });

    it('is idempotent: flushing twice does not create duplicates', async () => {
      await db.sync_queue.add({
        id: '1', table: 'vitals', payload: { client_id: '1' },
        status: 'pending', attempts: 0, created_at: Date.now(),
      });

      await flushQueue();
      const result = await flushQueue();

      // Second flush has nothing pending, so 0 synced
      expect(result).toEqual({ synced: 0, failed: 0 });
      // Supabase upsert only called once (first flush)
      expect(mockUpsert).toHaveBeenCalledTimes(1);
    });
  });

  describe('registerSyncListeners', () => {
    let addWindowSpy: ReturnType<typeof vi.spyOn>;
    let removeWindowSpy: ReturnType<typeof vi.spyOn>;
    let addDocSpy: ReturnType<typeof vi.spyOn>;
    let removeDocSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      addWindowSpy = vi.spyOn(window, 'addEventListener');
      removeWindowSpy = vi.spyOn(window, 'removeEventListener');
      addDocSpy = vi.spyOn(document, 'addEventListener');
      removeDocSpy = vi.spyOn(document, 'removeEventListener');
    });

    afterEach(() => {
      addWindowSpy.mockRestore();
      removeWindowSpy.mockRestore();
      addDocSpy.mockRestore();
      removeDocSpy.mockRestore();
    });

    it('adds "online" event listener to window', () => {
      const cleanup = registerSyncListeners();
      expect(addWindowSpy).toHaveBeenCalledWith('online', expect.any(Function));
      cleanup();
    });

    it('adds "visibilitychange" event listener to document', () => {
      const cleanup = registerSyncListeners();
      expect(addDocSpy).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
      cleanup();
    });

    it('calls flushQueue when online event fires', async () => {
      await db.sync_queue.add({
        id: '1', table: 'vitals', payload: { client_id: '1' },
        status: 'pending', attempts: 0, created_at: Date.now(),
      });

      const cleanup = registerSyncListeners();
      window.dispatchEvent(new Event('online'));

      // Give async flushQueue time to execute
      await new Promise((r) => setTimeout(r, 50));
      expect(mockUpsert).toHaveBeenCalled();
      cleanup();
    });

    it('calls flushQueue when visibilitychange fires with visible + online', async () => {
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });

      await db.sync_queue.add({
        id: '1', table: 'vitals', payload: { client_id: '1' },
        status: 'pending', attempts: 0, created_at: Date.now(),
      });

      const cleanup = registerSyncListeners();
      document.dispatchEvent(new Event('visibilitychange'));

      await new Promise((r) => setTimeout(r, 50));
      expect(mockUpsert).toHaveBeenCalled();
      cleanup();
    });

    it('does NOT call flushQueue when visibilitychange fires with hidden', async () => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });

      await db.sync_queue.add({
        id: '1', table: 'vitals', payload: { client_id: '1' },
        status: 'pending', attempts: 0, created_at: Date.now(),
      });

      const cleanup = registerSyncListeners();
      document.dispatchEvent(new Event('visibilitychange'));

      await new Promise((r) => setTimeout(r, 50));
      expect(mockUpsert).not.toHaveBeenCalled();
      cleanup();
    });

    it('does NOT call flushQueue when visibilitychange fires with visible but offline', async () => {
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });

      await db.sync_queue.add({
        id: '1', table: 'vitals', payload: { client_id: '1' },
        status: 'pending', attempts: 0, created_at: Date.now(),
      });

      const cleanup = registerSyncListeners();
      document.dispatchEvent(new Event('visibilitychange'));

      await new Promise((r) => setTimeout(r, 50));
      expect(mockUpsert).not.toHaveBeenCalled();
      cleanup();
    });

    it('gracefully degrades when SyncManager is unavailable (iOS/Firefox)', () => {
      // jsdom doesn't have SyncManager — this should not throw
      expect(() => {
        const cleanup = registerSyncListeners();
        cleanup();
      }).not.toThrow();
    });
  });
});
