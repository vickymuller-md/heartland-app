import type { SafetyGateResult, TitrationAction, MedicationEntry } from '@/lib/titration/types';

interface PrintLayoutProps {
  patientName?: string;
  vitals: {
    sbp: number;
    hr: number;
    potassium: number;
    creatinine: number;
    creatinineBaseline?: number;
  };
  medications: MedicationEntry[];
  safetyGateResults: SafetyGateResult[];
  titrationAction: TitrationAction;
  providerNotes: string;
  followUpPlan: {
    nextCallDate?: string;
    notes?: string;
  };
  timestamp: Date;
}

export function PrintLayout({
  patientName,
  vitals,
  medications,
  safetyGateResults,
  titrationAction,
  providerNotes,
  followUpPlan,
  timestamp,
}: PrintLayoutProps) {
  return (
    <div className="hidden print:block" data-testid="print-layout">
      <div className="p-8 text-sm">
        {/* Header */}
        <h1 className="text-xl font-bold mb-1">HEARTLAND Telephone Titration Checklist</h1>
        {patientName && (
          <p className="text-sm font-medium text-gray-800 mb-1">Patient: {patientName}</p>
        )}
        <p className="text-xs text-gray-500 mb-4">
          Generated: {timestamp.toLocaleString()}
        </p>

        {/* Disclaimer */}
        <p className="text-xs italic border p-2 mb-6">
          This tool is designed for healthcare professionals as a clinical decision support resource.
          It does not provide medical diagnoses, treatment recommendations for individual patients,
          or replace clinical judgment. Not intended for direct patient care. For professional use only.
        </p>

        {/* Section 1: Pre-Call Vitals */}
        <h2 className="font-semibold mt-4 mb-2 border-b pb-1">Pre-Call Vitals</h2>
        <table className="w-full text-sm mb-4">
          <tbody>
            <tr>
              <td className="py-1 font-medium w-48">Systolic BP:</td>
              <td>{vitals.sbp} mmHg</td>
            </tr>
            <tr>
              <td className="py-1 font-medium">Heart Rate:</td>
              <td>{vitals.hr} bpm</td>
            </tr>
            <tr>
              <td className="py-1 font-medium">Potassium:</td>
              <td>{vitals.potassium} mEq/L</td>
            </tr>
            <tr>
              <td className="py-1 font-medium">Creatinine:</td>
              <td>{vitals.creatinine} mg/dL</td>
            </tr>
            {vitals.creatinineBaseline && (
              <tr>
                <td className="py-1 font-medium">Baseline Creatinine:</td>
                <td>{vitals.creatinineBaseline} mg/dL</td>
              </tr>
            )}
          </tbody>
        </table>

        {/* Section 2: Medications */}
        <h2 className="font-semibold mt-4 mb-2 border-b pb-1">Current Medications</h2>
        {medications.length > 0 ? (
          <table className="w-full text-sm mb-4">
            <thead>
              <tr className="border-b">
                <th className="py-1 text-left font-medium">Medication</th>
                <th className="py-1 text-left font-medium">Current Dose</th>
              </tr>
            </thead>
            <tbody>
              {medications.map((med, i) => (
                <tr key={i}>
                  <td className="py-1">{med.name || '(unnamed)'}</td>
                  <td className="py-1">{med.currentDose || '(not specified)'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-sm mb-4 text-gray-500">No medications listed.</p>
        )}

        {/* Section 3: Safety Gate Assessment */}
        <h2 className="font-semibold mt-4 mb-2 border-b pb-1">Safety Gate Assessment</h2>
        <table className="w-full text-sm mb-4">
          <thead>
            <tr className="border-b">
              <th className="py-1 text-left font-medium">Parameter</th>
              <th className="py-1 text-left font-medium">Value</th>
              <th className="py-1 text-left font-medium">Status</th>
              <th className="py-1 text-left font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            {safetyGateResults.map((result) => (
              <tr key={result.parameter}>
                <td className="py-1">{result.parameter}</td>
                <td className="py-1">{result.value}</td>
                <td className="py-1">
                  <span
                    className={
                      result.status === 'blocked'
                        ? 'font-bold text-red-700'
                        : result.status === 'warning'
                        ? 'font-medium text-yellow-700'
                        : 'text-green-700'
                    }
                  >
                    {result.status.toUpperCase()}
                  </span>
                </td>
                <td className="py-1">{result.action}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Section 4: Titration Decision */}
        <h2 className="font-semibold mt-4 mb-2 border-b pb-1">Titration Decision</h2>
        <p className="mb-1">
          <span className="font-medium">Recommendation:</span>{' '}
          <span className="font-bold uppercase">{titrationAction.action}</span>
        </p>
        <p className="text-sm mb-2">{titrationAction.details}</p>
        {providerNotes && (
          <div className="mt-2">
            <p className="font-medium text-sm">Provider Notes:</p>
            <p className="text-sm border-l-2 border-gray-300 pl-2 mt-1">{providerNotes}</p>
          </div>
        )}

        {/* Section 5: Follow-Up Plan */}
        <h2 className="font-semibold mt-4 mb-2 border-b pb-1">Follow-Up Plan</h2>
        <table className="w-full text-sm">
          <tbody>
            <tr>
              <td className="py-1 font-medium w-48">Next Call Date:</td>
              <td>{followUpPlan.nextCallDate || 'Not scheduled'}</td>
            </tr>
            {followUpPlan.notes && (
              <tr>
                <td className="py-1 font-medium">Notes:</td>
                <td>{followUpPlan.notes}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
