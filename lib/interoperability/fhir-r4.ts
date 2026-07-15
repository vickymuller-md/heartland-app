interface FhirResource {
  resourceType: string;
  id?: string;
  [key: string]: unknown;
}

interface VitalRow {
  id: string;
  recorded_at: string;
  weight_lbs: number | null;
  sbp: number | null;
  dbp: number | null;
  heart_rate: number | null;
  spo2: number | null;
}

interface LabRow {
  id: string;
  collected_at: string;
  potassium: number | null;
  creatinine: number | null;
  egfr: number | null;
  sodium: number | null;
}

interface MedicationRow {
  id: string;
  name: string;
  dosage: string | null;
  frequency: string | null;
  timing: string | null;
  active: boolean | null;
  created_at: string | null;
}

function coding(system: string, code: string, display: string) {
  return { coding: [{ system, code, display }], text: display };
}

function quantity(value: number, unit: string, code: string) {
  return { value, unit, system: 'http://unitsofmeasure.org', code };
}

function observation(
  id: string,
  patientId: string,
  effectiveDateTime: string,
  code: ReturnType<typeof coding>,
  valueQuantity: ReturnType<typeof quantity>,
): FhirResource {
  return {
    resourceType: 'Observation',
    id,
    status: 'final',
    category: [coding('http://terminology.hl7.org/CodeSystem/observation-category', 'vital-signs', 'Vital Signs')],
    code,
    subject: { reference: `Patient/${patientId}` },
    effectiveDateTime,
    valueQuantity,
  };
}
export function buildFhirR4Collection(input: {
  patient: { id: string; fullName: string; patientCode: string | null };
  vitals: VitalRow[];
  labs: LabRow[];
  medications: MedicationRow[];
  generatedAt?: string;
}) {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const nameParts = input.patient.fullName.trim().split(/\s+/);
  const patient: FhirResource = {
    resourceType: 'Patient',
    id: input.patient.id,
    identifier: input.patient.patientCode ? [{ system: 'https://app.heartlandprotocol.org/identifier/patient-code', value: input.patient.patientCode }] : undefined,
    name: [{ use: 'usual', text: input.patient.fullName, family: nameParts.at(-1), given: nameParts.slice(0, -1) }],
  };
  const resources: FhirResource[] = [patient];

  for (const vital of input.vitals) {
    if (vital.weight_lbs !== null) resources.push(observation(`weight-${vital.id}`, input.patient.id, vital.recorded_at, coding('http://loinc.org', '29463-7', 'Body weight'), quantity(vital.weight_lbs, 'lb', '[lb_av]')));
    if (vital.heart_rate !== null) resources.push(observation(`heart-rate-${vital.id}`, input.patient.id, vital.recorded_at, coding('http://loinc.org', '8867-4', 'Heart rate'), quantity(vital.heart_rate, 'beats/minute', '/min')));
    if (vital.spo2 !== null) resources.push(observation(`spo2-${vital.id}`, input.patient.id, vital.recorded_at, coding('http://loinc.org', '59408-5', 'Oxygen saturation in Arterial blood by Pulse oximetry'), quantity(vital.spo2, '%', '%')));
    if (vital.sbp !== null || vital.dbp !== null) {
      resources.push({
        resourceType: 'Observation', id: `blood-pressure-${vital.id}`, status: 'final',
        category: [coding('http://terminology.hl7.org/CodeSystem/observation-category', 'vital-signs', 'Vital Signs')],
        code: coding('http://loinc.org', '85354-9', 'Blood pressure panel'),
        subject: { reference: `Patient/${input.patient.id}` }, effectiveDateTime: vital.recorded_at,
        component: [
          ...(vital.sbp === null ? [] : [{ code: coding('http://loinc.org', '8480-6', 'Systolic blood pressure'), valueQuantity: quantity(vital.sbp, 'mmHg', 'mm[Hg]') }]),
          ...(vital.dbp === null ? [] : [{ code: coding('http://loinc.org', '8462-4', 'Diastolic blood pressure'), valueQuantity: quantity(vital.dbp, 'mmHg', 'mm[Hg]') }]),
        ],
      });
    }
  }

  const labDefinitions = [
    ['potassium', '2823-3', 'Potassium [Moles/volume] in Serum or Plasma', 'mmol/L', 'mmol/L'],
    ['creatinine', '2160-0', 'Creatinine [Mass/volume] in Serum or Plasma', 'mg/dL', 'mg/dL'],
    ['egfr', '33914-3', 'Glomerular filtration rate/1.73 sq M.predicted', 'mL/min/1.73m2', 'mL/min/{1.73_m2}'],
    ['sodium', '2951-2', 'Sodium [Moles/volume] in Serum or Plasma', 'mmol/L', 'mmol/L'],
  ] as const;
  for (const lab of input.labs) {
    for (const [field, code, display, unit, unitCode] of labDefinitions) {
      const value = lab[field];
      if (value === null) continue;
      resources.push({
        resourceType: 'Observation', id: `${field}-${lab.id}`, status: 'final',
        category: [coding('http://terminology.hl7.org/CodeSystem/observation-category', 'laboratory', 'Laboratory')],
        code: coding('http://loinc.org', code, display), subject: { reference: `Patient/${input.patient.id}` },
        effectiveDateTime: lab.collected_at, valueQuantity: quantity(value, unit, unitCode),
      });
    }
  }

  for (const medication of input.medications) {
    const instruction = [medication.dosage, medication.frequency, medication.timing].filter(Boolean).join(' · ');
    resources.push({
      resourceType: 'MedicationRequest', id: medication.id,
      status: medication.active ? 'active' : 'stopped', intent: 'order',
      medicationCodeableConcept: { text: medication.name },
      subject: { reference: `Patient/${input.patient.id}` },
      authoredOn: medication.created_at ?? undefined,
      dosageInstruction: instruction ? [{ text: instruction }] : undefined,
    });
  }

  return {
    resourceType: 'Bundle',
    type: 'collection',
    timestamp: generatedAt,
    meta: { tag: [{ system: 'https://app.heartlandprotocol.org/fhir/tags', code: 'educational-export', display: 'HEARTLAND read-only export' }] },
    entry: resources.map((resource) => ({ fullUrl: `urn:uuid:${resource.id ?? crypto.randomUUID()}`, resource })),
  };
}
