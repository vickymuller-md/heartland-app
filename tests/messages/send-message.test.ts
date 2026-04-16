/**
 * sendMessage Server Action -- Tests
 * Requirements: MSG-01, MSG-02
 * Source: HEARTLAND Protocol v3.3 -- Phase 19 Structured Provider Messages
 *
 * MSG-01: Provider can send structured message to patient
 * MSG-02: Message templates validated via Zod schema (4 template types)
 */

// import { sendMessage } from '@/lib/messages/actions';
// import { sendMessageSchema } from '@/lib/messages/schema';

import { describe, it } from 'vitest';

describe('sendMessage server action (MSG-01)', () => {
  it.todo(
    'inserts a row given valid patientId + templateType + subject + body'
  );

  it.todo(
    'returns { error: "Not authenticated" } when no session'
  );
});

describe('sendMessageSchema validation (MSG-02)', () => {
  it.todo(
    'accepts template type "dose_change"'
  );

  it.todo(
    'accepts template type "appointment"'
  );

  it.todo(
    'accepts template type "lab_order"'
  );

  it.todo(
    'accepts template type "general"'
  );

  it.todo(
    'rejects an invalid template type with a validation error'
  );
});
