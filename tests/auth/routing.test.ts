import { describe, it } from 'vitest';

describe('Role-Based Redirect (AUTH-08)', () => {
  it.todo('provider accessing / is redirected to /dashboard');
  it.todo('patient accessing / is redirected to /today');
  it.todo('unauthenticated user accessing / is redirected to /login');
});

describe('Cross-Role Blocking (AUTH-09)', () => {
  it.todo('patient accessing /dashboard is redirected to /today');
  it.todo('provider accessing /today is redirected to /dashboard');
  it.todo('unauthenticated user accessing /dashboard is redirected to /login');
});

describe('Session Persistence (AUTH-04)', () => {
  it.todo('session cookies are refreshed on each request via proxy');
});
