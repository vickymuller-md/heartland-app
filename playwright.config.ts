import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['line'], ['html', { open: 'never' }]] : 'line',
  use: {
    baseURL: 'http://127.0.0.1:3100',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
    {
      name: 'mobile-chromium',
      use: { ...devices['iPhone 13'], browserName: 'chromium' },
    },
  ],
  webServer: {
    command: 'npm run dev -- --hostname 127.0.0.1 --port 3100',
    url: 'http://127.0.0.1:3100',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      NEXT_PUBLIC_SUPABASE_URL: 'https://example.invalid',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'e2e-anon-placeholder',
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'e2e-publishable-placeholder',
      SUPABASE_SERVICE_ROLE_KEY: '<e2e-service-placeholder>',
      CRON_SECRET: 'e2e-cron-placeholder',
      ACCESS_REQUEST_RATE_LIMIT_SECRET: 'e2e-rate-limit-placeholder',
      // Deterministic in every environment: e2e always exercises the fallback
      // path; no LLM vendor call ever leaves the suite.
      SANDBOX_AI_ENABLED: 'false',
      ANTHROPIC_API_KEY: '',
    },
  },
});
