import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page, type Route } from '@playwright/test';
import { SANDBOX_PATIENTS, SANDBOX_PATHWAYS, SANDBOX_SECTIONS } from '../lib/sandbox/fixtures';
import { OUTREACH_TRANSCRIPTS, SIMULATED_CALL_SCENARIOS } from '../lib/sandbox-ai/fixtures';
import { applyDeterministicAnswer, createInitialState, emptyExtraction } from '../lib/sandbox-ai/engine';
import { scriptFor } from '../lib/sandbox-ai/call-scripts';
import { callPromptsFor, fillerPromptsFor, QUICK_ANSWERS, quickAnswerLabel } from '../lib/sandbox-ai/call-prompts';
import type { CheckInExtraction, CheckInState, CheckInTurnResponse, ScriptId } from '../lib/sandbox-ai/types';

async function assertAreaReflow(area: import('@playwright/test').Locator, width: number) {
  expect.soft(await area.evaluate(() => document.documentElement.scrollWidth), 'page must not depend on inner scrolling').toBeLessThanOrEqual(width + 1);
  const measurements = await area.evaluate((root) => {
    const tableRegion = root.querySelector('[role="region"][aria-label="Synthetic vital history, horizontally scrollable"]');
    return Array.from(root.querySelectorAll('section, div, p, h2, h3, li, button, a, [role="tab"]'))
      .filter((element) => element.getClientRects().length && getComputedStyle(element).display !== 'inline' && !tableRegion?.contains(element))
      .map((element) => ({
        text: element.textContent?.slice(0, 100), tag: element.tagName,
        left: element.getBoundingClientRect().left, right: element.getBoundingClientRect().right,
        scroll: element.scrollWidth, client: element.clientWidth,
        height: element.getBoundingClientRect().height,
        // Explicit local exception: conversation transcripts are bounded-height
        // scroll regions with keyboard access, asserted separately.
        clippedY: element.getAttribute('role') !== 'log' && element.scrollHeight > element.clientHeight + 1 && getComputedStyle(element).overflowY !== 'visible',
        control: element.matches('button, a, [role="tab"]'),
      }));
  });
  expect.soft(measurements.filter((box) => box.left < -1 || box.right > width + 1 || box.scroll > box.client + 1 || box.clippedY), 'inner content must reflow without clipping').toEqual([]);
  expect.soft(measurements.filter((box) => box.control && (box.height < 44 || box.right - box.left < 44)), 'authored controls must have a 44px target in both dimensions').toEqual([]);
  // Editable values may scroll inside their native control; measure the outer
  // box without misclassifying ordinary textarea/input scrolling as clipping.
  const inputs = await area.locator('input, textarea, select, audio').evaluateAll((elements) => elements
    .filter((element) => element.getClientRects().length && element.getBoundingClientRect().height > 0)
    .map((element) => ({ tag: element.tagName, box: element.getBoundingClientRect().toJSON() })));
  expect.soft(inputs.filter(({ box }) => box.left < -1 || box.right > width + 1 || box.width < 44 || box.height < 44), 'native control outer geometry').toEqual([]);
}

const syntheticBrief = 'This synthetic queue contains an item requiring human review. Verify the registered-rule findings and source information before documenting an outcome. '.repeat(3);
const syntheticExplanation = 'The reported weight change exceeded this registered rule’s threshold. This explanation does not change the rule or its result. '.repeat(3);

// The e2e server has SANDBOX_AI_ENABLED=false. Tests exercise deterministic
// fallback paths and explicitly intercepted synthetic success responses;
// neither path calls a model vendor or validates real model extraction.

