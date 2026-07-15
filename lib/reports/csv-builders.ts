/**
 * HEARTLAND Reports & Data Export -- CSV Builder Functions
 *
 * Pure functions for building CSV data arrays and triggering downloads.
 * All functions are testable without Supabase dependency.
 *
 * Requirements: REPT-03 (CSV export with RFC 4180 quoting and privacy-minimizing transformations)
 * Source: HEARTLAND Protocol v3.3 -- Phase 21
 */

import type {
  DeidentifyOptions,
  LabResultRow,
  MedLogRow,
  VitalsRow,
} from './types';

// ---------- Year-Only Date Reduction ----------

/**
 * Reduce an ISO date/timestamp string to year only. Removing date elements
 * except year is one transformation described in the HIPAA Safe Harbor method
 * at 45 CFR 164.514(b)(2)(i)(C), but this function does not evaluate the other
 * identifiers or independently establish de-identification or HIPAA compliance.
 * Uses string slicing (not Date constructor) to avoid timezone off-by-one.
 */
export function truncateToYear(dateString: string | null | undefined): string {
  if (!dateString) return '';
  return dateString.slice(0, 4);
}

// ---------- Core CSV Utilities ----------

/**
 * Convert a 2D string array to RFC 4180-compliant CSV string.
 * Each cell is wrapped in double quotes; internal quotes are doubled.
 * Null/undefined cells are treated as empty strings.
 */
export function arrayToCSV(rows: string[][]): string {
  return rows
    .map((row) =>
      row
        .map((cell) => {
          const value = cell == null ? '' : String(cell);
          // Escape internal double quotes by doubling them
          const escaped = value.replace(/"/g, '""');
          return `"${escaped}"`;
        })
        .join(',')
    )
    .join('\n');
}

/**
 * Trigger a CSV file download in the browser.
 * SSR-safe: returns early if window is undefined.
 */
export function downloadCSV(filename: string, rows: string[][]): void {
  if (typeof window === 'undefined') return;

  const csvContent = arrayToCSV(rows);
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const anchor = document.createElement('a');
  anchor.setAttribute('href', url);
  anchor.setAttribute('download', filename);
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

// ---------- Identifier Substitution Helper ----------

function deidentifyId(
  patientId: string,
  opts: DeidentifyOptions
): string {
  if (!opts.deidentify) return patientId;
  if (opts.patientMap) {
    return opts.patientMap.get(patientId) ?? 'P?';
  }
  return 'P?';
}

// ---------- CSV Builders ----------

/**
 * Build vitals CSV data with header row.
 * Columns: patient_id, recorded_at, weight_lbs, sbp, dbp, heart_rate, spo2
 */
export function buildVitalsCSV(
  vitals: VitalsRow[],
  opts: DeidentifyOptions
): string[][] {
  const header = [
    'patient_id',
    'recorded_at',
    'weight_lbs',
    'sbp',
    'dbp',
    'heart_rate',
    'spo2',
  ];

  const dataRows = vitals.map((v) => [
    deidentifyId(v.patient_id, opts),
    v.recorded_at ? (opts.deidentify ? truncateToYear(v.recorded_at) : v.recorded_at) : '',
    v.weight_lbs != null ? String(v.weight_lbs) : '',
    v.sbp != null ? String(v.sbp) : '',
    v.dbp != null ? String(v.dbp) : '',
    v.heart_rate != null ? String(v.heart_rate) : '',
    v.spo2 != null ? String(v.spo2) : '',
  ]);

  return [header, ...dataRows];
}

/**
 * Build labs CSV data with header row.
 * Columns: patient_id, test_name, value, unit, collected_at, flag
 */
export function buildLabsCSV(
  labs: LabResultRow[],
  opts: DeidentifyOptions
): string[][] {
  const header = [
    'patient_id',
    'test_name',
    'value',
    'unit',
    'collected_at',
    'flag',
  ];

  const dataRows = labs.map((l) => [
    deidentifyId(l.patient_id, opts),
    l.test_name ?? '',
    l.value != null ? String(l.value) : '',
    l.unit ?? '',
    l.collected_at ? (opts.deidentify ? truncateToYear(l.collected_at) : l.collected_at) : '',
    l.flag ?? '',
  ]);

  return [header, ...dataRows];
}

/**
 * Build medications CSV data with header row.
 * Columns: patient_id, medication_name, dose, frequency, taken_at, taken
 */
export function buildMedsCSV(
  meds: MedLogRow[],
  opts: DeidentifyOptions
): string[][] {
  const header = [
    'patient_id',
    'medication_name',
    'dose',
    'frequency',
    'taken_at',
    'taken',
  ];

  const dataRows = meds.map((m) => [
    deidentifyId(m.patient_id, opts),
    m.medication_name ?? '',
    m.dose ?? '',
    m.frequency ?? '',
    m.taken_at ? (opts.deidentify ? truncateToYear(m.taken_at) : m.taken_at) : '',
    String(m.taken ?? ''),
  ]);

  return [header, ...dataRows];
}
