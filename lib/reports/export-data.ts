import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getMedicationScheduleHistory } from '@/lib/medications/queries';
import { medicationScheduleOn } from '@/lib/medications/schedule';
import { labCollectionMicros } from '@/lib/labs/quality';
import { reportDateBounds } from './date-range';
import { readReportRows } from './rows';
import type { MedLogRow, ReportDateRange, VitalsRow } from './types';

export async function getReportVitals(client: SupabaseClient, patientIds: string[], range: ReportDateRange): Promise<VitalsRow[]> {
  const { fromInclusive, toExclusive } = reportDateBounds(range);
  const rows: Array<VitalsRow & { id: string }> = [];
  for (let i = 0; i < patientIds.length; i += 100) {
    rows.push(...await readReportRows(() => client.from('vitals')
      .select('id, patient_id, recorded_at, weight_lbs, sbp, dbp, heart_rate, spo2')
      .in('patient_id', patientIds.slice(i, i + 100))
      .gte('recorded_at', fromInclusive).lt('recorded_at', toExclusive)));
  }
  return rows.sort((a, b) => {
    const first = labCollectionMicros(a.recorded_at);
    const second = labCollectionMicros(b.recorded_at);
    if (first === null || second === null) throw new Error('Vital timestamp unavailable.');
    if (first === second) return a.id.localeCompare(b.id);
    return first > second ? -1 : 1;
  });
}

export async function getReportMedicationLogs(client: SupabaseClient, patientIds: string[], range: ReportDateRange): Promise<MedLogRow[]> {
  reportDateBounds(range);
  const rows: MedLogRow[] = [];
  for (let i = 0; i < patientIds.length; i += 100) {
    const scope = patientIds.slice(i, i + 100);
    const [logs, history] = await Promise.all([
      readReportRows(() => client.from('medication_logs')
        .select('id, patient_id, medication_id, scheduled_date, dose_number, taken_at, taken, calendar_time_zone, calendar_source')
        .in('patient_id', scope).gte('scheduled_date', range.from).lte('scheduled_date', range.to)),
      getMedicationScheduleHistory(client, scope, range.from, range.to),
    ]);
    for (const log of logs) {
      const medication = medicationScheduleOn(history, log.medication_id, log.scheduled_date);
      rows.push({
        patient_id: log.patient_id,
        medication_name: medication?.name ?? '',
        dose: medication?.dosage ?? '',
        frequency: medication?.frequency ?? '',
        scheduled_date: log.scheduled_date,
        dose_number: log.dose_number,
        taken_at: log.taken_at,
        taken: log.taken,
        schedule_recorded: Boolean(medication),
        calendar_time_zone: log.calendar_time_zone,
        calendar_source: log.calendar_source,
      });
    }
  }
  return rows.sort((a, b) => b.scheduled_date.localeCompare(a.scheduled_date)
    || a.patient_id.localeCompare(b.patient_id) || a.medication_name.localeCompare(b.medication_name) || a.dose_number - b.dose_number);
}