test.describe('sandbox navigation shell', () => {
  test.use({ serviceWorkers: 'block' });

  test.beforeEach(async ({ page }) => {
    // Install isolation BEFORE navigation, including the Daily Loop auto-brief.
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== 'http://127.0.0.1:3100') return route.abort();
      if (url.pathname.startsWith('/api/sandbox-ai/')) return route.fulfill({ json: { fallback: true } });
      // Local telemetry actions may run; the isolated server's database is
      // example.invalid, never a hosted project. Aborting them breaks Flight.
      return route.continue();
    });
    await page.emulateMedia({ reducedMotion: 'reduce' });
  });

  for (const width of [320, 390, 768, 1024, 1440]) {
    for (const fontSize of [16, 32]) {
      test(`fits navigation at ${width}px with ${fontSize}px root text`, async ({ page }, testInfo) => {
        await page.setViewportSize({ width, height: 900 });
        await page.goto('/sandbox');
        await page.evaluate((size) => { document.documentElement.style.fontSize = `${size}px`; }, fontSize);
        const navigation = page.getByRole('navigation', { name: 'Sandbox product navigation' });
        const tour = page.getByRole('navigation', { name: 'Guided sandbox tour' });
        const contentWidths: Array<{ area: string; documentWidth: number }> = [];
        await expect(navigation).toBeVisible();
        const assertFits = async (locator: import('@playwright/test').Locator) => {
          const geometry = await locator.evaluate((element) => {
            const box = element.getBoundingClientRect();
            return { left: box.left, right: box.right, scroll: element.scrollWidth, client: element.clientWidth };
          });
          expect(geometry.left).toBeGreaterThanOrEqual(-1);
          expect(geometry.right).toBeLessThanOrEqual(width + 1);
          expect(geometry.scroll).toBeLessThanOrEqual(geometry.client + 1);
        };
        await assertFits(page.getByRole('banner'));
        await assertFits(navigation);
        expect(await navigation.evaluate((element) => getComputedStyle(element).position)).toBe('static');
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
        await testInfo.attach('navigation-initial', { body: await page.screenshot(), contentType: 'image/png' });

        for (const section of SANDBOX_SECTIONS) {
          const button = page.getByTestId(`sandbox-nav-${section.id}`);
          await expect(button).toHaveAccessibleName(section.shortLabel);
          await assertFits(button);
          expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
          await button.click();
          await expect(button).toHaveAttribute('aria-current', 'page');
          const content = page.getByRole('region', { name: `Sandbox area: ${section.title}`, exact: true });
          await expect(content).toBeFocused();
          // Focus must be visible, not stranded below the multi-row navigation.
          await expect.poll(async () => (await content.boundingBox())!.y).toBeGreaterThanOrEqual(-1);
          await expect.poll(async () => (await content.boundingBox())!.y).toBeLessThan(100);
          contentWidths.push({ area: section.id, documentWidth: await page.evaluate(() => document.documentElement.scrollWidth) });
          expect.soft(contentWidths.at(-1)!.documentWidth, `${section.id} document width`).toBeLessThanOrEqual(width + 1);
          if (!['command', 'impact'].includes(section.id)) await assertAreaReflow(content, width);
          if ([320, 1440].includes(width)) await testInfo.attach(`area-${section.id}`, { body: await page.screenshot(), contentType: 'image/png' });
          await assertFits(navigation);
          await assertFits(tour);
          for (const control of await tour.getByRole('button').all()) {
            await assertFits(control);
            expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
          }
        }
        // Keep raw widths alongside the assertions for all nine base areas.
        await testInfo.attach('inner-area-widths', { body: JSON.stringify({ viewport: width, fontSize, contentWidths }), contentType: 'application/json' });
        const impact = page.getByTestId('sandbox-impact');
        await assertFits(impact);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
        const contentOverflow = await impact.locator('section, div, p, h2, li, a, button').evaluateAll((elements) =>
          elements.filter((element) => element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1)
            .map((element) => ({
              text: element.textContent, tag: element.tagName,
              scrollWidth: element.scrollWidth, clientWidth: element.clientWidth,
              scrollHeight: element.scrollHeight, clientHeight: element.clientHeight,
              overflowY: getComputedStyle(element).overflowY,
            })),
        );
        // Glyph ink can extend beyond a heading's line box without clipping.
        // Reject all horizontal overflow and any vertical overflow that is not
        // painted visibly; retain raw measurements for visual review.
        await testInfo.attach('impact-overflow-check', { body: JSON.stringify(contentOverflow), contentType: 'application/json' });
        expect(contentOverflow.filter((element) => element.scrollWidth > element.clientWidth + 1 || element.overflowY !== 'visible')).toEqual([]);
        const preview = impact.getByRole('button', { name: 'Synthetic report preview only' });
        await expect(preview).toBeDisabled();
        await expect(impact.getByRole('link', { name: 'Request clinical workspace' })).toHaveAttribute('href', '/request-access');
        await expect(impact.getByRole('link', { name: 'Read implementation guide' })).toHaveAttribute('href', '/guide');
        for (const control of await impact.getByRole('button').or(impact.getByRole('link')).all()) {
          await assertFits(control);
          expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        }
        await testInfo.attach('impact-heading', { body: await page.screenshot(), contentType: 'image/png' });
        await impact.getByText('Areas explored', { exact: true }).scrollIntoViewIfNeeded();
        await testInfo.attach('impact-metrics', { body: await page.screenshot(), contentType: 'image/png' });
        await impact.getByRole('link', { name: 'Read implementation guide' }).scrollIntoViewIfNeeded();
        await testInfo.attach('impact-actions', { body: await page.screenshot(), contentType: 'image/png' });
        const returnButton = tour.getByRole('button', { name: 'Return to Command Center' });
        await returnButton.scrollIntoViewIfNeeded();
        await testInfo.attach('return-viewport', {
          body: JSON.stringify(await returnButton.evaluate((element) => ({
            layoutWidth: innerWidth, layoutHeight: innerHeight, scrollX, scrollY,
            visualWidth: visualViewport?.width, visualHeight: visualViewport?.height,
            visualOffsetTop: visualViewport?.offsetTop, visualOffsetLeft: visualViewport?.offsetLeft,
            target: element.getBoundingClientRect().toJSON(),
          }))), contentType: 'application/json',
        });
        // Preserve the original actionable pointer regression check.
        await returnButton.click();
        await expect(page.getByRole('region', { name: 'Sandbox area: Command Center', exact: true })).toBeFocused();
        await tour.evaluate((element) => element.scrollIntoView({ block: 'start', behavior: 'instant' }));
        await testInfo.attach('navigation-tour', { body: await page.screenshot(), contentType: 'image/png' });
        await page.getByTestId('sandbox-nav-impact').click();
        await impact.getByRole('button', { name: 'Reset sandbox', exact: true }).click();
        await expect(page.getByRole('region', { name: 'Sandbox area: Command Center', exact: true })).toBeFocused();
        await expect(page.getByTestId('sandbox-nav-command')).toHaveAttribute('aria-current', 'page');
      });
    }
  }

  for (const [width, fontSize] of [[320, 32], [390, 32], [1024, 32], [320, 16], [1440, 16]]) {
    test.describe(`inner states ${width}px text ${fontSize}px`, () => {
      test.beforeEach(async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.goto('/sandbox');
        await page.evaluate((size) => { document.documentElement.style.fontSize = `${size}px`; }, fontSize);
      });

      test('patient sources, tabs, chart labels and local table scrolling', async ({ page }, testInfo) => {
        await page.getByTestId('sandbox-nav-patient-360').click();
        const area = page.getByTestId('sandbox-patient-360');
        const chooser = area.getByRole('region', { name: 'Choose a synthetic patient' });
        for (const patient of SANDBOX_PATIENTS) {
          await chooser.getByRole('button', { name: new RegExp(patient.name) }).click();
          await area.getByRole('tab', { name: 'Monitoring', exact: true }).click();
          const table = area.getByRole('table', { name: 'Synthetic vital history' });
          await expect(table.getByRole('row')).toHaveCount(patient.vitals.length + 1);
          await expect(table.getByRole('columnheader')).toHaveText(['When', 'Weight', 'SBP', 'Heart rate', 'SpO₂']);
          const chart = area.getByRole('img', { name: /^Weight trend from/ });
          const alignment = await chart.evaluate((element) => {
            const svg = element as SVGSVGElement;
            const labels = Array.from(svg.nextElementSibling!.children);
            return Array.from(svg.querySelectorAll('circle')).map((circle, index) => {
              const point = svg.createSVGPoint();
              point.x = circle.cx.baseVal.value; point.y = circle.cy.baseVal.value;
              const screen = point.matrixTransform(circle.getScreenCTM()!);
              const box = labels[index].getBoundingClientRect();
              return { label: labels[index].textContent, title: circle.querySelector('title')!.textContent, delta: Math.abs(screen.x - (box.left + box.width / 2)) };
            });
          });
          expect(alignment.map((item) => item.label)).toEqual(patient.vitals.map((point) => point.label));
          expect(alignment.map((item) => item.title)).toEqual(patient.vitals.map((point) => `${point.label}: ${point.weight} lb`));
          for (const point of alignment) expect(point.delta).toBeLessThanOrEqual(1);
          await testInfo.attach(`chart-${patient.id}`, { body: await chart.locator('..').screenshot(), contentType: 'image/png' });
          const scroll = area.getByRole('region', { name: 'Synthetic vital history, horizontally scrollable' });
          await scroll.focus();
          await expect(scroll).toBeFocused();
          if (await scroll.evaluate((element) => element.scrollWidth > element.clientWidth + 1)) {
            await page.keyboard.press('ArrowRight');
            await expect.poll(() => scroll.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
          }
          await assertAreaReflow(area, width);
          const monitoring = area.getByRole('tab', { name: 'Monitoring', exact: true });
          await monitoring.focus();
          await page.keyboard.press('ArrowRight');
          await expect(area.getByRole('tab', { name: 'Medications & labs' })).toBeFocused();
          await page.keyboard.press('Enter');
          for (const tab of ['Medications & labs', 'Timeline', 'Plan & access']) {
            await area.getByRole('tab', { name: tab, exact: true }).click();
            await expect(area.getByRole('tabpanel', { name: tab, exact: true })).toBeVisible();
            await assertAreaReflow(area, width);
          }
          for (const action of ['Document contact', 'Schedule follow-up', 'Route to team', 'Generate SBAR']) {
            await area.getByRole('button', { name: action, exact: true }).click();
            await expect(area).toContainText('Latest simulated action:');
            await assertAreaReflow(area, width);
          }
        }
      });

      test('outreach transcript and provider-controlled SBAR proposal states', async ({ page }, testInfo) => {
        let pending: Route | undefined;
        let unavailable = false;
        await page.route('**/api/sandbox-ai/assist', async (route) => {
          if (route.request().postDataJSON().kind !== 'sbar_polish') return route.fulfill({ json: { fallback: true } });
          if (unavailable) return route.fulfill({ json: { fallback: true } });
          pending = route;
        });
        await page.getByTestId('sandbox-nav-outreach').click();
        const area = page.getByTestId('sandbox-outreach');
        const card = page.getByTestId('outreach-call-call-maria-redflag');
        const audio = page.getByTestId('outreach-audio-call-maria-redflag').locator('audio');
        await expect(audio).toHaveAttribute('controls', '');
        await expect(audio).toHaveAttribute('preload', 'none');
        await expect(audio).toHaveAttribute('src', OUTREACH_TRANSCRIPTS.find((item) => item.id === 'call-maria-redflag')!.audioSrc!);
        await audio.focus();
        await expect(audio).toBeFocused();
        await testInfo.attach('native-player', { body: await audio.locator('..').screenshot(), contentType: 'image/png' });
        await card.getByRole('button', { name: 'View transcript', exact: true }).click();
        await expect(card).toContainText('Structured data captured by the AI layer');
        await assertAreaReflow(area, width);
        await card.getByRole('button', { name: 'Draft SBAR handoff' }).click();
        const draft = card.getByTestId('sandbox-sbar-draft');
        const originalSituation = await draft.getByRole('textbox', { name: 'Situation', exact: true }).inputValue();
        const originalBackground = await draft.getByRole('textbox', { name: 'Background', exact: true }).inputValue();
        await draft.getByRole('textbox', { name: 'Assessment', exact: true }).fill('Synthetic provider assessment remains local.');
        await draft.getByRole('textbox', { name: 'Recommendation', exact: true }).fill('Synthetic provider recommendation remains local.');
        const proposal = { kind: 'sbar_polish', situation: syntheticBrief, background: syntheticBrief, assessment: 'Must not replace provider field.', recommendation: 'Must not replace provider field.' };
        for (const decision of ['Accept proposal', 'Reject proposal']) {
          pending = undefined;
          await draft.getByTestId('sbar-polish').click();
          await expect.poll(() => Boolean(pending)).toBe(true);
          await expect(draft.getByTestId('sbar-polish')).toBeDisabled();
          await expect(draft.getByRole('textbox', { name: 'Situation', exact: true })).toBeDisabled();
          await expect(draft.getByRole('textbox', { name: 'Assessment', exact: true })).toBeEnabled();
          await assertAreaReflow(area, width);
          const payload = pending!.request().postDataJSON();
          expect(JSON.stringify(payload)).not.toContain('Synthetic provider assessment remains local.');
          expect(JSON.stringify(payload)).not.toContain('Synthetic provider recommendation remains local.');
          await pending!.fulfill({ json: proposal });
          await expect(draft.getByTestId('sbar-polish-proposal')).toBeVisible();
          await expect(draft.getByRole('textbox', { name: 'Situation', exact: true })).toHaveValue(originalSituation);
          await assertAreaReflow(area, width);
          await draft.getByRole('button', { name: decision }).scrollIntoViewIfNeeded();
          await testInfo.attach(`sbar-${decision}`, { body: await page.screenshot(), contentType: 'image/png' });
          if (decision === 'Reject proposal') {
            await draft.getByRole('button', { name: decision }).focus();
            await page.keyboard.press('Enter');
          } else await draft.getByRole('button', { name: decision }).click();
          if (decision === 'Accept proposal') {
            await expect(draft.getByRole('textbox', { name: 'Situation', exact: true })).toHaveValue(proposal.situation);
            await assertAreaReflow(area, width);
            await draft.getByRole('button', { name: 'Undo accepted wording' }).click();
          }
          await expect(draft.getByRole('textbox', { name: 'Situation', exact: true })).toHaveValue(originalSituation);
          await expect(draft.getByRole('textbox', { name: 'Background', exact: true })).toHaveValue(originalBackground);
          await assertAreaReflow(area, width);
        }
        unavailable = true;
        await draft.getByTestId('sbar-polish').click();
        await expect(draft).toContainText('Polishing is unavailable right now');
        await expect(draft.getByRole('textbox', { name: 'Assessment', exact: true })).toHaveValue('Synthetic provider assessment remains local.');
        await assertAreaReflow(area, width);
        await area.getByTestId('run-simulated-call').click();
        await expect(area.getByTestId('simulate-unavailable')).toBeVisible();
        await assertAreaReflow(area, width);
      });

      test('copilot pending, cancelled, completed and unavailable states', async ({ page }, testInfo) => {
        let callMode: 'hold' | 'success' | 'unavailable' = 'hold';
        let heldCall: Route | undefined;
        let heldBrief: Route | undefined;
        let heldChat: Route | undefined;
        let explainUnavailable = false;
        let briefUnavailable = false;
        let sequence = 0;
        await page.route('**/api/sandbox-ai/simulate-call', async (route) => {
          if (callMode === 'hold') { heldCall = route; return; }
          if (callMode === 'unavailable') return route.fulfill({ json: { fallback: true } });
          const scenario = SIMULATED_CALL_SCENARIOS.find((item) => item.id === route.request().postDataJSON().scenarioId)!;
          const fixtureId = scenario.id === 'scenario-weight-gain' ? 'call-maria-redflag' : scenario.id === 'scenario-adherence-barrier' ? 'call-james-adherence' : 'call-james-stable';
          const fixture = OUTREACH_TRANSCRIPTS.find((item) => item.id === fixtureId)!;
          expect(fixture).toBeDefined();
          // Client presentation fixture, not a fresh run of the clinical engine.
          await route.fulfill({ json: { transcript: { ...fixture, id: `ai-run-e2e${++sequence}`, patientId: null, patientName: scenario.patientName, audioSrc: undefined } } });
        });
        await page.route('**/api/sandbox-ai/assist', async (route) => {
          if (route.request().postDataJSON().kind === 'explain_rule') return route.fulfill({ json: explainUnavailable ? { fallback: true } : { kind: 'explain_rule', explanation: syntheticExplanation } });
          if (briefUnavailable) return route.fulfill({ json: { fallback: true } });
          heldBrief = route;
        });
        await page.route('**/api/sandbox-ai/copilot', async (route) => { heldChat = route; });
        // Mock playback itself: no sound or codec validation. This exercises
        // only the blocked-playback affordance and its explicit resume action.
        await page.evaluate(() => {
          let attempts = 0;
          const sources = new WeakMap<HTMLMediaElement, string>();
          Object.defineProperty(HTMLMediaElement.prototype, 'src', { configurable: true, get() { return sources.get(this) ?? ''; }, set(value: string) { sources.set(this, value); } });
          HTMLMediaElement.prototype.play = () => ++attempts === 1 ? Promise.reject(new DOMException('Mock user gesture required', 'NotAllowedError')) : Promise.resolve();
          HTMLMediaElement.prototype.pause = () => {};
        });
        await page.getByTestId('sandbox-nav-copilot').click();
        const area = page.getByTestId('sandbox-copilot');
        expect(heldCall).toBeUndefined();
        await area.getByTestId('run-morning-round').click();
        await expect.poll(() => Boolean(heldCall)).toBe(true);
        await expect(area.getByTestId('advance-day')).toBeDisabled();
        await assertAreaReflow(area, width);
        await area.getByTestId('cancel-morning-round').click();
        await expect(area.getByTestId('run-morning-round')).toBeVisible();
        await heldCall!.abort();
        callMode = 'success';
        await area.getByTestId('run-morning-round').click();
        await expect.poll(() => Boolean(heldBrief)).toBe(true);
        await expect(area.getByTestId('brief-generating')).toBeVisible();
        await expect(area.getByTestId('advance-day')).toBeDisabled();
        await assertAreaReflow(area, width);
        await heldBrief!.fulfill({ json: { kind: 'morning_brief', brief: syntheticBrief, mp3Base64: 'c3ludGhldGljLWF1ZGlvLW1vY2s=' } });
        await expect(area.getByTestId('copilot-brief')).toContainText(syntheticBrief.trim());
        await expect(area.getByTestId('advance-day')).toBeEnabled();
        await expect(area.getByRole('button', { name: 'Play the spoken brief' })).toBeVisible();
        await assertAreaReflow(area, width);
        await area.getByRole('button', { name: 'Play the spoken brief' }).click();
        await expect(area.getByRole('button', { name: 'Play the spoken brief' })).toHaveCount(0);
        const explain = area.locator('button[data-testid^="explain-rule-button-"]').first();
        await explain.click();
        await expect(area.getByText(syntheticExplanation.trim(), { exact: false }).first()).toBeVisible();
        await assertAreaReflow(area, width);
        explainUnavailable = true;
        await area.locator('button[data-testid^="explain-rule-button-"]').first().click();
        await expect(area.getByText('Explanation unavailable right now.')).toBeVisible();
        await assertAreaReflow(area, width);
        await area.getByTestId('copilot-prepared').scrollIntoViewIfNeeded();
        await testInfo.attach('copilot-prepared', { body: await page.screenshot(), contentType: 'image/png' });
        for (const unavailable of [false, true]) {
          heldChat = undefined;
          await area.getByLabel('Ask about the synthetic queue').fill('Which synthetic sources need review?');
          await area.getByRole('button', { name: 'Ask the copilot', exact: true }).click();
          await expect.poll(() => Boolean(heldChat)).toBe(true);
          await expect(area.getByLabel('Ask about the synthetic queue')).toBeDisabled();
          await assertAreaReflow(area, width);
          await heldChat!.fulfill({ json: unavailable ? { fallback: true } : { answer: syntheticBrief, toolTrace: [{ tool: 'get_queue', summary: 'Synthetic source information returned for human review.' }] } });
          await expect(area.getByTestId(unavailable ? 'copilot-chat-unavailable' : 'copilot-answer')).toBeVisible();
          await assertAreaReflow(area, width);
        }
        briefUnavailable = true;
        await area.getByTestId('run-morning-round').click();
        await expect(area).toContainText('optional AI-drafted brief was unavailable');
        await assertAreaReflow(area, width);
        callMode = 'unavailable';
        await area.getByTestId('run-morning-round').click();
        await expect(area.getByTestId('round-unavailable')).toBeVisible();
        await assertAreaReflow(area, width);
      });

      test('pathways, coordination and patient portal local interactions', async ({ page }, testInfo) => {
        await page.getByTestId('sandbox-nav-pathways').click();
        const pathways = page.getByTestId('sandbox-pathways');
        expect(await pathways.getByRole('link', { name: 'Open interactive tool' }).evaluateAll((links) => links.map((link) => link.getAttribute('href')))).toEqual(SANDBOX_PATHWAYS.map((pathway) => pathway.href));
        for (const pathway of SANDBOX_PATHWAYS) {
          const article = pathways.getByRole('article').filter({ has: page.getByRole('heading', { name: pathway.title, exact: true }) });
          await article.getByRole('button', { name: 'Mark explored', exact: true }).click();
          await article.getByRole('button', { name: 'Explored', exact: true }).click();
        }
        await expect(pathways.getByRole('button', { name: 'Explored', exact: true })).toHaveCount(6);
        await assertAreaReflow(pathways, width);
        await page.getByTestId('sandbox-nav-coordination').click();
        const coordination = page.getByTestId('sandbox-coordination');
        for (const button of await coordination.getByRole('button', { name: /^Assign to/ }).all()) {
          if (await button.isEnabled()) await button.click();
          await expect(button).toBeDisabled();
          await assertAreaReflow(coordination, width);
        }
        await coordination.getByRole('button', { name: 'Confirm next milestone' }).click();
        await coordination.getByRole('button', { name: 'Generate synthetic handoff' }).click();
        await assertAreaReflow(coordination, width);
        await page.getByTestId('sandbox-nav-patient-view').click();
        const portal = page.getByTestId('sandbox-patient-view');
        for (const name of ['Record today’s weight', 'Confirm medications', 'Review next education item']) {
          const button = portal.getByRole('button', { name: new RegExp(name) });
          await button.click(); await button.click();
          await assertAreaReflow(portal, width);
        }
        await portal.getByRole('button', { name: 'Message care team' }).click();
        await portal.getByRole('button', { name: 'View contact plan' }).click();
        await expect(portal.getByText('3/4', { exact: true })).toBeVisible();
        await assertAreaReflow(portal, width);
        await portal.getByRole('region', { name: 'Synthetic mobile patient portal' }).scrollIntoViewIfNeeded();
        await testInfo.attach('portal-progress', { body: await page.screenshot(), contentType: 'image/png' });
        // These are mount/exclusivity checks, not reflow certification of the
        // two conversation components reserved for a later visual lot.
        await portal.getByTestId('open-live-call').click();
        await expect(portal.getByTestId('sandbox-live-call')).toHaveCount(1);
        await portal.getByTestId('open-titration-call').click();
        await expect(portal.getByTestId('sandbox-live-call')).toHaveCount(1);
        await portal.getByRole('button', { name: /Complete symptom check-in/ }).click();
        await expect(portal.getByTestId('sandbox-ai-checkin')).toHaveCount(1);
        await expect(portal.getByTestId('sandbox-live-call')).toHaveCount(0);
        await expect(portal.getByText('3/4', { exact: true })).toBeVisible();
      });

      test('queue filters, closure outcomes and optional brief states', async ({ page }, testInfo) => {
        let pending: Route | undefined;
        let unavailable = false;
        await page.route('**/api/sandbox-ai/assist', async (route) => {
          if (unavailable) return route.fulfill({ json: { fallback: true } });
          pending = route;
        });
        await page.getByTestId('sandbox-nav-daily-loop').click();
        const area = page.getByTestId('sandbox-daily-loop');
        await expect.poll(() => Boolean(pending)).toBe(true);
        await expect(area.getByTestId('draft-morning-brief')).toBeDisabled();
        await assertAreaReflow(area, width);
        await pending!.fulfill({ json: { kind: 'morning_brief', brief: syntheticBrief } });
        await expect(area.getByTestId('morning-brief')).toContainText(syntheticBrief.trim());
        await assertAreaReflow(area, width);
        for (const [name, count] of [['All work', 8], ['Now', 2], ['Today', 3], ['This week', 2], ['Watching', 1]] as const) {
          const filter = area.getByRole('button', { name, exact: true });
          await filter.click();
          await expect(filter).toHaveAttribute('aria-pressed', 'true');
          await expect(area.getByRole('article')).toHaveCount(count);
          await assertAreaReflow(area, width);
        }
        await area.getByRole('button', { name: 'All work', exact: true }).click();
        await area.getByRole('button', { name: 'Now', exact: true }).click();
        await area.getByRole('button', { name: 'Review visible (2)', exact: true }).click();
        await expect(area.getByRole('article').getByText('reviewed', { exact: true })).toHaveCount(2);
        await assertAreaReflow(area, width);
        await area.getByRole('button', { name: 'All work', exact: true }).click();
        const outcomes = ['Patient contacted; follow-up scheduled', 'Source verified; no escalation required', 'Routed to clinical owner for independent review'];
        for (const [index, outcome] of outcomes.entries()) {
          const article = area.getByRole('article').nth(index);
          // Bulk review already transitioned the Now items; other items still
          // require their individual review before continuing the same flow.
          const review = article.getByRole('button', { name: 'Review', exact: true });
          if (await review.isVisible()) await review.click();
          else await expect(article.getByText('reviewed', { exact: true })).toBeVisible();
          for (const name of ['Action taken', 'Awaiting data/patient', 'Close with outcome']) await article.getByRole('button', { name, exact: true }).click();
          await assertAreaReflow(area, width);
          await article.getByRole('button', { name: outcome, exact: true }).click();
          await expect(article).toContainText(`Outcome: ${outcome}`);
          await assertAreaReflow(area, width);
        }
        await area.getByRole('article').nth(2).scrollIntoViewIfNeeded();
        await testInfo.attach('closed-work', { body: await page.screenshot(), contentType: 'image/png' });
        unavailable = true;
        await area.getByTestId('draft-morning-brief').click();
        await expect(area.getByTestId('morning-brief-unavailable')).toBeVisible();
        await assertAreaReflow(area, width);
      });

      test('conversation surfaces reflow, stay keyboard-reachable and manage focus', async ({ page }) => {
        await page.route('**/outreach-audio/**', (route) => route.abort());
        await page.getByTestId('sandbox-nav-patient-view').click();
        const view = page.getByTestId('sandbox-patient-view');
        // Bounded-height transcripts must stay readable from the keyboard.
        const assertLogKeyboard = async (log: Locator) => {
          await log.focus();
          await expect(log).toBeFocused();
          if (await log.evaluate((element) => element.scrollHeight > element.clientHeight + 1)) {
            const before = await log.evaluate((element) => element.scrollTop);
            await page.keyboard.press('ArrowUp');
            await expect.poll(() => log.evaluate((element) => element.scrollTop)).toBeLessThan(before);
          }
        };

        const checkInOpener = view.getByRole('button', { name: /Complete symptom check-in/ });
        await checkInOpener.click();
        const checkIn = page.getByTestId('sandbox-ai-checkin');
        await expect(checkIn).toBeFocused();
        await assertAreaReflow(checkIn, width);
        await page.getByTestId('checkin-locale-es').click();
        await expect(checkIn).toContainText('dolor de pecho');
        await assertAreaReflow(checkIn, width);
        await page.getByTestId('checkin-locale-en').click();
        await page.getByLabel('Type your check-in answer').fill('no chest pain today');
        await page.getByRole('button', { name: 'Send answer' }).click();
        await expect(page.getByTestId('sandbox-ai-form')).toBeVisible();
        await assertAreaReflow(checkIn, width);
        await assertLogKeyboard(checkIn.getByRole('log'));
        await fillRequiredFallbackAnswers(page);
        await page.getByLabel(/Weight this morning/).fill('179.5');
        await page.getByRole('button', { name: 'Submit check-in' }).click();
        await expect(page.getByTestId('sandbox-ai-result')).toBeVisible();
        await assertAreaReflow(checkIn, width);
        await checkIn.getByTestId('explain-rule-button-weight_gain_3lb_2d').click();
        await expect(checkIn).toContainText('Explanation unavailable right now.');
        await assertAreaReflow(checkIn, width);
        await page.getByRole('button', { name: 'Close check-in' }).click();
        await expect(checkIn).toHaveCount(0);
        await expect(checkInOpener).toBeFocused();

        const call = page.getByTestId('sandbox-live-call');
        const chips = page.getByTestId('live-call-chips');
        const numbers = page.getByTestId('live-call-numbers');
        await page.getByTestId('open-live-call').click();
        await expect(call).toBeFocused();
        await assertAreaReflow(call, width);
        await page.getByTestId('call-locale-es').click();
        await expect(page.getByTestId('call-locale-es')).toHaveAttribute('aria-pressed', 'true');
        await assertAreaReflow(call, width);
        await page.getByTestId('answer-call').click();
        await expect(chips).toBeVisible();
        await expect(call.getByRole('log')).toContainText('dolor de pecho');
        await assertAreaReflow(call, width);
        await page.getByRole('button', { name: 'End simulated call' }).click();
        await expect(call).toHaveCount(0);
        await expect(page.getByTestId('open-live-call')).toBeFocused();

        await page.getByTestId('open-live-call').click();
        await expect(call).toBeFocused();
        await page.getByTestId('answer-call').click();
        await expect(chips).toBeVisible();
        await assertAreaReflow(call, width);
        await chips.getByRole('button', { name: 'No, nothing like that' }).click();
        await expect(numbers).toBeVisible();
        await assertAreaReflow(call, width);
        await numbers.getByLabel(/Weight/).fill('179.5');
        await numbers.getByRole('button', { name: 'Send', exact: true }).click();
        for (const name of ['Breathing fine', 'No new swelling', 'No, slept normally', 'Normal energy', 'Yes, all taken']) await chips.getByRole('button', { name, exact: true }).click();
        await numbers.getByRole('button', { name: 'Send / skip' }).click();
        await expect(page.getByTestId('live-call-result')).toBeVisible();
        await assertAreaReflow(call, width);
        await assertLogKeyboard(call.getByRole('log'));
        await call.getByTestId('explain-rule-button-weight_gain_3lb_2d').click();
        await expect(call).toContainText('Explanation unavailable right now.');
        await assertAreaReflow(call, width);
        await page.getByRole('button', { name: 'End simulated call' }).click();
        await expect(call).toHaveCount(0);
        await expect(page.getByTestId('open-live-call')).toBeFocused();

        await page.getByTestId('open-titration-call').click();
        await expect(call).toBeFocused();
        await page.getByTestId('answer-call').click();
        await expect(chips).toBeVisible();
        await assertAreaReflow(call, width);
        await page.getByRole('button', { name: 'End simulated call' }).click();
        await expect(page.getByTestId('open-titration-call')).toBeFocused();
      });
    });
  }

  for (const experience of ['checkin', 'live-call']) {
    test(`shared explanation remains usable inside ${experience}`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      let pending: Route | undefined;
      let unavailable = false;
      await page.route('**/api/sandbox-ai/assist', async (route) => {
        if (route.request().postDataJSON().kind !== 'explain_rule' || unavailable) return route.fulfill({ json: { fallback: true } });
        pending = route;
      });
      await page.route('**/outreach-audio/**', (route) => route.abort());
      if (experience === 'checkin') {
        await reachFallbackForm(page);
        await fillRequiredFallbackAnswers(page);
        await page.getByLabel(/Weight this morning/).fill('179.5');
        await page.getByRole('button', { name: 'Submit check-in' }).click();
      } else {
        await page.goto('/sandbox');
        await page.getByTestId('sandbox-nav-patient-view').click();
        await page.getByTestId('open-live-call').click();
        await page.getByTestId('answer-call').click();
        const chips = page.getByTestId('live-call-chips');
        await chips.getByRole('button', { name: 'No, nothing like that' }).click();
        await page.getByTestId('live-call-numbers').getByLabel(/Weight/).fill('179.5');
        await page.getByTestId('live-call-numbers').getByRole('button', { name: 'Send', exact: true }).click();
        for (const name of ['Breathing fine', 'No new swelling', 'No, slept normally', 'Normal energy', 'Yes, all taken']) await chips.getByRole('button', { name, exact: true }).click();
        await page.getByTestId('live-call-numbers').getByRole('button', { name: 'Send / skip' }).click();
      }
      const area = page.getByTestId(experience === 'checkin' ? 'sandbox-ai-checkin' : 'sandbox-live-call');
      const first = area.getByTestId('explain-rule-button-weight_gain_3lb_2d');
      await expect(first).toBeVisible();
      expect((await first.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await first.click();
      await expect.poll(() => Boolean(pending)).toBe(true);
      await expect(first).toBeDisabled();
      await pending!.fulfill({ json: { kind: 'explain_rule', explanation: syntheticExplanation } });
      await expect(area.getByTestId('explain-rule-weight_gain_3lb_2d')).toContainText(syntheticExplanation.trim());
      unavailable = true;
      await area.getByTestId('explain-rule-button-weight_gain_5lb_7d').click();
      await expect(area).toContainText('Explanation unavailable right now.');
      await expect(area).toContainText('Weight gain of 5+ lbs in 1 week detected');
    });
  }

  test('supports skip, native keyboard navigation, visible content focus and a return tour', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await page.goto('/sandbox');
    await page.evaluate(() => { document.documentElement.style.fontSize = '32px'; });
    await expect(page.getByTestId('sandbox-nav-command')).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('main')).toBeFocused();
    await page.getByTestId('sandbox-nav-command').focus();
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('sandbox-nav-copilot')).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('sandbox-nav-command')).toHaveAttribute('aria-current', 'page');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('region', { name: 'Sandbox area: Copilot', exact: true })).toBeFocused();
    await page.getByTestId('sandbox-nav-daily-loop').focus();
    await page.keyboard.press('Shift+Tab');
    await expect(page.getByTestId('sandbox-nav-copilot')).toBeFocused();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Space');
    const content = page.getByRole('region', { name: 'Sandbox area: Daily Loop', exact: true });
    await expect(content).toBeFocused();
    await expect.poll(async () => (await content.boundingBox())!.y).toBeLessThan(100);
    const result = await new AxeBuilder({ page }).include('header').include('nav').analyze();
    expect(result.violations.filter((violation) => ['critical', 'serious'].includes(violation.impact ?? ''))).toEqual([]);
  });
});

