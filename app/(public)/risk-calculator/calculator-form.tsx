'use client';

import { useActionState, useState } from 'react';
import { Printer, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PatientSelector, type SelectedPatientData } from '@/components/shared/patient-selector';
import { saveRiskScore } from '@/lib/integration/actions';
import { RISK_VARIABLES } from '@/lib/risk-score/constants';
import { calculateRiskScore } from '@/lib/risk-score/engine';
import { riskInputSchema, RISK_FRAMEWORK_VERSION } from '@/lib/risk-score/schema';
import type { RiskInput } from '@/lib/risk-score/types';
import { PrintHeader } from './print-header';
import { ResultCard } from './result-card';
import { ScoreBreakdown } from './score-breakdown';

const categories = ['Clinical', 'Laboratory', 'Cardiac', 'Comorbidity', 'Social/Geographic'] as const;

export function CalculatorForm({ actorId }: { actorId?: string }) {
  const [patient, setPatient] = useState<SelectedPatientData['patient'] | null>(null);
  return (
    <div>
      <PrintHeader />
      {actorId && (
        <div className="mb-6 print:hidden">
          <h2 className="mb-2 font-semibold">Patient record</h2>
          <PatientSelector expectedActorId={actorId} onSelect={(data) => setPatient(data.patient)} selectedPatient={patient} onClear={() => setPatient(null)} />
        </div>
      )}
      <Assessment key={JSON.stringify([actorId, patient?.id])} actorId={actorId} patient={patient} />
    </div>
  );
}

function Assessment({ actorId, patient }: { actorId?: string; patient: SelectedPatientData['patient'] | null }) {
  const [answers, setAnswers] = useState<Partial<RiskInput>>({});
  const [example, setExample] = useState(false);
  const [requestId, setRequestId] = useState('');
  const [receipt, saveAction, saving] = useActionState(saveRiskScore, null);
  const parsed = riskInputSchema.safeParse(answers);
  const result = parsed.success ? calculateRiskScore(parsed.data) : null;
  const completed = Object.keys(answers).length;
  const currentReceipt = receipt?.requestId === requestId ? receipt : null;

  function replaceAnswers(next: Partial<RiskInput>) {
    setAnswers(next);
    setRequestId(crypto.randomUUID());
  }

  function loadExample() {
    setExample(true);
    replaceAnswers(Object.fromEntries(RISK_VARIABLES.map(({ key }) => [key, key === 'ageOver75' || key === 'priorHfHospitalization'])));
  }

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
      <div className="min-w-0 print:hidden" data-testid="toggle-section">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Risk variables</h2>
          <div className="flex flex-wrap gap-2">
            {!actorId && <Button variant="outline" size="sm" onClick={loadExample}>Load synthetic example</Button>}
            <Button variant="outline" size="sm" disabled={!result || saving} onClick={() => window.print()}><Printer /> Print</Button>
            <Button variant="outline" size="sm" disabled={!completed || saving} onClick={() => { setExample(false); replaceAnswers({}); }}><RotateCcw /> Reset all</Button>
          </div>
        </div>
        {categories.map(category => (
          <section key={category} className="mb-6">
            <h3 className="mb-2 font-semibold">{category}</h3>
            <div className="space-y-3">
              {RISK_VARIABLES.filter(v => v.category === category).map(v => (
                <fieldset key={v.key} className="min-w-0 rounded-lg border p-3" disabled={saving}>
                  <legend className="px-1 text-sm font-semibold">{v.label}</legend>
                  <p className="mb-2 text-sm text-muted-foreground">{v.description} · +{v.points} pts</p>
                  <div className="flex flex-wrap gap-2">
                    {[true, false].map(choice => (
                      <label key={String(choice)} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm has-checked:border-slate-700 has-checked:bg-slate-100">
                        <input type="radio" name={v.key} checked={answers[v.key] === choice}
                          onChange={() => replaceAnswers({ ...answers, [v.key]: choice })} />
                        {choice ? 'Present' : 'Absent'}
                      </label>
                    ))}
                  </div>
                </fieldset>
              ))}
            </div>
          </section>
        ))}
      </div>
      <div className="min-w-0 lg:sticky lg:top-6 lg:self-start">
        {example && <p className="mb-3 font-semibold text-indigo-800">Synthetic example</p>}
        <p role="status" className="mb-3 text-sm">{completed} of {RISK_VARIABLES.length} factors reviewed</p>
        {result ? <>
          <ResultCard result={result} allowExplanation={!actorId} />
          <div className="mt-6"><ScoreBreakdown breakdown={result.breakdown} /></div>
        </> : (
          <section className="rounded-xl border bg-white p-5" aria-label="Assessment pending">
            <h2 className="font-semibold">Assessment pending</h2>
            <p className="mt-2 text-sm">Select Present or Absent for each assessed factor. Leave an unknown factor unanswered.</p>
          </section>
        )}
        {actorId && patient && result && !example && (
          <form action={saveAction} className="mt-4 print:hidden">
            <input type="hidden" name="patientId" value={patient.id} />
            <input type="hidden" name="actorId" value={actorId} />
            <input type="hidden" name="requestId" value={requestId} />
            <input type="hidden" name="version" value={RISK_FRAMEWORK_VERSION} />
            <input type="hidden" name="inputs" value={JSON.stringify(answers)} />
            <Button type="submit" disabled={saving || currentReceipt?.success}>{saving ? 'Saving…' : `Save assessment to ${patient.full_name}`}</Button>
            {currentReceipt && <p role="status" className="mt-2 text-sm">{currentReceipt.success ? 'Assessment saved to the patient record.' : currentReceipt.error}</p>}
          </form>
        )}
      </div>
    </div>
  );
}
