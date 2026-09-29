import { describe, expect, it, vi } from 'vitest';
import { buildFhirR4Collection, FhirDecimal, FhirExportLimitError, serializeFhirR4 } from '@/lib/interoperability/fhir-r4';
import { LAB_OBSERVATION_FIELDS } from '@/lib/labs/quality';
import type { EffectiveLabObservation } from '@/lib/labs/effective';
import * as laboratoryReader from '@/lib/labs/effective';

const id = (n: number) => '66000000-0000-4000-8000-' + n.toString(16).padStart(12, '0');
const patientId = id(1);
const generatedAt = '2026-09-29T13:00:00Z';
const lab = (n = 11, patch: Partial<EffectiveLabObservation> = {}): EffectiveLabObservation => ({
  id: id(n) + ':potassium', patient_id: patientId, original_lab_result_id: id(n), analyte: 'potassium',
  root_id: null, version_id: null, revision: null, status: 'original', effective_lab_result_id: id(n),
  value: '4.20000000000000001', collected_at: '2026-09-28T12:00:00.000001Z',
  notes: null, lab_facility: null, evaluation_status: 'pending', ...patch,
});
const vital = { id: id(2), patient_id: patientId, recorded_at: '2026-09-28T12:00:00Z',
  weight_lbs: 150, sbp: 118, dbp: 72, heart_rate: 68, spo2: 97 };
const medication = { id: id(3), patient_id: patientId, name: 'Synthetic medication',
  dosage: '10 mg', frequency: 'daily', timing: null, active: true };
const input = () => ({ patient: { id: patientId, fullName: 'Maria Santos', patientCode: 'ABC123' },
  vitals: [vital], labs: [lab()], medications: [medication], generatedAt });
// Structural assertions may parse JSON; decimal preservation is asserted on the original wire text.
const wire = (args = input()) => serializeFhirR4(buildFhirR4Collection(args));