async function openCheckIn(page: import('@playwright/test').Page) {
  await page.goto('/sandbox');
  await page.getByTestId('sandbox-nav-patient-view').click();
  await page.getByRole('button', { name: /Complete symptom check-in/ }).click();
  await expect(page.getByTestId('sandbox-ai-checkin')).toBeVisible();
}

async function reachFallbackForm(page: import('@playwright/test').Page) {
  await openCheckIn(page);
  await expect(page.getByTestId('sandbox-ai-checkin')).toContainText('any chest pain');
  await page.getByLabel('Type your check-in answer').fill('no chest pain today');
  await page.getByRole('button', { name: 'Send answer' }).click();
  await expect(page.getByTestId('sandbox-ai-form')).toBeVisible();
  await expect(page.getByTestId('sandbox-ai-checkin')).toContainText('unavailable right now');
}

async function fillRequiredFallbackAnswers(page: import('@playwright/test').Page) {
  await page.getByLabel(/Chest pain or fainting/).selectOption('no');
  await page.getByLabel(/Breathing today/).selectOption('0');
  await page.getByLabel(/New or worse swelling/).selectOption('0');
  await page.getByLabel(/Needed extra pillows/).selectOption('no');
  await page.getByLabel(/Energy vs normal/).selectOption('0');
  await page.getByLabel(/All medicines taken/).selectOption('yes');
}

