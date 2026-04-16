/**
 * Track B: 7-Day Paper Monitoring Diary
 * Requirement: TRKB-01
 * Source: HEARTLAND Protocol v3.3 Module 5 -- Analog Track
 *
 * Printable diary grid for Track B (analog) patients.
 * Uses native HTML <table> for reliable Safari print column alignment.
 * All text text-lg (18px) minimum per VITL-08 elderly UX requirement.
 */

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

const COLUMNS = [
  'Date',
  'Morning Weight (lbs)',
  'Blood Pressure (Sys/Dia)',
  'Heart Rate',
  'Shortness of Breath',
  'Ankle Swelling',
  'Fatigue',
  'Orthopnea (slept on extra pillows?)',
  'Notes',
] as const;

interface TrackBDiaryProps {
  patientName: string;
}

export default function TrackBDiary({ patientName }: TrackBDiaryProps) {
  return (
    <div>
      <h2 className="text-xl font-bold text-center mb-1">
        HEARTLAND Protocol &mdash; Daily Monitoring Diary
      </h2>
      <p className="text-lg text-center mb-1">
        Patient: <strong>{patientName}</strong>
      </p>
      <p className="text-lg text-center text-gray-600 mb-4">
        Record your daily measurements. Call your clinic if you see warning signs.
      </p>

      <table
        className="w-full"
        style={{ borderCollapse: 'collapse' }}
      >
        <thead>
          <tr>
            {COLUMNS.map((col) => (
              <th
                key={col}
                className="text-lg font-semibold border border-gray-400 px-2 py-1 text-left bg-gray-50"
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {DAYS.map((day) => (
            <tr key={day}>
              <td
                className="text-lg border border-gray-400 px-2 py-1 font-medium"
                style={{ height: '3rem' }}
              >
                {day}
              </td>
              {/* Remaining columns are blank for handwriting */}
              {Array.from({ length: COLUMNS.length - 1 }).map((_, i) => (
                <td
                  key={i}
                  className="text-lg border border-gray-400 px-2 py-1"
                  style={{ height: '3rem' }}
                />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
