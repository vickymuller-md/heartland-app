import Link from 'next/link';

/**
 * SetupPrompt -- CTA card shown on patient detail page when setup is incomplete
 * Requirements: ONBD-01
 * Source: HEARTLAND Protocol v3.3 -- Phase 20 Patient Onboarding Wizard
 *
 * Renders an amber banner with "Complete Setup" link to the onboarding wizard.
 * Returns null when setup is already complete.
 */

interface SetupPromptProps {
  patientId: string;
  setupComplete: boolean;
}

export function SetupPrompt({ patientId, setupComplete }: SetupPromptProps) {
  if (setupComplete) return null;

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 flex items-center justify-between">
      <div>
        <p className="text-sm font-medium text-amber-800">Setup incomplete</p>
        <p className="text-xs text-amber-700 mt-0.5">
          Complete the onboarding wizard to fully configure this patient.
        </p>
      </div>
      <Link
        href={`/patients/${patientId}/onboarding`}
        className="shrink-0 rounded-md bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700"
      >
        Complete Setup
      </Link>
    </div>
  );
}