test('check-in degrades to the deterministic form and escalates by the registered weight rules', async ({ page }) => {
  await reachFallbackForm(page);

  await fillRequiredFallbackAnswers(page);
  await page.getByLabel(/Weight this morning/).fill('179.5');
  await page.getByRole('button', { name: 'Submit check-in' }).click();

  const result = page.getByTestId('sandbox-ai-result');
  await expect(result).toContainText('Escalated to human review');
  await expect(result).toContainText('Weight gain of 3+ lbs in 2 days detected');
  await expect(result).toContainText('Weight gain of 5+ lbs in 1 week detected');
  await expect(result).toContainText('never by the AI');
  await expect(page.getByRole('log')).toContainText('The preset rules require human review of this synthetic case:');
});

test('a stable report stays routine and the task completes in the tour', async ({ page }) => {
  await reachFallbackForm(page);

  // Maria's synthetic trend: 176 lbs is +0.8 vs yesterday and +4.2 vs 5 days
  // ago — below both thresholds, so the deterministic outcome is routine.
  await fillRequiredFallbackAnswers(page);
  await page.getByLabel(/Weight this morning/).fill('176');
  await page.getByRole('button', { name: 'Submit check-in' }).click();

  await expect(page.getByTestId('sandbox-ai-result')).toContainText('Routine');
  await expect(page.getByRole('log')).toContainText('Nothing you reported needs urgent attention');
  await expect(page.getByRole('button', { name: /Complete symptom check-in/ })).toContainText('Completed in this synthetic visit');
});

test('chest pain routes straight to the emergency template', async ({ page }) => {
  await reachFallbackForm(page);

  await page.getByLabel(/Chest pain or fainting/).selectOption('yes');
  await page.getByLabel(/Weight this morning/).fill('188');
  await page.getByRole('button', { name: 'Submit check-in' }).click();

  await expect(page.getByTestId('sandbox-ai-result')).toContainText('Emergency pathway demonstrated');
  await expect(page.getByRole('log')).toContainText('call 911');
});

test('the simulated live call completes on the deterministic chip path', async ({ page }) => {
  await page.goto('/sandbox');
  await page.getByTestId('sandbox-nav-patient-view').click();
  await page.getByTestId('open-live-call').click();
  await page.getByTestId('answer-call').click();
  await expect(page.getByRole('log')).toContainText('any chest pain');

  await page.getByTestId('live-call-chips').getByRole('button', { name: 'No, nothing like that' }).click();
  await page.getByTestId('live-call-numbers').getByLabel(/Weight/).fill('176');
  await page.getByTestId('live-call-numbers').getByRole('button', { name: 'Send' }).click();
  await page.getByTestId('live-call-chips').getByRole('button', { name: 'Breathing fine' }).click();
  await page.getByTestId('live-call-chips').getByRole('button', { name: 'No new swelling' }).click();
  await page.getByTestId('live-call-chips').getByRole('button', { name: 'No, slept normally' }).click();
  await page.getByTestId('live-call-chips').getByRole('button', { name: 'Normal energy' }).click();
  await page.getByTestId('live-call-chips').getByRole('button', { name: 'Yes, all taken' }).click();
  await page.getByTestId('live-call-numbers').getByRole('button', { name: 'Send / skip' }).click();

  await expect(page.getByTestId('live-call-result')).toContainText('Routine');
  await expect(page.getByTestId('live-call-result')).toContainText('never by the AI');
});

test('pre-generated call audio is served to anonymous visitors, not redirected to login', async ({ request }) => {
  // Regression guard: the session proxy must treat .mp3 under public/ as a
  // static asset — a redirect here silently mutes every call and player.
  for (const asset of ['/outreach-audio/prompts/daily_checkin/en/intro.mp3', '/outreach-audio/call-maria-redflag.mp3']) {
    const response = await request.get(asset, { maxRedirects: 0 });
    expect(response.status(), asset).toBe(200);
    expect(response.headers()['content-type'], asset).toContain('audio');
  }
});

test('the titration follow-up call completes on chips and the registered gates decide', async ({ page }) => {
  await page.goto('/sandbox');
  await page.getByTestId('sandbox-nav-patient-view').click();
  await page.getByTestId('open-titration-call').click();
  await page.getByTestId('answer-call').click();
  await expect(page.getByRole('log')).toContainText('since we increased your medicine');

  await page.getByTestId('live-call-chips').getByRole('button', { name: 'No, nothing like that' }).click();
  await page.getByTestId('live-call-chips').getByRole('button', { name: 'No dizziness' }).click();
  await page.getByTestId('live-call-numbers').getByLabel(/Systolic BP/).fill('121');
  await page.getByTestId('live-call-numbers').getByRole('button', { name: 'Send / skip' }).click();
  await page.getByTestId('live-call-numbers').getByLabel(/Pulse/).fill('71');
  await page.getByTestId('live-call-numbers').getByRole('button', { name: 'Send / skip' }).click();
  await page.getByTestId('live-call-chips').getByRole('button', { name: 'No, feeling the same' }).click();
  await page.getByTestId('live-call-chips').getByRole('button', { name: 'Yes, every day' }).click();

  const result = page.getByTestId('live-call-result');
  await expect(result).toContainText('Proceed confirmed');
  await expect(result).toContainText('registered titration safety gates, never by the AI');
});

