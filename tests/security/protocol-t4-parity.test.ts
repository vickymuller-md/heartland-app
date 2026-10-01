// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { PROTOCOL_CONTENT, PROTOCOL_CONTENT_HASH } from '@/lib/sandbox-ai/protocol-content.generated';

const source = readFileSync(new URL('../../reference/clinical_content.md', import.meta.url), 'utf8');
describe('Toolkit T4 corrections propagated to protocol reference', () => {
  it('retains the September 30 corrections without overstating the evidence', () => {
    expect(source).toContain('stages 0-1 combined');
    expect(source).toContain('10.1016/j.ajpc.2025.101339');
    expect(source).toContain('53.1 percentage points');
    expect(source).toContain('83 of 103 planned phone visits');
    expect(source).toContain('not evidence of equivalence');
    expect(source).toContain('open-label spironolactone comparator');
    expect(source).not.toContain('There is no head-to-head trial');
    expect(source).not.toContain('Reduces CV death & HF hospitalization');
  });
  it('ships exactly the reference text, not a stale embedded copy', () => {
    expect(PROTOCOL_CONTENT).toBe(source);
    expect(PROTOCOL_CONTENT_HASH).toBe(createHash('sha256').update(source).digest('hex').slice(0, 16));
  });
  it('does not recast WATCH-DM incident hospitalization as HEARTLAND readmission validation', () => {
    expect(source).toContain('no HF at baseline');
    expect(source).toContain('first HF hospitalization over five years');
    expect(source).toContain('does not validate the HEARTLAND score');
    expect(source).not.toContain('Social deprivation indices predict HF readmission');
  });
  it('preserves stepwise finerenone titration and the indication-specific renal exception', () => {
    expect(source).toContain("At the label's 4-week decision point: current 10 mg -> 20 mg daily");
    expect(source).toContain('If eGFR has fallen >30% from the previous measurement, maintain instead of increasing');
    expect(source).toContain("footnote to the label's ≥6.0 row");
    expect(source).toContain('not a single universal restart cutoff');
    expect(source).toContain('This footnote does not cancel the potassium-based dose-reduction or withholding instructions');
    expect(source).not.toContain('**maintained, not stopped**');
    expect(source).toContain('Finerenone: use the HF label table and renal-function warning, not this generic gate');
    expect(source).not.toContain('INCREASE to the target dose band');
  });
  it('limits ASM participation and corrects the supporting DeVore reference', () => {
    expect(source).toContain('mandatory for **selected specialists**');
    expect(source).toContain('not for every rural hospital');
    expect(source).toContain('1 January 2027 through 31 December 2031');
    expect(source).toContain('DeVore et al., *JAMA Cardiology* 2020, doi:10.1001/jamacardio.2019.4665');
  });
  it('distinguishes assistance end date from enrollment cutoff', () => {
    expect(source).toContain('assistance UNTIL 31 December 2026, not new enrollment through that date');
    expect(source).not.toContain('patients enrolled by 31 December 2026 continue');
  });
});