describe('FHIR R4 effective-source collection', () => {
  it('uses valid unique UUID URNs and exact in-bundle patient references', () => {
    const bundle = buildFhirR4Collection(input());
    expect(bundle).toMatchObject({ resourceType: 'Bundle', type: 'collection' });
    expect(bundle.entry[0].resource).toMatchObject({ resourceType: 'Patient', name: [{ text: 'Maria Santos' }] });
    expect(new Set(bundle.entry.map((entry) => entry.fullUrl)).size).toBe(bundle.entry.length);
    for (const entry of bundle.entry) expect(entry.fullUrl).toMatch(/^urn:uuid:[a-f0-9]{8}-[a-f0-9]{4}-5[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
    for (const entry of bundle.entry.slice(1)) expect(entry.resource.subject).toEqual({ reference: bundle.entry[0].fullUrl });
  });
  it('keeps stable laboratory identity across registration, correction and cancellation', () => {
    const original = lab();
    const corrected = lab(11, { root_id: id(21), version_id: id(22), revision: '2', status: 'corrected', effective_lab_result_id: id(23) });
    const cancelled = { ...corrected, version_id: id(24), revision: '3', status: 'cancelled' as const, effective_lab_result_id: null, value: null, evaluation_status: null };
    const resource = (source: EffectiveLabObservation) => buildFhirR4Collection({ ...input(), vitals: [], medications: [], labs: [source] }).entry[1];
    expect(resource(original).fullUrl).toBe(resource(corrected).fullUrl);
    expect(resource(original).fullUrl).toBe(resource(cancelled).fullUrl);
    expect(resource(cancelled).resource.valueQuantity).toBeUndefined();
    expect(serializeFhirR4(resource(corrected))).toContain('revision 2');
    expect(serializeFhirR4(resource(cancelled))).not.toContain('4.20000000000000001');
  });
  it('exports all13 analytes with stored textual units and exact source provenance, not unverified assay codes', () => {
    const sources = Object.keys(LAB_OBSERVATION_FIELDS).map((analyte, index) => lab(11, {
      analyte: analyte as EffectiveLabObservation['analyte'], id: id(11) + ':' + analyte,
      root_id: id(100 + index), version_id: id(200 + index), revision: '1', notes: 'Synthetic note', lab_facility: 'Synthetic lab',
    }));
    const text = serializeFhirR4(buildFhirR4Collection({ ...input(), vitals: [], medications: [], labs: sources }));
    expect(text.match(/"value":4.20000000000000001/g)).toHaveLength(13);
    expect(text).toContain('2026-09-28T12:00:00.000001Z');
    const bundle = JSON.parse(text);
    for (const entry of bundle.entry.slice(1)) {
      expect(entry.resource.status).toBe('unknown');
      expect(entry.resource.code.coding).toBeUndefined();
      expect(entry.resource.valueQuantity.system).toBeUndefined();
      expect(entry.resource.identifier).toHaveLength(4);
      expect(entry.resource.note[0].text).toContain('alert processing: pending');
    }
    for (const { label, unit } of Object.values(LAB_OBSERVATION_FIELDS)) {
      expect(bundle.entry.some((entry: { resource: { code?: { text: string }; valueQuantity?: { unit: string } } }) =>
        entry.resource.code?.text === label && entry.resource.valueQuantity?.unit === unit)).toBe(true);
    }
    expect(text).not.toContain('33914-3'); expect(text).toContain('Synthetic lab');
    const all = buildFhirR4Collection({ ...input(), labs: sources });
    const observationIdentifiers = all.entry.filter((entry) => entry.resource.resourceType === 'Observation')
      .flatMap((entry) => (entry.resource.identifier as { system: string; value: string }[])
        .map((identifier) => identifier.system + '|' + identifier.value));
    expect(new Set(observationIdentifiers).size).toBe(observationIdentifiers.length);
  });
  it('assesses each exact collection/analyte group once, not once per observation', () => {
    const spy = vi.spyOn(laboratoryReader, 'selectLatestEffectiveLab');
    try {
      const labs = Array.from({ length: 1000 }, (_, i) => lab(i + 100));
      const bundle = buildFhirR4Collection({ ...input(), vitals: [], medications: [], labs });
      expect(bundle.entry).toHaveLength(1001); expect(spy).toHaveBeenCalledTimes(1);
    } finally { spy.mockRestore(); }
  });
  it.each(['negative', 'future', 'conflict', 'cancelled-peer'] as const)('withholds values for %s quality without substituting older history', (kind) => {
    const recent = lab();
    let sources = [recent];
    if (kind === 'negative') sources = [{ ...recent, value: '-4.2' }];
    if (kind === 'future') sources = [{ ...recent, collected_at: '2027-01-01T12:00:00Z' }];
    if (kind === 'conflict') sources.push(lab(12, { value: '4.20000000000000002', collected_at: '2026-09-28T08:00:00.000001-04:00' }));
    if (kind === 'cancelled-peer') sources.push(lab(12, {
      root_id: id(21), version_id: id(22), revision: '2', status: 'cancelled', value: null,
      effective_lab_result_id: null, evaluation_status: null,
    }));
    const older = lab(13, { value: '3.100', collected_at: '2026-09-27T12:00:00Z' });
    const bundle = buildFhirR4Collection({ ...input(), vitals: [], medications: [], labs: [...sources, older] });
    for (const entry of bundle.entry.slice(1, -1)) {
      expect(entry.resource.valueQuantity).toBeUndefined(); expect(entry.resource.dataAbsentReason).toBeDefined();
    }
    expect(serializeFhirR4(bundle.entry.at(-1))).toContain('"value":3.100');
  });
  it('does not conflate distinct microseconds or equal decimals with different scale', () => {
    const bundle = buildFhirR4Collection({ ...input(), vitals: [], medications: [],
      labs: [lab(11, { value: '4.20' }), lab(12, { value: '4.200', collected_at: '2026-09-28T08:00:00.000001-04:00' }),
        lab(13, { value: '5.1', collected_at: '2026-09-28T12:00:00.000002Z' })] });
    for (const entry of bundle.entry.slice(1)) expect(entry.resource.valueQuantity).toBeDefined();
    const text = serializeFhirR4(bundle); expect(text).toContain('"value":4.20,'); expect(text).toContain('"value":4.200,');
  });
  it('preserves known vital codes and restores database weight scale without asserting final verification', () => {
    const text = wire();
    for (const code of ['29463-7', '85354-9', '8480-6', '8462-4', '8867-4', '59408-5']) expect(text).toContain(code);
    expect(text).toContain('"value":150.0,'); expect(text).not.toContain('"status":"final"');
    const bundle = JSON.parse(wire({ ...input(), vitals: [{ ...vital, dbp: null }] }));
    const bp = bundle.entry.find((entry: { resource: { component?: unknown[] } }) => entry.resource.component);
    expect(bp.resource.component[1].valueQuantity).toBeUndefined();
    expect(bp.resource.component[1].dataAbsentReason.text).toContain('Not recorded');
  });
  it.each([true, false, null])('does not turn catalog flag %s into a prescription, use or discontinuation claim', (active) => {
    const bundle = JSON.parse(wire({ ...input(), medications: [{ ...medication, active }] }));
    const resource = bundle.entry.at(-1).resource;
    expect(resource.resourceType).toBe('MedicationStatement'); expect(resource.status).toBe('unknown');
    for (const key of ['intent', 'authoredOn', 'dateAsserted', 'effectiveDateTime']) expect(resource[key]).toBeUndefined();
    expect(resource.dosage).toEqual([{ text: '10 mg · daily' }]);
    expect(resource.note[0].text).toContain('not confirmed');
  });
  it('omits absent identity and dosage elements without empty FHIR values or invented names', () => {
    const args = input();
    const bundle = buildFhirR4Collection({ ...args, patient: { ...args.patient, fullName: null, patientCode: null },
      medications: [{ ...medication, dosage: '', frequency: ' ', timing: null }] });
    const parsed = JSON.parse(serializeFhirR4(bundle));
    expect(parsed.entry[0].resource.name).toBeUndefined(); expect(parsed.entry[0].resource.identifier).toBeUndefined();
    expect(parsed.entry.at(-1).resource.dosage).toBeUndefined();
    expect(wire()).not.toContain('"family"'); expect(wire()).not.toContain('"given"');
    expect(wire()).not.toContain('"email"'); expect(wire()).not.toContain('"phone"'); expect(wire()).toContain('educational-export');
  });
  it.each(['lab-scope', 'vital-scope', 'medication-scope', 'lab-duplicate', 'vital-duplicate', 'medication-duplicate',
    'weight-scale', 'nonfinite-vital', 'malformed-source', 'invalid-date'])('rejects %s rather than emitting a partial collection', (kind) => {
    const args = input();
    if (kind === 'lab-scope') args.labs[0].patient_id = id(99);
    if (kind === 'vital-scope') args.vitals = [{ ...vital, patient_id: id(99) }];
    if (kind === 'medication-scope') args.medications = [{ ...medication, patient_id: id(99) }];
    if (kind === 'lab-duplicate') args.labs.push(lab());
    if (kind === 'vital-duplicate') args.vitals.push(vital);
    if (kind === 'medication-duplicate') args.medications.push(medication);
    if (kind === 'weight-scale') args.vitals = [{ ...vital, weight_lbs: 150.11 }];
    if (kind === 'nonfinite-vital') args.vitals = [{ ...vital, sbp: NaN }];
    if (kind === 'malformed-source') args.labs[0].value = '4,"evil":true';
    if (kind === 'invalid-date') args.generatedAt = 'today';
    expect(() => buildFhirR4Collection(args)).toThrow();
  });
  it('admits exactly10,000 resources and rejects10,001 without truncation', () => {
    const medications = Array.from({ length: 9999 }, (_, i) => ({ ...medication, id: id(i + 100) }));
    expect(buildFhirR4Collection({ ...input(), vitals: [], labs: [], medications }).entry).toHaveLength(10000);
    expect(() => buildFhirR4Collection({ ...input(), vitals: [], labs: [], medications: [...medications, { ...medication, id: id(20000) }] })).toThrow(FhirExportLimitError);
  });
});

describe('FHIR decimal wire serializer', () => {
  it.each(['0.000', '-0.00', '4.20000000000000001', '999999999999999999999999999999.000001', '0.' + '0'.repeat(330) + '1'])('preserves %s without numeric conversion', (value) => {
    expect(serializeFhirR4({ value: new FhirDecimal(value) })).toBe('{"value":' + value + '}');
  });
  it('normalizes only illegal leading zeros, preserving sign and fractional precision', () => {
    expect(serializeFhirR4({ value: new FhirDecimal('-0004.200') })).toBe('{"value":-4.200}');
    expect(serializeFhirR4({ value: new FhirDecimal('0000.00') })).toBe('{"value":0.00}');
  });
  it.each(['1e3', 'NaN', 'Infinity', '1,"injected":true', '+4', '.5', '4.', ' 4', ''])('rejects unsafe decimal encoding %s', (value) => {
    expect(() => new FhirDecimal(value)).toThrow();
  });
  it('does not replace numeric-looking strings or interpret source text as JSON', () => {
    const text = '4.200,"value":999';
    expect(serializeFhirR4({ text, value: new FhirDecimal('4.200') })).toBe('{"text":' + JSON.stringify(text) + ',"value":4.200}');
    expect(() => JSON.stringify({ value: new FhirDecimal('4.20') })).toThrow(/serializeFhirR4/);
  });
  it('omits undefined properties while rejecting null, empty, unsupported or cyclic elements', () => {
    expect(serializeFhirR4({ keep: true, omitted: undefined })).toBe('{"keep":true}');
    for (const value of [null, '', ' ', [], {}, { empty: undefined }, [undefined], [null], NaN, Infinity, 0.1, new Date(), BigInt(1)]) {
      expect(() => serializeFhirR4(value)).toThrow();
    }
    const cycle: { child?: unknown } = {}; cycle.child = cycle;
    expect(() => serializeFhirR4(cycle)).toThrow();
  });
});