test('the live call speaks Spanish end to end on the deterministic chip path', async ({ page }) => {
  await page.goto('/sandbox');
  await page.getByTestId('sandbox-nav-patient-view').click();
  await page.getByTestId('open-live-call').click();
  await page.getByTestId('call-locale-es').click();
  await page.getByTestId('answer-call').click();

  await expect(page.getByRole('log')).toContainText('dolor de pecho');
  await page.getByTestId('live-call-chips').getByRole('button', { name: 'No, nada de eso' }).click();
  await expect(page.getByRole('log')).toContainText('báscula');
});

test('assist surfaces render drafted content from the assist endpoint', async ({ page }) => {
  await page.route('**/api/sandbox-ai/assist', async (route) => {
    const body = route.request().postDataJSON() as { kind: string };
    const responses: Record<string, unknown> = {
      morning_brief: { kind: 'morning_brief', brief: 'Maria Santos needs a callback first this morning; the remaining check-ins stayed routine.' },
      sbar_polish: { kind: 'sbar_polish', situation: 'Polished situation.', background: 'Polished background.', assessment: 'Polished assessment.', recommendation: 'Polished recommendation.' },
      explain_rule: { kind: 'explain_rule', explanation: 'Her weight rose faster than the five-pound weekly limit this registered rule watches for.' },
      protocol_qa: { kind: 'protocol_qa', answer: 'The titration safety gates hold or reduce doses on low blood pressure, low heart rate, or rising potassium.', citations: ['Module 3 §3.3'] },
    };
    await route.fulfill({ json: responses[body.kind] ?? { fallback: true } });
  });

  await page.goto('/sandbox');
  await page.getByTestId('sandbox-nav-daily-loop').click();
  await page.getByTestId('draft-morning-brief').click();
  await expect(page.getByTestId('morning-brief')).toContainText('Maria Santos needs a callback');
  await expect(page.getByTestId('morning-brief')).toContainText('never by the AI');

  await page.getByTestId('sandbox-nav-outreach').click();
  const maria = page.getByTestId('outreach-call-call-maria-redflag');
  await maria.getByRole('button', { name: /Draft SBAR handoff/ }).click();
  await page.getByTestId('sbar-polish').click();
  await expect(page.getByTestId('sbar-polish-note')).toContainText('review before use');
  await page.getByRole('button', { name: 'Accept proposal' }).click();
  await expect(page.getByTestId('sandbox-sbar-draft').getByLabel('Situation')).toHaveValue('Polished situation.');
  await expect(page.getByTestId('sandbox-sbar-draft').getByLabel('Assessment')).not.toHaveValue('Polished assessment.');
  await expect(page.getByTestId('sandbox-sbar-draft').getByLabel('Recommendation')).not.toHaveValue('Polished recommendation.');
});

test('the copilot runs the morning round, narrates the brief, and answers queue questions with a tool trace', async ({ page }) => {
  let simulateCalls = 0;
  await page.route('**/api/sandbox-ai/simulate-call', async (route) => {
    simulateCalls += 1;
    const escalated = simulateCalls === 2;
    await route.fulfill({
      json: {
        transcript: {
          id: `e2e-run-${simulateCalls}`,
          patientId: null,
          patientName: `Persona ${simulateCalls} (synthetic)`,
          channel: 'automated-voice-simulation',
          placedLabel: 'This visit · just now',
          turns: [],
          extraction: {},
          redFlags: escalated
            ? [{ id: 'weight_gain_5lb_7d', severity: 'critical', message: 'Weight gain of 5+ lbs in 1 week detected', action: 'Seek urgent evaluation within 24 hours' }]
            : [],
          disposition: escalated ? 'escalated' : 'routine',
        },
      },
    });
  });
  await page.route('**/api/sandbox-ai/assist', async (route) => {
    await route.fulfill({ json: { kind: 'morning_brief', brief: 'Persona 2 needs the first callback; the others stayed routine.' } });
  });
  await page.route('**/api/sandbox-ai/copilot', async (route) => {
    await route.fulfill({
      json: {
        answer: 'Call Persona 2 first — registered rule weight_gain_5lb_7d fired.',
        toolTrace: [{ tool: 'get_queue', summary: 'queue (4 items)' }, { tool: 'explain_rule', summary: 'rule weight_gain_5lb_7d' }],
      },
    });
  });

  await page.goto('/sandbox');
  await page.getByTestId('sandbox-nav-copilot').click();
  await expect(page.getByTestId('sandbox-copilot')).toBeVisible();

  await page.getByTestId('run-morning-round').click();
  await expect(page.getByTestId('round-metric')).toContainText('3 automated check-ins processed');
  await expect(page.getByTestId('round-metric')).toContainText('never by the AI');
  await expect(page.getByTestId('copilot-brief')).toContainText('Persona 2 needs the first callback');
  await expect(page.getByTestId('copilot-prepared')).toContainText('Weight gain of 5+ lbs in 1 week detected');

  await page.getByRole('button', { name: 'Who should I call first, and why?' }).click();
  await expect(page.getByTestId('copilot-answer')).toContainText('Call Persona 2 first');
  await expect(page.getByTestId('copilot-trace')).toContainText('queue (4 items) → rule weight_gain_5lb_7d');

  // The round populated the shared queue in the Daily Loop.
  await page.getByTestId('sandbox-nav-daily-loop').click();
  await expect(page.getByTestId('daily-loop-outreach')).toContainText('Persona 2 (synthetic)');
});

test('the call chats back on pure small talk and streams text before audio', async ({ page }) => {
  let calls = 0;
  await page.route('**/api/sandbox-ai/checkin', async (route) => {
    calls += 1;
    if (calls === 1) {
      // Pure chat turn as two-phase NDJSON: the chat reply (pending audio),
      // then the resolved speech line. Phase must NOT advance.
      const body = JSON.parse(route.request().postData() ?? '{}');
      const turn = {
        assistantMessages: ['Lemon pie — now that sounds like a lovely afternoon. Who taught you that recipe?'],
        speech: [{ kind: 'pending' }],
        state: { ...body.state, turnCount: 1, chatTurnsUsed: 1 },
        done: false, disposition: null, redFlags: [], fallback: false,
      };
      await route.fulfill({
        contentType: 'application/x-ndjson',
        body: `${JSON.stringify(turn)}\n${JSON.stringify({ speech: [null] })}\n`,
      });
      return;
    }
    const body = JSON.parse(route.request().postData() ?? '{}');
    await route.fulfill({
      json: {
        assistantMessages: ['Thank you. What did the scale show this morning, in pounds?'],
        state: { ...body.state, phase: 'q2_weight', turnCount: 2 },
        done: false, disposition: null, redFlags: [], fallback: false,
      },
    });
  });

  await page.goto('/sandbox');
  await page.getByTestId('sandbox-nav-patient-view').click();
  await page.getByTestId('open-live-call').click();
  await page.getByTestId('answer-call').click();

  const input = page.getByLabel('Say something in your own words');
  await input.fill('my granddaughter and I baked a lemon pie today!');
  await input.press('Enter');
  // The chat reply shows WITHOUT the script question appended — real chat.
  // (The question legitimately appears ONCE, from the call opening.)
  await expect(page.getByRole('log')).toContainText('Who taught you that recipe?');
  const transcript = (await page.getByRole('log').textContent()) ?? '';
  expect(transcript.split('any chest pain').length - 1).toBe(1);

  await input.fill('my grandmother did! anyway, no chest pain today');
  await input.press('Enter');
  await expect(page.getByRole('log')).toContainText('What did the scale show this morning');
});

test('the population scene runs deterministically and funnels thousands into a small review queue', async ({ page }) => {
  // Reduced motion lands on the final state without the 30s theater replay.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/sandbox');
  const funnel = page.getByTestId('population-funnel');
  await expect(funnel).toContainText('—');
  await expect(page.getByTestId('population-disclaimer')).toContainText('Illustrative workflow demonstration on synthetic data');

  await page.getByTestId('population-run').click();
  const claim = page.getByTestId('population-claim');
  await expect(claim).toContainText('98.1% stayed outside the simulated review queue', { timeout: 10_000 });
  await expect(claim).toContainText('47 of 2,500 synthetic check-ins entered the review queue');
  await expect(claim).not.toContainText('resolved');
  await expect(claim).not.toContainText('1 clinician');

  const queue = page.getByTestId('population-exceptions');
  await expect(queue).toContainText("Today's review queue");
  await expect(queue).toContainText('rule weight_gain');

  // Switching the population size resets the scene to idle.
  await page.getByTestId('population-size-500').click();
  await expect(page.getByTestId('population-funnel')).toContainText('—');
  await page.getByTestId('population-run').click();
  await expect(page.getByTestId('population-claim')).toContainText('of 500 synthetic check-ins', { timeout: 10_000 });
});

test('the theater replay shows live processing and Skip lands on the exact final numbers', async ({ page }) => {
  await page.goto('/sandbox');
  await page.getByTestId('population-run').click();

  // The replay is visibly RUNNING: clock, dot wall, and live feed present.
  await expect(page.getByTestId('population-clock')).toBeVisible();
  await expect(page.getByTestId('population-wall')).toBeVisible();
  await expect(page.getByTestId('population-feed')).toBeVisible();
  await expect(page.getByTestId('population-speed')).toBeVisible();

  await page.getByTestId('population-skip').click();
  await expect(page.getByTestId('population-claim')).toContainText('47 of 2,500 synthetic check-ins entered the review queue');
  await expect(page.getByTestId('population-exceptions')).toContainText("Today's review queue");
});

test('a case is fully workable: chart, protocol outcome, progress, Daily Loop, and Impact', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/sandbox');
  await page.getByTestId('population-run').click();
  await expect(page.getByTestId('population-exceptions')).toBeVisible();
  await expect(page.getByTestId('queue-progress')).toContainText('0 of');

  const firstEntry = page.locator('[data-testid^="queue-entry-"]').first();
  const entryTestId = await firstEntry.getAttribute('data-testid');
  const ordinal = entryTestId!.replace('queue-entry-', '');
  await firstEntry.click();

  // Stage 1: the generated chart is real and on screen.
  const detail = page.getByTestId(`queue-detail-${ordinal}`);
  await expect(detail).toContainText(/Registered rule|monitoring-gap policy/);
  await expect(detail).toContainText(/Risk score \d+\/18/);
  await expect(detail).toContainText('Medications');
  await expect(detail).toContainText('Potassium');

  // Stage 3: documenting a protocol outcome works the case.
  await page.locator(`[data-testid^="queue-outcome-${ordinal}-"]`).first().click();
  await expect(page.getByTestId(`queue-worked-${ordinal}`)).toContainText('Worked ✓');
  await expect(page.getByTestId('queue-progress')).toContainText('1 of');

  await page.getByTestId(`queue-send-${ordinal}`).click();
  await expect(page.getByTestId(`queue-send-${ordinal}`)).toContainText('In Daily Loop ✓');

  // The population patient now exists in the Daily Loop's outreach queue.
  await page.getByTestId('sandbox-nav-daily-loop').click();
  await expect(page.getByTestId('daily-loop-outreach')).toContainText('Overnight round');

  // And the work shows up as adoption evidence.
  await page.getByTestId('sandbox-nav-impact').click();
  await expect(page.getByText('Cases documented')).toBeVisible();
});

