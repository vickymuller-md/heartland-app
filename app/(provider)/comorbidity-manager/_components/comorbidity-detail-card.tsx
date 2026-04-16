import type { ComorbidityDetail } from '@/lib/comorbidity/types';

interface ComorbidityDetailCardProps {
  comorbidity: ComorbidityDetail;
}

export function ComorbidityDetailCard({
  comorbidity,
}: ComorbidityDetailCardProps) {
  return (
    <div className="rounded-lg border-l-4 border-l-amber-400 border border-gray-200 bg-white p-4 shadow-sm">
      <h3 className="text-base font-semibold text-gray-900">
        {comorbidity.label}
      </h3>

      <div className="mt-3 space-y-3 text-sm">
        <div>
          <p className="font-medium text-gray-700">Key Considerations</p>
          <p className="mt-0.5 text-gray-600">
            {comorbidity.keyConsiderations}
          </p>
        </div>

        <div>
          <p className="font-medium text-gray-700">What To Do</p>
          <p className="mt-0.5 text-gray-600">{comorbidity.whatToDo}</p>
        </div>

        <div>
          <p className="font-medium text-gray-700">GDMT Interactions</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-gray-600">
            {comorbidity.gdmtInteractions.map((interaction) => (
              <li key={interaction}>{interaction}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
