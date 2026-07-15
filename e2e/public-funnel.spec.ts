import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('landing exposes immediate sandbox and separate clinical access', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Heart failure care');
  await expect(page.getByRole('link', { name: /try the sandbox now/i })).toHaveAttribute('href', '/register?mode=tester');
  await expect(page.getByRole('link', { name: /request a clinical workspace/i })).toHaveAttribute('href', '/request-access');
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

for (const route of ['/', '/register?mode=tester']) {
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