test('calling a population patient opens the interactive check-in for that case', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/sandbox');
  await page.getByTestId('population-run').click();
  const firstEntry = page.locator('[data-testid^="queue-entry-"]').first();
  const ordinal = (await firstEntry.getAttribute('data-testid'))!.replace('queue-entry-', '');
  await firstEntry.click();

  await page.getByTestId(`queue-call-${ordinal}`).click();
  // The real interactive call rings for this synthetic patient; answering it
  // starts the deterministic chip path (works with the assistant disabled).
  await page.getByTestId('answer-call').click();
  await expect(page.getByRole('log')).toContainText('any chest pain');
  await page.getByTestId('live-call-chips').getByRole('button', { name: 'No, nothing like that' }).click();
  await expect(page.getByRole('log')).toContainText('scale show this morning');
});

test('the day simulation advances the badge, logs the completed day, and survives a reload', async ({ page }) => {
  let simulatedCall = 0;
  await page.route('**/api/sandbox-ai/simulate-call', async (route) => {
    simulatedCall += 1;
    await route.fulfill({
      json: {
        transcript: {
          id: `ai-run-day${simulatedCall}`,
          patientId: null,
          patientName: `Day persona ${simulatedCall} (synthetic)`,
          channel: 'automated-voice-simulation',
          placedLabel: 'This visit · just now',
          turns: [], extraction: {}, redFlags: [], disposition: 'routine',
        },
      },
    });
  });
  await page.route('**/api/sandbox-ai/assist', async (route) => {
    await route.fulfill({ json: { kind: 'morning_brief', brief: 'All three synthetic calls stayed routine.' } });
  });

  await page.goto('/sandbox');
  await page.getByTestId('sandbox-nav-copilot').click();
  await expect(page.getByTestId('copilot-day-badge')).toContainText('Day 1 of 5');
  await expect(page.getByTestId('sandbox-day-badge')).toContainText('Day 1 of 5');
  await expect(page.getByTestId('advance-day')).toBeDisabled();

  await page.getByTestId('run-morning-round').click();
  await expect(page.getByTestId('copilot-brief')).toContainText('All three synthetic calls stayed routine.');
  await page.getByTestId('advance-day').click();
  await expect(page.getByTestId('copilot-day-badge')).toContainText('Day 2 of 5');
  await expect(page.getByTestId('copilot-day-controls')).toContainText('Day 1 ✓');

  // The simulation day persists in the browser-local demo state. The save
  // effect runs after paint, so wait for the write before reloading.
  await page.waitForFunction(() => {
    try {
      return JSON.parse(window.localStorage.getItem('heartland_synthetic_sandbox_v2') ?? '{}').dayIndex === 1;
    } catch {
      return false;
    }
  });
  await page.reload();
  await expect(page.getByTestId('sandbox-day-badge')).toContainText('Day 2 of 5');
});

test('the guide answers protocol questions with citations from the reference assistant', async ({ page }) => {
  await page.route('**/api/sandbox-ai/assist', async (route) => {
    await route.fulfill({
      json: {
        kind: 'protocol_qa',
        answer: 'The Generic Bridge keeps quadruple therapy near fifteen dollars a month using generic equivalents.',
        citations: ['Module 2 §2.4'],
      },
    });
  });
  await page.goto('/guide');
  await expect(page.getByTestId('protocol-assistant')).toBeVisible();
  await page.getByRole('button', { name: 'How does the Generic Bridge keep therapy affordable?' }).click();
  const answer = page.getByTestId('protocol-assistant-answer');
  await expect(answer).toContainText('fifteen dollars');
  await expect(answer).toContainText('Module 2 §2.4');
  await expect(page.getByTestId('protocol-assistant')).toContainText(/not medical advice/i);
});

