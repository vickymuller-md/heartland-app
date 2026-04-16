import { describe, it } from 'vitest';

describe('Provider Registration (AUTH-01)', () => {
  it.todo('provider can register with email, password, and Healthcare Professional role');
  it.todo('registration creates profile with role=provider');
  it.todo('registration triggers handle_new_user to create profiles row');
});

describe('Patient Registration (AUTH-02)', () => {
  it.todo('patient can register with email, password, and Patient role');
  it.todo('registration creates profile with role=patient');
});
