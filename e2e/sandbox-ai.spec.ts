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
  await expect(page.getByTestId('sandbox-sbar-draft').getByLabel('Situation')).toHaveValue('Polished situation.');
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
