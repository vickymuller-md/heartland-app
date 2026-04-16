/**
 * markMessageRead Server Action -- Tests
 * Requirement: MSG-04
 * Source: HEARTLAND Protocol v3.3 -- Phase 19 Structured Provider Messages
 *
 * MSG-04: Message read-receipt: provider sees when patient viewed the message
 */

// import { markMessageRead } from '@/lib/messages/actions';

import { describe, it } from 'vitest';

describe('markMessageRead server action (MSG-04)', () => {
  it.todo(
    'calls supabase update with the correct message ID and sets read_at'
  );

  it.todo(
    'is idempotent -- no-op if read_at is already set'
  );
});
