import { expect, type Page } from '@playwright/test';

export async function openSandboxAreas(page: Page) {
  await expect(page.getByRole('group', { name: 'Interactive sandbox', exact: true })).toHaveAttribute('aria-busy', 'false');
  const open = page.getByRole('button', { name: 'Explore all 9 areas', exact: true });
  if (await open.isVisible()) {
    await open.click();
    await expect(page.getByRole('button', { name: 'Close areas', exact: true })).toHaveAttribute('aria-expanded', 'true');
  }
}

export async function enterSandboxArea(page: Page, section: string) {
  await openSandboxAreas(page);
  await page.getByTestId(`sandbox-nav-${section}`).click();
}
