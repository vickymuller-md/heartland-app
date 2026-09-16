import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('landing exposes immediate sandbox and separate clinical access', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Heart failure care');
  await expect(page.getByRole('link', { name: /try the sandbox now/i })).toHaveAttribute('href', '/sandbox');
  await expect(page.getByRole('link', { name: /request evaluation access/i }).first()).toHaveAttribute('href', '/request-access');
  await expect(page.locator('footer').filter({ hasText: 'Heartland · App' })).toContainText(/v\d+\.\d+\.\d+/);
  await expect(page.locator('body')).not.toContainText(/not a medical device|clinical decision support|no PHI is ever collected/i);
});

test('complete synthetic sandbox opens without an account', async ({ page }) => {
  await page.goto('/sandbox');
  await expect(page).not.toHaveURL(/\/(login|register)/);
  await expect(page.getByTestId('sandbox-command-center')).toBeVisible();
  await expect(page.getByText('1/9 areas explored')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Create account' })).toHaveAttribute('href', '/register?mode=tester');
  const patient360Cta = page.getByTestId('sandbox-open-patient-360');
  await expect(patient360Cta).toBeVisible();
  await expect(patient360Cta).toHaveClass(/text-white/);
  await expect(patient360Cta).toHaveClass(/border-white\/25/);

  await page.getByTestId('sandbox-nav-daily-loop').click();
  await expect(page.getByTestId('sandbox-daily-loop')).toBeVisible();
  await page.getByRole('button', { name: 'Review', exact: true }).first().click();
  await expect(page.getByText('reviewed').first()).toBeVisible();

  for (const section of ['copilot', 'outreach', 'patient-360', 'pathways', 'coordination', 'patient-view', 'impact']) {
    await page.getByTestId(`sandbox-nav-${section}`).click();
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
  await expect(page.getByRole('link', { name: /zenodo\.22233054/ })).toBeVisible();
  await expect(page.getByText(/did not evaluate the HEARTLAND App/)).toBeVisible();
  await expect(page.getByRole('note', { name: 'Clinical use disclaimer' })).toContainText('has not been validated');
  await expect(page.locator('body')).not.toContainText(/clinical decision support/i);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://app.heartlandprotocol.org/about');
  await expect(page.locator('footer').filter({ hasText: 'Heartland · App' })).toContainText('App software archive');
});

test('explain-this-result degrades silently when the assistant is disabled', async ({ page }) => {
  await page.goto('/risk-calculator');
  const button = page.getByTestId('explain-result-button');
  await expect(button).toBeVisible();
  await button.click();
  // CI runs without SANDBOX_AI_ENABLED: the assist call falls back and the
  // button removes itself, leaving the deterministic result untouched.
  await expect(page.getByTestId('explain-result')).toHaveCount(0);
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
