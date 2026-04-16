import Link from 'next/link';
import { COMORBIDITY_DATA } from '@/lib/comorbidity/constants';
import type { ComorbidityKey, ComorbidityDetail } from '@/lib/comorbidity/types';

interface ComorbidityTabProps {
  comorbidities: string[];
  patientId: string;
}

export function ComorbidityTab({ comorbidities, patientId }: ComorbidityTabProps) {
  if (comorbidities.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-gray-300 p-6 text-center">
        <p className="text-sm text-gray-500">No comorbidities recorded.</p>
        <Link
          href={`/comorbidity-manager?patientId=${patientId}`}
          className="mt-2 inline-block text-sm font-medium text-blue-600 hover:text-blue-700"
        >
          Add comorbidities in Comorbidity Manager
        </Link>
      </div>
    );
  }

  const keys = comorbidities as ComorbidityKey[];
  const dataMap = new Map<ComorbidityKey, ComorbidityDetail>(
    COMORBIDITY_DATA.map((c) => [c.key, c]),
  );

  const matched = keys
    .map((k) => dataMap.get(k))
    .filter((c): c is ComorbidityDetail => c !== undefined);

  return (
    <div className="space-y-4">
      {matched.map((c) => (
        <div
          key={c.key}
          className="rounded-lg border-l-4 border-l-amber-400 border border-gray-200 bg-white p-4 shadow-sm"
        >
          <h3 className="text-base font-semibold text-gray-900">{c.label}</h3>
          <div className="mt-3 space-y-3 text-sm">
            <div>
              <p className="font-medium text-gray-700">Key Considerations</p>
              <p className="mt-0.5 text-gray-600">{c.keyConsiderations}</p>
            </div>
            <div>
              <p className="font-medium text-gray-700">What To Do</p>
              <p className="mt-0.5 text-gray-600">{c.whatToDo}</p>
            </div>
            <div>
              <p className="font-medium text-gray-700">GDMT Interactions</p>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-gray-600">
                {c.gdmtInteractions.map((interaction) => (
                  <li key={interaction}>{interaction}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      ))}

      <Link
        href={`/comorbidity-manager?patientId=${patientId}`}
        className="inline-block text-sm font-medium text-blue-600 hover:text-blue-700"
      >
        Update in Comorbidity Manager
      </Link>
    </div>
  );
}
