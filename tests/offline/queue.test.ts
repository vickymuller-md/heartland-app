/**
 * Offline Queue (Dexie IndexedDB) — Unit Tests
 * Requirements: VITL-09 (offline vitals capture), PWA-03 (offline queue + sync)
 * Source: HEARTLAND Protocol v3.3, Module 5
 */

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import Dexie from 'dexie';

// These imports will fail until implementation exists — that's the RED phase
import { enqueueVitals, enqueueSymptoms, getPendingItems, clearSynced } from '@/lib/offline/queue';
import { db } from '@/lib/offline/db';

describe('Offline Queue (Dexie)', () => {
  beforeEach(async () => {
    // Clear database between tests
    await db.sync_queue.clear();
  });

  describe('enqueueVitals', () => {
    it('writes a record to sync_queue with status "pending"', async () => {
      const vitals = { patient_id: 'p1', weight_lbs: 180, sbp: 120, dbp: 80, heart_rate: 72, spo2: 98, source: 'patient_app' };
      await enqueueVitals(vitals);

      const items = await db.sync_queue.toArray();
      expect(items).toHaveLength(1);
      expect(items[0].status).toBe('pending');
      expect(items[0].table).toBe('vitals');
    });

    it('generates a UUID client_id in the payload', async () => {
      const vitals = { patient_id: 'p1', weight_lbs: 180 };
      const id = await enqueueVitals(vitals);

      const item = await db.sync_queue.get(id);
      expect(item).toBeDefined();
      expect(item!.payload).toHaveProperty('client_id');
      // UUID format: 8-4-4-4-12 hex chars
      expect(item!.payload.client_id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      );
      // client_id should match the returned id
      expect(item!.payload.client_id).toBe(id);
    });

    it('sets attempts to 0 and created_at to current timestamp', async () => {
      const before = Date.now();
      await enqueueVitals({ patient_id: 'p1' });
      const after = Date.now();

      const items = await db.sync_queue.toArray();
      expect(items[0].attempts).toBe(0);
      expect(items[0].created_at).toBeGreaterThanOrEqual(before);
      expect(items[0].created_at).toBeLessThanOrEqual(after);
    });

    it('returns the generated client_id', async () => {
      const id = await enqueueVitals({ patient_id: 'p1' });
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      );
    });
  });

  describe('enqueueSymptoms', () => {
    it('writes a symptoms record to sync_queue with table "symptoms"', async () => {
      const symptoms = { patient_id: 'p1', dyspnea: 1, edema: 0, orthopnea: false, fatigue: 1 };
      const id = await enqueueSymptoms(symptoms);

      const item = await db.sync_queue.get(id);
      expect(item).toBeDefined();
      expect(item!.table).toBe('symptoms');
      expect(item!.status).toBe('pending');
      expect(item!.payload.client_id).toBe(id);
    });
  });

  describe('getPendingItems', () => {
    it('returns items with status "pending" or "failed"', async () => {
      await db.sync_queue.bulkAdd([
        { id: '1', table: 'vitals', payload: {}, status: 'pending', attempts: 0, created_at: Date.now() },
        { id: '2', table: 'vitals', payload: {}, status: 'failed', attempts: 2, created_at: Date.now() },
      ]);

      const items = await getPendingItems();
      expect(items).toHaveLength(2);
    });

    it('excludes items with status "synced"', async () => {
      await db.sync_queue.bulkAdd([
        { id: '1', table: 'vitals', payload: {}, status: 'pending', attempts: 0, created_at: Date.now() },
        { id: '2', table: 'vitals', payload: {}, status: 'synced', attempts: 0, created_at: Date.now(), synced_at: Date.now() },
      ]);

      const items = await getPendingItems();
      expect(items).toHaveLength(1);
      expect(items[0].id).toBe('1');
    });

    it('excludes items with attempts >= 5', async () => {
      await db.sync_queue.bulkAdd([
        { id: '1', table: 'vitals', payload: {}, status: 'failed', attempts: 5, created_at: Date.now() },
        { id: '2', table: 'vitals', payload: {}, status: 'failed', attempts: 3, created_at: Date.now() },
      ]);

      const items = await getPendingItems();
      expect(items).toHaveLength(1);
      expect(items[0].id).toBe('2');
    });
  });

  describe('clearSynced', () => {
    it('removes all items with status "synced"', async () => {
      await db.sync_queue.bulkAdd([
        { id: '1', table: 'vitals', payload: {}, status: 'synced', attempts: 0, created_at: Date.now(), synced_at: Date.now() },
        { id: '2', table: 'vitals', payload: {}, status: 'synced', attempts: 0, created_at: Date.now(), synced_at: Date.now() },
      ]);

      const count = await clearSynced();
      expect(count).toBe(2);
      expect(await db.sync_queue.count()).toBe(0);
    });

    it('does not remove pending or failed items', async () => {
      await db.sync_queue.bulkAdd([
        { id: '1', table: 'vitals', payload: {}, status: 'pending', attempts: 0, created_at: Date.now() },
        { id: '2', table: 'vitals', payload: {}, status: 'failed', attempts: 1, created_at: Date.now() },
        { id: '3', table: 'vitals', payload: {}, status: 'synced', attempts: 0, created_at: Date.now(), synced_at: Date.now() },
      ]);

      await clearSynced();
      const remaining = await db.sync_queue.toArray();
      expect(remaining).toHaveLength(2);
      expect(remaining.map(r => r.id).sort()).toEqual(['1', '2']);
    });
  });
});