test('the live call supports hands-free voice answers with server-provided speech', async ({ page }) => {
  // Deterministic browser stubs: instant audio playback and a scriptable
  // SpeechRecognition. No real mic, no real speech service.
  await page.addInitScript(() => {
    const endedAudio = new WeakSet<HTMLMediaElement>();
    Object.defineProperty(HTMLMediaElement.prototype, 'ended', {
      configurable: true, get() { return endedAudio.has(this); },
    });
    HTMLMediaElement.prototype.play = function play() {
      endedAudio.delete(this);
      setTimeout(() => { endedAudio.add(this); this.dispatchEvent(new Event('ended')); }, 0);
      return Promise.resolve();
    };
    class StubRecognition {
      lang = ''; interimResults = false; continuous = false;
      onresult: ((event: unknown) => void) | null = null;
      onend: (() => void) | null = null;
      start() {
        (window as unknown as { __recognition: StubRecognition }).__recognition = this;
      }
      stop() { this.onend?.(); }
      abort() { /* no-op */ }
    }
    (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = StubRecognition;
    (window as unknown as { __speak: (text: string) => void }).__speak = (text: string) => {
      const recognition = (window as unknown as { __recognition?: StubRecognition }).__recognition;
      recognition?.onresult?.({ results: { length: 1, 0: { 0: { transcript: text }, isFinal: true } } });
      recognition?.onend?.();
    };
  });

  // The e2e web server has the AI disabled, so the voice turn is served by a
  // route mock — exactly the shape the real endpoint returns.
  await page.route('**/api/sandbox-ai/checkin', async (route) => {
    const body = route.request().postDataJSON() as {
      state: { phase: string; extraction: Record<string, unknown> };
      wantSpeech?: boolean;
    };
    if (body.wantSpeech !== true || body.state.phase !== 'q1_safety') {
      await route.fulfill({ json: { fallback: true } });
      return;
    }
    await route.fulfill({
      json: {
        assistantMessages: [
          'What a treat to have your grandson visit.',
          'What did the scale show this morning, in pounds?',
        ],
        speech: [null, { kind: 'clip', clipId: 'q2_weight' }],
        state: {
          ...body.state,
          phase: 'q2_weight',
          extraction: { ...body.state.extraction, chestPainOrSyncope: false },
          turnCount: 1,
        },
        done: false,
        disposition: null,
        redFlags: [],
        fallback: false,
      },
    });
  });

  await page.goto('/sandbox');
  await page.getByTestId('sandbox-nav-patient-view').click();
  await page.getByTestId('open-live-call').click();
  await page.getByTestId('live-call-mic-opt-in').click();
  await page.getByTestId('answer-call').click();

  const status = page.getByTestId('live-call-voice-status');
  await expect(status).toHaveText(/Listening — just talk/);
  await page.evaluate(() => (window as unknown as { __speak: (text: string) => void }).__speak('no chest pain, my grandson visited yesterday'));

  const log = page.getByRole('log');
  await expect(log).toContainText('no chest pain, my grandson visited yesterday');
  await expect(log).toContainText('What a treat to have your grandson visit.');
  await expect(log).toContainText('What did the scale show');
  await expect(status).toHaveText(/Listening — just talk/);

  // The rest of the call still completes on the deterministic chip path.
  await page.getByTestId('live-call-numbers').getByLabel(/Weight/).fill('176');
  await page.getByTestId('live-call-numbers').getByRole('button', { name: 'Send' }).click();
  await page.getByTestId('live-call-chips').getByRole('button', { name: 'Breathing fine' }).click();
  await page.getByTestId('live-call-chips').getByRole('button', { name: 'No new swelling' }).click();
  await page.getByTestId('live-call-chips').getByRole('button', { name: 'No, slept normally' }).click();
  await page.getByTestId('live-call-chips').getByRole('button', { name: 'Normal energy' }).click();
  await page.getByTestId('live-call-chips').getByRole('button', { name: 'Yes, all taken' }).click();
  await page.getByTestId('live-call-numbers').getByRole('button', { name: 'Send / skip' }).click();
  await expect(page.getByTestId('live-call-result')).toContainText('Routine');
});

test('outreach demonstrates simulated calls, transcripts, extraction, and the SBAR draft', async ({ page }) => {
  await page.goto('/sandbox');
  await page.getByTestId('sandbox-nav-outreach').click();
  await expect(page.getByTestId('sandbox-outreach')).toBeVisible();

  const maria = page.getByTestId('outreach-call-call-maria-redflag');
  await expect(maria).toContainText('Escalated to human review');
  await expect(maria).toContainText('Rule: weight_gain_5lb_7d');
  await expect(page.getByTestId('outreach-audio-call-maria-redflag')).toContainText('no real call is placed');
  await expect(page.getByTestId('outreach-call-call-robert-noanswer')).toContainText('No answer · human follow-up');

  await maria.getByRole('button', { name: /View transcript/ }).click();
  await expect(maria).toContainText('179 and a half');
  await expect(maria).toContainText('Structured data captured by the AI layer');

  await maria.getByRole('button', { name: /Draft SBAR handoff/ }).click();
  const draft = page.getByTestId('sandbox-sbar-draft');
  await expect(draft.getByLabel('Situation')).toHaveValue(/Maria Santos/);
  await expect(draft.getByLabel('Recommendation')).toHaveValue(/Provider to complete/);

  // Feature disabled: live simulation degrades to an explicit notice.
  await page.getByTestId('run-simulated-call').click();
  await expect(page.getByTestId('simulate-unavailable')).toBeVisible();
});

test('daily loop shows the automated-outreach work items with the required labeling', async ({ page }) => {
  await page.goto('/sandbox');
  await page.getByTestId('sandbox-nav-daily-loop').click();

  const block = page.getByTestId('daily-loop-outreach');
  await expect(block).toContainText('From automated outreach (demonstration)');
  await expect(block).toContainText('Priority set by registered clinical rules · conversation structured by AI');
  await expect(block).toContainText('Maria Santos');
});

test('AI surfaces never use the restricted regulatory terminology', async ({ page }) => {
  // The population scene must never phrase capacity as a staffing claim.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/sandbox');
  await page.getByTestId('population-run').click();
  await expect(page.getByTestId('population-claim')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('body')).not.toContainText(/replaces? (a )?(nurse|clinician|staff)/i);
  await expect(page.locator('body')).not.toContainText(/reduc\w* staffing/i);
  await expect(page.locator('body')).not.toContainText(/clinical decision support/i);

  await openCheckIn(page);
  await expect(page.locator('body')).not.toContainText(/clinical decision support/i);
  await expect(page.locator('body')).not.toContainText(/AI (triage|diagnos)/i);

  await page.getByTestId('sandbox-nav-outreach').click();
  await expect(page.locator('body')).not.toContainText(/clinical decision support/i);
  await expect(page.locator('body')).not.toContainText(/AI (triage|diagnos)/i);

  await page.getByTestId('sandbox-nav-copilot').click();
  await expect(page.getByTestId('sandbox-copilot')).toBeVisible();
  await expect(page.locator('body')).not.toContainText(/clinical decision support/i);
  await expect(page.locator('body')).not.toContainText(/AI (triage|diagnos)/i);

  await page.goto('/guide');
  await expect(page.getByTestId('protocol-assistant')).toBeVisible();
  await expect(page.locator('body')).not.toContainText(/clinical decision support/i);
  await expect(page.locator('body')).not.toContainText(/AI (triage|diagnos)/i);
});

test('accessibility: check-in open and outreach pass critical/serious axe checks', async ({ page }) => {
  await openCheckIn(page);
  const checkInScan = await new AxeBuilder({ page }).analyze();
  expect(checkInScan.violations.filter((violation) => ['critical', 'serious'].includes(violation.impact ?? ''))).toEqual([]);

  await page.getByTestId('sandbox-nav-outreach').click();
  await page.getByTestId('outreach-call-call-maria-redflag').getByRole('button', { name: /View transcript/ }).click();
  const outreachScan = await new AxeBuilder({ page }).analyze();
  expect(outreachScan.violations.filter((violation) => ['critical', 'serious'].includes(violation.impact ?? ''))).toEqual([]);
});

// Functional regressions for §21, separate from the §19–20 reflow matrix.
// The fixtures below apply the current registered controller to explicit
// synthetic answers. They do not exercise model extraction or real speech.
const CONVERSATION_TIME = Date.parse('2026-09-12T12:00:00Z');
const ENDING_AUDIO = 'Y29udmVyc2F0aW9uLWVuZGluZw==';
type ConversationSurface = 'live-call' | 'checkin';
type ConversationMediaProbe = {
  plays: string[];
  pauses: number;
  blocked: number;
  blockFinal: number;
  recognitions: number;
};
const conversationPageErrors = new WeakMap<Page, string[]>();

function conversationValues(patientId: string): CheckInExtraction {
  const patient = SANDBOX_PATIENTS.find((entry) => entry.id === patientId)!;
  const latest = patient.vitals.at(-1)!;
  return {
    ...emptyExtraction(), chestPainOrSyncope: false, weightLbs: latest.weight,
    sbp: latest.sbp, spo2: latest.spo2, hr: latest.heartRate,
    dyspnea: 0, edema: 0, orthopnea: false, fatigue: 0,
    adherence: 'yes', dizziness: 0, worseSymptoms: false,
  };
}

function conversationTurn(state: CheckInState, values?: Partial<CheckInExtraction>): CheckInTurnResponse {
  const answers = conversationValues(state.patientId);
  const keys = state.phase === 'complete' ? [] : scriptFor(state.scriptId).questions[state.phase]!.extractionKeys;
  const extracted = values ?? Object.fromEntries(keys.map((key) => [key, answers[key]]));
  // Both browser and controller use one date. This synchronous scope is
  // restored before any await and cannot leak a clock into another test.
  const NativeDate = Date;
  class ScenarioDate extends NativeDate {
    constructor(value?: string | number | Date) {
      super(value instanceof NativeDate ? value.getTime() : value ?? CONVERSATION_TIME);
    }
    static now() { return CONVERSATION_TIME; }
  }
  globalThis.Date = ScenarioDate as DateConstructor;
  try { return applyDeterministicAnswer(state, extracted); }
  finally { globalThis.Date = NativeDate; }
}

function completedConversation(state: CheckInState): CheckInTurnResponse {
  let turn = conversationTurn(state);
  while (!turn.done) turn = conversationTurn(turn.state);
  return turn;
}

async function conversationMedia(page: Page) {
  return page.evaluate(() => (window as unknown as { __conversationMedia: ConversationMediaProbe }).__conversationMedia);
}

async function openConversation(page: Page, patientId: string, surface: ConversationSurface, script: ScriptId = 'daily_checkin') {
  const patient = SANDBOX_PATIENTS.find((entry) => entry.id === patientId)!;
  await page.getByTestId('sandbox-nav-patient-360').click();
  await page.getByRole('region', { name: 'Choose a synthetic patient' }).getByRole('button', { name: new RegExp(patient.name) }).click();
  await page.getByTestId('sandbox-nav-patient-view').click();
  if (surface === 'checkin') await page.getByRole('button', { name: /Complete symptom check-in/ }).click();
  else await page.getByTestId(script === 'daily_checkin' ? 'open-live-call' : 'open-titration-call').click();
  const area = page.getByTestId(surface === 'checkin' ? 'sandbox-ai-checkin' : 'sandbox-live-call');
  await expect(area).toBeVisible();
  return area;
}

async function finishStructuredCall(area: Locator, initial: CheckInState) {
  let state = initial;
  let finished: CheckInTurnResponse | undefined;
  while (state.phase !== 'complete') {
    const values = conversationValues(state.patientId);
    const numeric = area.getByTestId('live-call-numbers');
    const fields = state.phase === 'q2_weight' ? [['Weight', values.weightLbs]]
      : state.phase === 'q8_devices' ? [['Systolic BP', values.sbp], ['Oxygen %', values.spo2]]
        : state.phase === 't3_sbp' ? [['Systolic BP', values.sbp]]
          : state.phase === 't4_hr' ? [['Pulse', values.hr]] : null;
    if (fields) {
      for (const [label, value] of fields) await numeric.getByLabel(new RegExp(String(label))).fill(String(value));
      await numeric.getByRole('button', { name: state.phase === 'q2_weight' ? 'Send' : 'Send / skip', exact: true }).click();
    } else {
      const answer = QUICK_ANSWERS[state.phase]!.find((candidate) => Object.entries(candidate.values).every(([key, value]) => values[key as keyof CheckInExtraction] === value))!;
      await area.getByTestId('live-call-chips').getByRole('button', { name: quickAnswerLabel(answer, state.locale), exact: true }).click();
    }
    finished = conversationTurn(state);
    state = finished.state;
    if (!finished.done) await expect(area.getByRole('log')).toContainText(callPromptsFor(state.scriptId, state.locale)[state.phase].text);
  }
  return finished!;
}

async function resumeBlockedEnding(page: Page, area: Locator, name = 'Play assistant audio') {
  const resume = area.getByRole('button', { name, exact: true });
  await expect(resume).toBeVisible();
  await resume.click();
  await expect.poll(async () => (await conversationMedia(page)).blocked).toBe(2);
  await expect(resume).toBeVisible();
  await resume.click();
  await expect(resume).toHaveCount(0);
}

test.describe('conversation integrity', () => {
  test.use({ serviceWorkers: 'block' });

  test.beforeEach(async ({ page }) => {
    const pageErrors: string[] = [];
    conversationPageErrors.set(page, pageErrors);
    page.on('pageerror', (error) => { pageErrors.push(error.stack ?? error.message); });
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== 'http://127.0.0.1:3100') return route.abort();
      if (url.pathname.startsWith('/api/sandbox-ai/')) return route.fulfill({ json: { fallback: true } });
      if (url.pathname.startsWith('/outreach-audio/')) return route.abort();
      return route.continue();
    });
    await page.addInitScript(({ ending }) => {
      const probe: ConversationMediaProbe = { plays: [], pauses: 0, blocked: 0, blockFinal: 2, recognitions: 0 };
      (window as unknown as { __conversationMedia: ConversationMediaProbe }).__conversationMedia = probe;
      const states = new WeakMap<HTMLMediaElement, { src: string; ended: boolean; serial: number }>();
      const stateFor = (element: HTMLMediaElement) => {
        let state = states.get(element);
        if (!state) { state = { src: '', ended: false, serial: 0 }; states.set(element, state); }
        return state;
      };
      Object.defineProperty(HTMLMediaElement.prototype, 'src', {
        configurable: true,
        get() { return stateFor(this).src; },
        set(value: string) { const state = stateFor(this); state.src = value; state.ended = false; state.serial += 1; },
      });
      Object.defineProperty(HTMLMediaElement.prototype, 'ended', { configurable: true, get() { return stateFor(this).ended; } });
      Object.defineProperty(HTMLMediaElement.prototype, 'error', { configurable: true, get() { return null; } });
      const removeAttribute = Element.prototype.removeAttribute;
      HTMLMediaElement.prototype.removeAttribute = function removeMediaAttribute(name: string) {
        if (name === 'src') { const state = stateFor(this); state.src = ''; state.serial += 1; }
        removeAttribute.call(this, name);
      };
      HTMLMediaElement.prototype.play = function play() {
        const state = stateFor(this);
        state.ended = false;
        const serial = ++state.serial;
        probe.plays.push(state.src);
        const final = /\/(routine|escalated|emergency)\.mp3$/.test(state.src) || state.src.endsWith(ending);
        if (final && probe.blockFinal > 0) {
          probe.blockFinal -= 1; probe.blocked += 1;
          return Promise.reject(new DOMException('Synthetic autoplay rejection', 'NotAllowedError'));
        }
        setTimeout(() => {
          if (!this.isConnected || state.serial !== serial) return;
          state.ended = true;
          this.dispatchEvent(new Event('ended'));
        }, 5);
        return Promise.resolve();
      };
      HTMLMediaElement.prototype.pause = function pause() { probe.pauses += 1; stateFor(this).serial += 1; };
      HTMLMediaElement.prototype.load = function load() { stateFor(this).serial += 1; };
      class RecognitionStub {
        lang = ''; interimResults = false; continuous = false;
        onresult = null; onend = null;
        start() { probe.recognitions += 1; }
        stop() {} abort() {}
      }
      Object.assign(window, { SpeechRecognition: RecognitionStub, webkitSpeechRecognition: RecognitionStub });
    }, { ending: ENDING_AUDIO });
    await page.clock.setFixedTime(new Date(CONVERSATION_TIME));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/sandbox');
  });

  test.afterEach(async ({ page }) => {
    expect((await conversationMedia(page)).recognitions, 'no microphone was enabled').toBe(0);
    expect(conversationPageErrors.get(page), 'conversation flow has no uncaught browser exception').toEqual([]);
  });

  for (const patientId of ['demo-maria', 'demo-james']) {
    for (const locale of ['en', 'es'] as const) {
      for (const scriptId of ['daily_checkin', 'titration_followup'] as const) {
        test(`live ${patientId} ${scriptId} ${locale}: current rules, filler and recoverable closing audio`, async ({ page }) => {
          await page.route('**/api/sandbox-ai/checkin', async (route) => {
            const body = route.request().postDataJSON() as { state: CheckInState; wantSpeech: boolean };
            expect(body.state).toMatchObject({ patientId, scriptId, locale });
            expect(body.wantSpeech).toBe(true);
            const turn = conversationTurn(body.state);
            await route.fulfill({ json: { ...turn, speech: [{ kind: 'clip', clipId: turn.state.phase }] } });
          });
          const area = await openConversation(page, patientId, 'live-call', scriptId);
          await area.getByTestId(`call-locale-${locale}`).click();
          await area.getByTestId('answer-call').click();
          const input = area.getByLabel('Say something in your own words');
          await input.fill('Synthetic answer to the first safety question.');
          await input.press('Enter');
          const first = conversationTurn(createInitialState(patientId, scriptId, locale));
          await expect(area.getByRole('log')).toHaveAttribute('lang', `${locale}-US`);
          await expect(area.getByRole('log')).toContainText(callPromptsFor(scriptId, locale)[first.state.phase].text);
          await expect.poll(async () => (await conversationMedia(page)).plays.some((src) => fillerPromptsFor(locale).some((filler) => filler.audioSrc === src))).toBe(true);
          const finished = await finishStructuredCall(area, first.state);
          const receipt = area.getByTestId('live-call-decision-receipt');
          await expect(receipt).toContainText(`· ${finished.disposition}`);
          for (const flag of finished.redFlags) await expect(receipt).toContainText(flag.id);
          await expect(receipt).toContainText('Typed answer + Quick answer / structured entry');
          await resumeBlockedEnding(page, area);
          const key = `${patientId}-${scriptId === 'daily_checkin' ? 'call' : 'titration-call'}`;
          const completed = await page.evaluate(() => JSON.parse(localStorage.getItem('heartland_synthetic_sandbox_v2')!).patientCheckIns as string[]);
          expect(completed.filter((entry) => entry === key)).toHaveLength(1);
          await area.getByRole('button', { name: 'End simulated call' }).click();
          await expect(area).toHaveCount(0);
          expect(await page.evaluate((entry) => JSON.parse(localStorage.getItem('heartland_synthetic_sandbox_v2')!).patientCheckIns.includes(entry), key)).toBe(true);
        });
      }

      test(`checkin ${patientId} daily ${locale}: accepted synthetic turns and recoverable final speech`, async ({ page }) => {
        const seen: CheckInState[] = [];
        await page.route('**/api/sandbox-ai/checkin', async (route) => {
          const body = route.request().postDataJSON() as { state: CheckInState; wantSpeech: boolean };
          expect(body.state).toMatchObject({ patientId, scriptId: 'daily_checkin', locale });
          expect(body.wantSpeech).toBe(true);
          seen.push(body.state);
          const turn = conversationTurn(body.state);
          await route.fulfill({ json: { ...turn, speech: [turn.done ? { kind: 'audio', mp3Base64: ENDING_AUDIO } : { kind: 'clip', clipId: turn.state.phase }] } });
        });
        const area = await openConversation(page, patientId, 'checkin');
        await area.getByTestId(`checkin-locale-${locale}`).click();
        await area.getByRole('button', { name: 'Turn assistant voice on' }).click();
        let state = createInitialState(patientId, 'daily_checkin', locale);
        while (state.phase !== 'complete') {
          const turn = conversationTurn(state);
          const input = area.getByLabel('Type your check-in answer');
          await input.fill(`Synthetic answer for ${state.phase}.`);
          await input.press('Enter');
          await expect(area.getByRole('log')).toContainText(turn.assistantMessages[0]);
          state = turn.state;
        }
        expect(seen.map((state) => state.phase)).toEqual(scriptFor('daily_checkin').order);
        await expect(area.getByRole('log')).toHaveAttribute('lang', `${locale}-US`);
        await expect(area.getByTestId('sandbox-ai-result')).toBeVisible();
        await resumeBlockedEnding(page, area);
        // The sandbox persists after the ending resumes; poll instead of reading storage once.
        await expect.poll(() => page.evaluate((id) => {
          const raw = localStorage.getItem('heartland_synthetic_sandbox_v2');
          if (!raw) return -1;
          return JSON.parse(raw).patientCheckIns.filter((value: string) => value === `${id}-symptoms`).length;
        }, patientId)).toBe(1);
      });
    }
  }

  for (const locale of ['en', 'es'] as const) {
    test(`form explanation ${locale} uses completed answers instead of earlier chat extraction`, async ({ page }) => {
      let turns = 0;
      let explanation: { input: { ruleId: string; values: Record<string, number | null> } } | undefined;
      await page.route('**/api/sandbox-ai/checkin', async (route) => {
        if (++turns > 1) return route.fulfill({ json: { fallback: true } });
        const { state } = route.request().postDataJSON() as { state: CheckInState };
        await route.fulfill({ json: conversationTurn(state, conversationValues('demo-james')) });
      });
      await page.route('**/api/sandbox-ai/assist', async (route) => {
        explanation = route.request().postDataJSON();
        await route.fulfill({ json: { kind: 'explain_rule', explanation: 'Synthetic explanation fixture; registered findings remain unchanged.' } });
      });
      const area = await openConversation(page, 'demo-maria', 'checkin');
      await area.getByTestId(`checkin-locale-${locale}`).click();
      const input = area.getByLabel('Type your check-in answer');
      await input.fill('First synthetic answer.'); await input.press('Enter');
      await expect(area.getByRole('log')).toContainText(callPromptsFor('daily_checkin', locale).q2_weight.text);
      await input.fill('Second synthetic answer.'); await input.press('Enter');
      await expect(area.getByTestId('sandbox-ai-form')).toBeVisible();
      await fillRequiredFallbackAnswers(page);
      await area.getByLabel(/Weight this morning/).fill('179.5');
      await area.getByLabel(/Breathing today/).selectOption('1');
      await area.getByRole('button', { name: 'Submit check-in' }).click();
      await area.getByTestId('explain-rule-button-weight_gain_5lb_7d').click();
      await expect.poll(() => explanation?.input).toEqual({ ruleId: 'weight_gain_5lb_7d', values: { weightLbs: 179.5, sbp: null, spo2: null, dyspnea: 1 } });
      await expect(area.getByTestId('sandbox-ai-result')).toContainText('Weight gain of 5+ lbs in 1 week detected');
    });
  }

  for (const surface of ['live-call', 'checkin'] as const) {
    for (const exit of ['close', 'change-persona'] as const) {
      test(`${surface} invalidates an in-flight turn on ${exit}`, async ({ page }) => {
        let held: Route | undefined;
        const failed: string[] = [];
        page.on('requestfailed', (request) => { if (request.url().endsWith('/api/sandbox-ai/checkin')) failed.push(request.url()); });
        await page.route('**/api/sandbox-ai/checkin', async (route) => { held = route; });
        const area = await openConversation(page, 'demo-maria', surface);
        if (surface === 'live-call') await area.getByTestId('answer-call').click();
        else await area.getByRole('button', { name: 'Turn assistant voice on' }).click();
        const input = area.getByLabel(surface === 'live-call' ? 'Say something in your own words' : 'Type your check-in answer');
        await input.fill('Synthetic pending answer.'); await input.press('Enter');
        await expect.poll(() => Boolean(held)).toBe(true);
        await expect(input).toBeDisabled();
        const oldTurn = completedConversation((held!.request().postDataJSON() as { state: CheckInState }).state);
        if (exit === 'close') await area.getByRole('button', { name: surface === 'live-call' ? 'End simulated call' : 'Close check-in' }).click();
        const next = await openConversation(page, 'demo-james', surface);
        await expect.poll(() => failed.length).toBe(1);
        // The intercepted response can still be released by the test server;
        // cancellation must keep it out of the new consumer and parent state.
        await held!.fulfill({ json: { ...oldTurn, speech: [{ kind: 'audio', mp3Base64: ENDING_AUDIO }] } });
        await expect(next.getByTestId(surface === 'live-call' ? 'live-call-result' : 'sandbox-ai-result')).toHaveCount(0);
        expect(await page.evaluate(() => JSON.parse(localStorage.getItem('heartland_synthetic_sandbox_v2')!).patientCheckIns)).toEqual([]);
        expect((await conversationMedia(page)).plays.some((src) => src.endsWith(ENDING_AUDIO))).toBe(false);
        if (surface === 'live-call') await expect(next.getByTestId('answer-call')).toBeEnabled();
        else await expect(next.getByLabel('Type your check-in answer')).toBeEnabled();
      });
    }

    test(`${surface} retains local completion after a loaded page loses transport`, async ({ page, context }, testInfo) => {
      const area = await openConversation(page, 'demo-james', surface);
      if (surface === 'live-call') await area.getByTestId('answer-call').click();
      const failed: string[] = [];
      const offlineRequests: Array<{ path: string; events: string[] }> = [];
      page.on('requestfailed', (request) => {
        if (request.url().endsWith('/api/sandbox-ai/checkin')) failed.push(request.url());
        offlineRequests.push({
          path: new URL(request.url()).pathname,
          events: [...new Set(request.postData()?.match(/sandbox_first_action|ai_checkin_started|ai_checkin_completed|ai_checkin_fallback/g) ?? [])],
        });
      });
      // Bypass the generic synthetic fallback response: this request must
      // reach the browser's offline transport and actually reject.
      await page.route('**/api/sandbox-ai/checkin', (route) => route.continue());
      await context.setOffline(true);
      try {
        const input = area.getByLabel(surface === 'live-call' ? 'Say something in your own words' : 'Type your check-in answer');
        await input.fill('Synthetic offline answer.'); await input.press('Enter');
        await expect.poll(() => failed.length).toBe(1);
        if (surface === 'live-call') {
          await expect(input).toHaveCount(0);
          await finishStructuredCall(area, createInitialState('demo-james'));
          await expect(area.getByTestId('live-call-result')).toContainText('Routine');
          await resumeBlockedEnding(page, area);
        } else {
          await expect(area.getByTestId('sandbox-ai-form')).toBeVisible();
          await fillRequiredFallbackAnswers(page);
          await area.getByLabel(/Weight this morning/).fill('188');
          await area.getByRole('button', { name: 'Submit check-in' }).click();
          await expect(area.getByTestId('sandbox-ai-result')).toContainText('Routine');
        }
      } finally {
        await context.setOffline(false);
        await testInfo.attach('offline-request-outcomes', { body: JSON.stringify(offlineRequests), contentType: 'application/json' });
      }
    });
  }

  test('Command Center retains its case identity and does not record a closed pending call', async ({ page }) => {
    let held: Route | undefined;
    await page.route('**/api/sandbox-ai/checkin', async (route) => { held = route; });
    await page.getByTestId('population-run').click();
    const entry = page.locator('[data-testid^="queue-entry-"]').first();
    const ordinal = (await entry.getAttribute('data-testid'))!.replace('queue-entry-', '');
    await entry.click();
    await page.getByTestId(`queue-call-${ordinal}`).click();
    const area = page.getByTestId('sandbox-live-call');
    await area.getByTestId('answer-call').click();
    await area.getByLabel('Say something in your own words').fill('Synthetic case answer.');
    await area.getByRole('button', { name: 'Send typed answer' }).click();
    await expect.poll(() => Boolean(held)).toBe(true);
    const pendingState = (held!.request().postDataJSON() as { state: CheckInState }).state;
    expect(pendingState.patientId).toBe(`pop-${ordinal}-d0`);
    await area.getByRole('button', { name: 'End simulated call' }).click();
    await expect(area).toHaveCount(0);
    await held!.fulfill({ json: { ...applyDeterministicAnswer(pendingState, { chestPainOrSyncope: true }), speech: [{ kind: 'audio', mp3Base64: ENDING_AUDIO }] } });
    await expect(page.getByTestId(`queue-call-${ordinal}`)).toBeEnabled();
    await expect(page.getByTestId(`queue-call-result-${ordinal}`)).toHaveCount(0);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('heartland_synthetic_sandbox_v2')!).workedCases)).toEqual([]);
    expect((await conversationMedia(page)).plays.some((src) => src.endsWith(ENDING_AUDIO))).toBe(false);
  });

  test('Copilot shared audio queue retains manual retry without replaying the round', async ({ page }) => {
    let calls = 0;
    await page.route('**/api/sandbox-ai/simulate-call', async (route) => {
      calls += 1;
      // Preserve this named, rule-derived fixture; do not rename it to imply
      // that a different scenario or a fresh model-generated call was tested.
      const fixture = OUTREACH_TRANSCRIPTS.find((item) => item.id === 'call-james-stable')!;
      await route.fulfill({ json: { transcript: { ...fixture, id: `ai-run-hook${calls}`, audioSrc: undefined } } });
    });
    await page.route('**/api/sandbox-ai/assist', async (route) => {
      expect(route.request().postDataJSON().kind).toBe('morning_brief');
      await route.fulfill({ json: { kind: 'morning_brief', brief: 'Synthetic known-fixture summary for the audio consumer regression.', mp3Base64: ENDING_AUDIO } });
    });
    await page.getByTestId('sandbox-nav-copilot').click();
    const area = page.getByTestId('sandbox-copilot');
    expect(calls).toBe(0);
    await area.getByTestId('run-morning-round').click();
    await expect(area.getByTestId('copilot-brief')).toContainText('Synthetic known-fixture summary');
    expect(calls).toBe(SIMULATED_CALL_SCENARIOS.length);
    await resumeBlockedEnding(page, area, 'Play the spoken brief');
    expect(calls).toBe(SIMULATED_CALL_SCENARIOS.length);
    await expect(area.getByTestId('advance-day')).toBeEnabled();
  });
});
