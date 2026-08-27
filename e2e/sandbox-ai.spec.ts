import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

// SANDBOX_AI_ENABLED=false in the e2e web server: every flow below exercises
// the deterministic fallback path; no LLM vendor call is ever made.

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

test('check-in degrades to the deterministic form and escalates by the registered weight rules', async ({ page }) => {
  await reachFallbackForm(page);

  await page.getByLabel(/Weight this morning/).fill('179.5');
  await page.getByRole('button', { name: 'Submit check-in' }).click();

  const result = page.getByTestId('sandbox-ai-result');
  await expect(result).toContainText('Escalated to human review');
  await expect(result).toContainText('Weight gain of 3+ lbs in 2 days detected');
  await expect(result).toContainText('Weight gain of 5+ lbs in 1 week detected');
  await expect(result).toContainText('never by the AI');
  await expect(page.getByRole('log')).toContainText("care plan's preset rules");
});

test('a stable report stays routine and the task completes in the tour', async ({ page }) => {
  await reachFallbackForm(page);

  // Maria's synthetic trend: 176 lbs is +0.8 vs yesterday and +4.2 vs 5 days
  // ago — below both thresholds, so the deterministic outcome is routine.
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
  for (const asset of ['/outreach-audio/prompts/intro.mp3', '/outreach-audio/call-maria-redflag.mp3']) {
    const response = await request.get(asset, { maxRedirects: 0 });
    expect(response.status(), asset).toBe(200);
    expect(response.headers()['content-type'], asset).toContain('audio');
  }
});

test('the live call supports hands-free voice answers with server-provided speech', async ({ page }) => {
  // Deterministic browser stubs: instant audio playback and a scriptable
  // SpeechRecognition. No real mic, no real speech service.
  await page.addInitScript(() => {
    HTMLMediaElement.prototype.play = function play() {
      setTimeout(() => this.dispatchEvent(new Event('ended')), 0);
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
    const body = route.request().postDataJSON() as { state: { phase: string }; wantSpeech?: boolean };
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
        state: { ...body.state, phase: 'q2_weight', turnCount: 1 },
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
  await openCheckIn(page);
  await expect(page.locator('body')).not.toContainText(/clinical decision support/i);
  await expect(page.locator('body')).not.toContainText(/AI (triage|diagnos)/i);

  await page.getByTestId('sandbox-nav-outreach').click();
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
