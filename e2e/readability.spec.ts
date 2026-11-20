import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('the home and sandbox render the network colors and editorial type', async ({ page }) => {
  // Compare against the published protocol website, independently of local theme overrides.
  const cream = 'rgb(250, 246, 238)';
  const navy = 'rgb(15, 37, 68)';
  const coral = 'rgb(255, 107, 85)';

  await page.goto('/');
  const title = page.getByRole('heading', { level: 1 });
  await expect(page.locator('body')).toHaveCSS('background-color', cream);
  await expect(title).toHaveCSS('color', navy);
  await expect(title).toHaveCSS('font-family', /Sora/i);
  await expect(title).toHaveCSS('font-weight', '400');
  const phrase = title.getByText('where there’s no', { exact: true });
  await expect(phrase).toHaveCSS('font-family', /Instrument.{1,4}Serif/i);
  await expect(phrase).toHaveCSS('font-style', 'italic');
  const action = page.getByRole('link', { name: 'Try the sandbox now' });
  await expect(action).toHaveCSS('background-color', navy);
  await expect(action).toHaveCSS('color', cream);
  await expect(page.locator('header svg').first()).toHaveCSS('color', coral);

  await action.click();
  await expect(page.getByTestId('population-funnel')).toHaveCSS('background-color', navy);
  await expect(page.getByTestId('population-run')).toHaveCSS('background-color', coral);
  await expect(page.getByRole('link', { name: 'Heartland Sandbox' }).locator('svg'))
    .toHaveCSS('color', coral);
});

test('guide text, field boundaries and keyboard focus respect the contrast preference', async ({ page }) => {
  await page.goto('/guide');
  const assistant = page.getByTestId('protocol-assistant');
  const field = assistant.getByRole('textbox');
  const note = assistant.getByText(/^Educational reference only/);
  await expect(note).toBeVisible();
  expect(await note.evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(14);

  const borderContrast = () => field.evaluate(el => {
    const style = getComputedStyle(el);
    const context = document.createElement('canvas').getContext('2d')!;
    function luminance(css: string) {
      context.fillStyle = css;
      context.fillRect(0, 0, 1, 1);
      const [r, g, b] = Array.from(context.getImageData(0, 0, 1, 1).data, byte => {
        const channel = byte / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    }
    const background = luminance(style.backgroundColor);
    const border = luminance(style.borderTopColor);
    return (Math.max(background, border) + 0.05) / (Math.min(background, border) + 0.05);
  });

  const standard = await borderContrast();
  expect(standard).toBeGreaterThanOrEqual(3);
  for (const contrast of ['no-preference', 'more'] as const) {
    await page.emulateMedia({ contrast });
    const report = await new AxeBuilder({ page }).include('[data-testid="protocol-assistant"]')
      .withRules(['color-contrast-enhanced']).analyze();
    expect(report.violations).toEqual([]);
  }
  expect(await borderContrast()).toBeGreaterThan(standard);
  await field.focus();
  await expect(field).toHaveCSS('outline-style', 'solid');
  expect(await field.evaluate(el => parseFloat(getComputedStyle(el).outlineWidth))).toBeGreaterThanOrEqual(2);
});

test('chart readings grow with the browser text size on a narrow screen', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('/');
  const readings = page.getByRole('list', { name: 'Weight measurements' }).getByRole('listitem');
  await expect(readings).toHaveCount(5);
  for (const size of [16, 32]) {
    await page.evaluate(px => { document.documentElement.style.fontSize = `${px}px`; }, size);
    const font = await readings.first().evaluate(el => parseFloat(getComputedStyle(el).fontSize));
    expect(font).toBeGreaterThanOrEqual(size * 0.875);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
    await expect(readings.last()).toContainText('176 lb');
  }
});

test('the selected population stays identifiable with system colors', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active' });
  await page.goto('/sandbox');
  const options = page.getByRole('group', { name: 'Synthetic population size' });
  const original = options.getByRole('button', { name: '2,500' });
  const smaller = options.getByRole('button', { name: '500', exact: true });
  await expect(original).toHaveCSS('text-decoration-line', 'underline');
  await smaller.click();
  await expect(smaller).toHaveAttribute('aria-pressed', 'true');
  await expect(smaller).toHaveCSS('text-decoration-line', 'underline');
  await expect(original).toHaveCSS('text-decoration-line', 'none');
});
