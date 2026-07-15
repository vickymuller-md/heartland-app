import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('landing exposes immediate sandbox and separate clinical access', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Heart failure care');
  await expect(page.getByRole('link', { name: /try the sandbox now/i })).toHaveAttribute('href', '/sandbox');
  await expect(page.getByRole('link', { name: /request a clinical workspace/i })).toHaveAttribute('href', '/request-access');
});

test('complete synthetic sandbox opens without an account', async ({ page }) => {
  await page.goto('/sandbox');
  await expect(page).not.toHaveURL(/\/(login|register)/);
  await expect(page.getByTestId('sandbox-command-center')).toBeVisible();
  await expect(page.getByText('1/7 areas explored')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Create account' })).toHaveAttribute('href', '/register?mode=tester');

  await page.getByTestId('sandbox-nav-daily-loop').click();
  await expect(page.getByTestId('sandbox-daily-loop')).toBeVisible();
  await page.getByRole('button', { name: 'Review', exact: true }).first().click();
  await expect(page.getByText('reviewed').first()).toBeVisible();

  for (const section of ['patient-360', 'pathways', 'coordination', 'patient-view', 'impact']) {
    await page.getByTestId(`sandbox-nav-${section}`).click();
    await expect(page.getByTestId(`sandbox-${section}`)).toBeVisible();
  }
  await expect(page.getByText('7/7 areas explored')).toBeVisible();
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
