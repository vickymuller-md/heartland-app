import { describe, it } from 'vitest';

describe('Informed Consent (AUTH-03)', () => {
  it.todo('registration form shows consent dialog before submission');
  it.todo('registration is blocked if consent is not accepted');
});

describe('Consent Persistence (DBSC-06)', () => {
  it.todo('accepting consent writes record to consents table');
  it.todo('consent record includes version, type, and accepted_at');
});
