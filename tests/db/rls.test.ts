import { describe, it } from 'vitest';

describe('RLS Enabled (DBSC-02)', () => {
  it.todo('RLS is enabled on all 9 tables');
  it.todo('each table has at least one policy');
});

describe('Provider Isolation (DBSC-03)', () => {
  it.todo('provider can read vitals of linked patients only');
  it.todo('provider cannot read vitals of unlinked patients');
  it.todo('provider can read symptoms of linked patients only');
  it.todo('provider can read medications of linked patients only');
});

describe('Patient Isolation (DBSC-04)', () => {
  it.todo('patient can read own vitals');
  it.todo('patient cannot read other patient vitals');
  it.todo('patient can write own vitals');
  it.todo('patient can read own symptoms');
  it.todo('patient can write own symptoms');
});
