import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test.describe('public operational clarification', () => {
  test.use({ serviceWorkers: 'block' });
  test.beforeEach(async ({ page }) => {
    await page.route('**/*', (route) => new URL(route.request().url()).origin === 'http://127.0.0.1:3100' ? route.continue() : route.abort());
  });

  for (const width of [390, 1440]) {
    test(`readiness and referral contexts remain readable at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/guide#implementation-readiness');
      const readiness = page.locator('#implementation-readiness');
      await expect(readiness.getByRole('heading', { name: 'Local Readiness & Training', exact: true })).toBeVisible();
      await expect(readiness.getByText(/Community, ambulatory or remote pharmacists/)).toBeVisible();
      await expect(readiness.getByRole('listitem')).toHaveCount(4);
      await expect(page.getByRole('heading', { name: 'Urgent or emergency assessment', exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
      const analysis = await new AxeBuilder({ page }).include('#implementation-readiness').analyze();
      expect(analysis.violations).toEqual([]);
      const toggle = readiness.getByRole('button', { name: 'Local Readiness & Training', exact: true });
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await toggle.click();
      await expect(readiness.getByRole('link', { name: /12 synthetic scenarios/ })).toBeVisible();
    });
  }

  test('only the exact sanitized Markdown path is public', async ({ request }) => {
    const response = await request.get('/resources/heartland-local-readiness-training.md');
    expect(response.status()).toBe(200);
    const pack = await response.text();
    expect(pack).toContain('# HEARTLAND local readiness and training pack');
    expect(pack.match(/^\|S\d{2} —/gm)).toHaveLength(12);
    expect(pack).not.toMatch(/\/Users\/|## 12\.|Rodrigo/);
    for (const path of ['/resources/private.md', '/resources/heartland-local-readiness-training.md/private', '/dashboard']) {
      const blocked = await request.get(path, { maxRedirects: 0 });
      expect(blocked.status()).toBe(307);
      expect(blocked.headers().location).toBeTruthy();
      expect(new URL(blocked.headers().location, blocked.url()).pathname).toBe('/login');
    }
  });
});
