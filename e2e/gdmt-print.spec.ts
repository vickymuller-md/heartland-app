import { expect, test } from '@playwright/test';

test('printed GDMT reference retains detailed safety tables without horizontal clipping', async ({ page }, testInfo) => {
  await page.goto('/gdmt-pathway');
  await page.setViewportSize({ width: 672, height: 1000 });
  await page.emulateMedia({ media: 'print' });
  const print = page.locator('.gdmt-print');
  await expect(print).toBeVisible();
  await expect(print).toHaveCSS('color', 'rgb(0, 0, 0)');
  await expect(page.locator('header').first()).not.toBeVisible();
  await expect(page.locator('footer').first()).not.toBeVisible();
  await expect(print).toContainText('exactly 5.0 is permitted');
  await expect(print).toContainText(/strong CYP3A4/i);
  await expect(print).toContainText('not a bundled price');
  await expect(print).toContainText('not a published or clinically approved release');
  await expect(print).toContainText('FINEARTS-HF');
  await expect(print).toContainText('ARTS');

  const clipped = await print.evaluate((root) => {
    const bounds = root.getBoundingClientRect();
    return [...root.querySelectorAll('td, th, p, li')].flatMap((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      return [...range.getClientRects()]
        .filter((rect) => rect.width > 0 && (rect.left < bounds.left - 1 || rect.right > bounds.right + 1))
        .map(() => element.textContent?.slice(0, 100));
    });
  });
  expect(clipped).toEqual([]);
  const path = testInfo.outputPath('gdmt-reference.pdf');
  await page.pdf({ path, format: 'Letter', preferCSSPageSize: true, printBackground: true });
  await testInfo.attach('gdmt-reference', { path, contentType: 'application/pdf' });
});
