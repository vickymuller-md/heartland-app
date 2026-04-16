'use client';

import { CheckCircle2, Circle } from 'lucide-react';

interface TodayTasksProps {
  vitalsLogged: boolean;
  medsTaken: number;
  medsTotal: number;
  educationRemaining: number;
}

export function TodayTasksChecklist({
  vitalsLogged,
  medsTaken,
  medsTotal,
  educationRemaining,
}: TodayTasksProps) {
  const vitalsComplete = vitalsLogged;
  const medsComplete = medsTotal === 0 || medsTaken >= medsTotal;
  const educationComplete = educationRemaining === 0;

  function medsDetail(): string {
    if (medsTotal === 0) return 'No medications set up';
    if (medsTaken >= medsTotal) return 'All taken';
    return `${medsTaken} of ${medsTotal} taken`;
  }

  function educationDetail(): string {
    if (educationRemaining === 0) return 'All modules complete';
    return `${educationRemaining} module(s) remaining`;
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <h2 className="text-base font-semibold text-gray-900 mb-3">
        Today&apos;s Tasks
      </h2>
      <ul className="space-y-2">
        {/* Task 1: Daily check-in (vitals) */}
        <li className="flex items-center gap-3 min-h-[48px]">
          {vitalsComplete ? (
            <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0" />
          ) : (
            <Circle className="h-5 w-5 text-gray-400 shrink-0" />
          )}
          <div>
            <p className="text-base font-medium text-gray-900">
              Daily check-in
            </p>
            <p className="text-sm text-gray-500">
              {vitalsComplete ? 'Done' : 'Not logged yet'}
            </p>
          </div>
        </li>

        {/* Task 2: Medications */}
        <li className="flex items-center gap-3 min-h-[48px]">
          {medsComplete ? (
            <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0" />
          ) : (
            <Circle className="h-5 w-5 text-gray-400 shrink-0" />
          )}
          <div>
            <p className="text-base font-medium text-gray-900">Medications</p>
            <p className="text-sm text-gray-500">{medsDetail()}</p>
          </div>
        </li>

        {/* Task 3: Education */}
        <li className="flex items-center gap-3 min-h-[48px]">
          {educationComplete ? (
            <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0" />
          ) : (
            <Circle className="h-5 w-5 text-gray-400 shrink-0" />
          )}
          <div>
            <p className="text-base font-medium text-gray-900">Education</p>
            <p className="text-sm text-gray-500">{educationDetail()}</p>
          </div>
        </li>
      </ul>
    </div>
  );
}
