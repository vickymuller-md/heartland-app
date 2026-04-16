/**
 * TaskShiftingTable -- Server Component
 * Requirement: DSCH-02 (8-task x 3-column matrix)
 *
 * Renders the task-shifting framework table showing how each discharge
 * task can be handled by different staffing configurations.
 *
 * Source: HEARTLAND Protocol v3.3 Module 4, Section 4.2
 */

import { TASK_SHIFTING_ROWS } from '@/lib/discharge/constants';

export function TaskShiftingTable() {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5 print:break-inside-avoid">
      <h2 className="mb-4 text-lg font-semibold text-gray-900">
        Task-Shifting Framework
      </h2>

      <div className="overflow-x-auto">
        <table className="w-full text-sm" data-testid="task-shifting-table">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="sticky left-0 bg-white py-2 pr-4 text-left font-semibold text-slate-700">
                Task
              </th>
              <th className="py-2 px-4 text-left font-semibold text-slate-700">
                Optimal
              </th>
              <th className="py-2 px-4 text-left font-semibold text-slate-700">
                Alternatives
              </th>
              <th className="py-2 px-4 text-left font-semibold text-slate-700">
                No-CHW Setting
              </th>
            </tr>
          </thead>
          <tbody>
            {TASK_SHIFTING_ROWS.map((row, index) => (
              <tr
                key={row.id}
                className={`border-b border-gray-100 ${
                  index % 2 === 1 ? 'bg-slate-50' : ''
                }`}
                data-testid={`task-row-${row.id}`}
              >
                <td className="sticky left-0 bg-inherit py-2.5 pr-4 font-medium text-gray-900">
                  {row.task}
                </td>
                <td className="py-2.5 px-4 text-gray-700">{row.optimal}</td>
                <td className="py-2.5 px-4 text-gray-700">
                  {row.alternatives}
                </td>
                <td className="py-2.5 px-4 text-gray-700">{row.no_chw}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
