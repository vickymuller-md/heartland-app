import { enterSandboxArea } from './support/sandbox-navigation';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('landing exposes immediate sandbox and separate clinical access', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Heart failure care');
  await expect(page.getByRole('link', { name: /try the sandbox now/i })).toHaveAttribute('href', '/sandbox');
  await expect(page.getByRole('link', { name: /request evaluation access/i }).first()).toHaveAttribute('href', '/request-access');
  await expect(page.locator('footer').filter({ hasText: 'Heartland · App' })).toContainText(/v\d+\.\d+\.\d+/);
  await expect(page.locator('body')).not.toContainText(/not a medical device|clinical decision support|no PHI is ever collected/i);
  const trend = page.getByRole('img', { name: /^Weight trend from/ });
  const chartLabel = await trend.getAttribute('aria-label');
  await page.getByRole('link', { name: 'Open the fictional patient record' }).click();
  await expect(page.getByRole('region', { name: 'Sandbox area: Patient 360' })).toBeVisible();
  await page.getByRole('tab', { name: 'Monitoring', exact: true }).click();
  await expect(trend).toHaveAttribute('aria-label', chartLabel!);
  expect(pageErrors).toEqual([]);
});

test('complete synthetic sandbox opens without an account', async ({ page }) => {
  await page.goto('/sandbox');
  await expect(page).not.toHaveURL(/\/(login|register)/);
  await expect(page.getByTestId('sandbox-command-center')).toBeVisible();
  await expect(page.getByText('1/9 areas explored')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Create account' })).toHaveAttribute('href', '/register?mode=tester');
  const patient360Cta = page.getByTestId('sandbox-open-patient-360');
  await expect(patient360Cta).toBeVisible();
  await expect(patient360Cta).toBeEnabled();
  await patient360Cta.click();
  await expect(page.getByRole('region', { name: 'Sandbox area: Patient Experience' })).toBeVisible();

  await enterSandboxArea(page, 'daily-loop');
  await expect(page.getByTestId('sandbox-daily-loop')).toBeVisible();
  await page.getByRole('button', { name: 'Review', exact: true }).first().click();
  await expect(page.getByText('reviewed').first()).toBeVisible();

  for (const section of ['copilot', 'outreach', 'patient-360', 'pathways', 'coordination', 'patient-view', 'impact']) {
    await enterSandboxArea(page, section);
    await expect(page.getByTestId(`sandbox-${section}`)).toBeVisible();
  }
  await expect(page.getByText('9/9 areas explored')).toBeVisible();
});

test('public guide states bounded privacy and regulatory claims', async ({ page }) => {
  await page.goto('/guide');
  await expect(page.locator('body')).not.toContainText(/HIPAA-ready|not a medical device|clinical decision support|no PHI is ever collected/i);
  await expect(page.getByText(/does not establish HIPAA readiness or compliance/i)).toBeVisible();
});

test('tester registration is self-service and authenticator-free', async ({ page }) => {
  await page.goto('/register?mode=tester');
  await expect(page.getByRole('heading', { name: 'Create Account' })).toBeVisible();
  await expect(page.getByText('Test the provider sandbox')).toBeVisible();
  await expect(page.getByText(/no approval, no authenticator required/i)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start free sandbox' })).toBeVisible();
  await expect(page.getByRole('radio', { name: /test the provider sandbox/i })).toBeChecked();
});

const publicTools = [
  '/about',
  '/risk-calculator',
  '/gdmt-pathway',
  '/titration-checklist',
  '/remote-monitoring',
  '/tier-selector',
  '/pocket-cards',
  '/guide',
];

for (const route of publicTools) {
  test(`public educational tool remains available without login: ${route}`, async ({ page }) => {
    await page.goto(route);
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const horizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(horizontalOverflow).toBe(false);
  });
}

test('discovery endpoints are public and consistent', async ({ request }) => {
  const robots = await request.get('/robots.txt', { maxRedirects: 0 });
  expect(robots.status()).toBe(200);
  const robotsText = await robots.text();
  expect(robotsText).toContain('Sitemap: https://app.heartlandprotocol.org/sitemap.xml');
  expect(robotsText).toContain('Disallow: /dashboard');
  const sitemap = await request.get('/sitemap.xml', { maxRedirects: 0 });
  expect(sitemap.status()).toBe(200);
  const sitemapText = await sitemap.text();
  for (const route of ['/about', '/sandbox', '/risk-calculator', '/pocket-cards']) expect(sitemapText).toContain(`https://app.heartlandprotocol.org${route}`);
  expect(sitemapText).not.toContain('/dashboard');
  const manifest = await request.get('/manifest.webmanifest', { maxRedirects: 0 });
  expect(manifest.status()).toBe(200);
  expect((await manifest.json()).name).toBe('HEARTLAND Protocol');
});

test('about page states the eight modules, separate identities and disclaimers', async ({ page }) => {
  await page.goto('/about');
  await expect(page).not.toHaveURL(/\/login/);
  await expect(page.getByTestId('about-modules').getByRole('listitem')).toHaveCount(8);
  await expect(page.getByRole('link', { name: /10\.7759\/cureus\.104817/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /zenodo\.24404128/ })).toHaveAttribute('href', 'https://doi.org/10.5281/zenodo.24404128');
  await expect(page.getByText(/did not evaluate the HEARTLAND App/)).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Module 8: Clinician-selected intensive optimization with close monitoring', exact: true })).toBeVisible();
  await expect(page.locator('body')).not.toContainText('Tier 3 methodology');
  await expect(page.getByRole('note', { name: 'Clinical use disclaimer' })).toContainText('has not been validated');
  await expect(page.locator('body')).not.toContainText(/clinical decision support/i);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://app.heartlandprotocol.org/about');
  await expect(page.locator('footer').filter({ hasText: 'Heartland · App' })).toContainText('App software archive');
  await expect(page.locator('footer').getByRole('link', { name: 'Implementation Toolkit · v3.4.1', exact: true })).toHaveAttribute('href', 'https://doi.org/10.5281/zenodo.23076249');
  await expect(page.locator('footer a[href="https://doi.org/10.5281/zenodo.23073640"]')).toHaveCount(0);
  await expect(page.locator('a[href="https://doi.org/10.5281/zenodo.19101219"]')).toHaveCount(0);
});

test('the first risk calculator interaction works when scripts arrive late', async ({ page }) => {
  const scripts = /\/_next\/static\/.*\.js(?:\?|$)/;
  let releaseScripts!: () => void;
  const delay = new Promise<void>(resolve => { releaseScripts = resolve; });
  await page.route(scripts, async route => { await delay; await route.continue(); });

  const sample = page.getByRole('button', { name: 'Load synthetic example' });
  const firstFactor = page.getByRole('radio', { name: 'Present', exact: true }).first();
  try {
    await page.goto('/risk-calculator', { waitUntil: 'commit' });
    await expect(sample).toBeDisabled();
    await expect(firstFactor).toBeDisabled();
  } finally {
    releaseScripts();
  }
  await sample.click();
  await expect(page.getByText('10 of 10 factors reviewed', { exact: true })).toBeVisible();
  await expect(page.getByRole('radio', { checked: true })).toHaveCount(10);
  await expect(page.getByTestId('result-card')).toBeVisible();
});

test('explains the assessed example and keeps the result available during an assistant outage', async ({ page }) => {
  await page.goto('/risk-calculator');
  await expect(page.getByTestId('result-card')).toHaveCount(0);
  await page.getByRole('button', { name: 'Load synthetic example' }).click();
  await page.getByTestId('explain-result-button').click();
  await expect(page.getByRole('button', { name: 'Retry explanation' })).toBeVisible();
  await expect(page.getByTestId('result-card')).toBeVisible();
});

for (const route of ['/', '/register?mode=tester', '/sandbox']) {
  test(`critical accessibility and DOM budget: ${route}`, async ({ page }) => {
    await page.goto(route);
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations.filter((violation) => ['critical', 'serious'].includes(violation.impact ?? ''))).toEqual([]);
    const metrics = await page.evaluate(() => ({
      elements: document.querySelectorAll('*').length,
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    }));
    expect(metrics.elements).toBeLessThan(5_000);
    expect(metrics.horizontalOverflow).toBe(false);
  });
}
