import { z } from 'zod';
import { flagsFromReceipt, VITALS_RULE_VERSION, BATCH_VITALS_RULE_VERSION } from './receipt-evaluation';
import type { VitalsActionState, VitalsRow } from './types';

const uuid = z.string().uuid();
export const snapshotSchema = z.object({
  request_id: uuid,
  submission_status: z.enum(['prepared', 'committed', 'acknowledged', 'cancelled', 'batched']),
  vitals_id: uuid.nullable(), symptoms_id: uuid.nullable(),
  evaluation_status: z.enum(['pending', 'failed', 'complete']).nullable(),
  red_flag_ids: z.array(z.string()).nullable(), alert_id: uuid.nullable(), rule_version: z.string().nullable(),
  observation: z.object({ vitals: z.object({ id: uuid, patient_id: uuid,
    recorded_at: z.string(), weight_lbs: z.number(), sbp: z.number(), dbp: z.number(),
    heart_rate: z.number(), spo2: z.number().nullable(), source: z.enum(['patient_app', 'provider_entry']),
  }).passthrough() }).passthrough().nullable(),
});
export type Snapshot = z.infer<typeof snapshotSchema>;

export function stateFromSnapshot(receipt: Snapshot): VitalsActionState {
  const state: VitalsActionState = { requestId: receipt.request_id, submissionStatus: receipt.submission_status };
  if (receipt.vitals_id && receipt.symptoms_id && receipt.observation) {
    state.saved = true;
    state.vitals = receipt.observation.vitals as unknown as VitalsRow;
    state.symptomsId = receipt.symptoms_id;
    state.evaluationStatus = receipt.evaluation_status ?? 'pending';
    const expected = receipt.submission_status === 'batched' ? BATCH_VITALS_RULE_VERSION : VITALS_RULE_VERSION;
    if (receipt.evaluation_status === 'complete' && receipt.rule_version === expected) {
      state.redFlags = flagsFromReceipt(receipt.red_flag_ids);
      if ((state.redFlags.length > 0) !== Boolean(receipt.alert_id)) throw new Error('Incomplete alert receipt');
      state.success = true;
      state.alertRecorded = state.redFlags.length > 0;
    } else {
      state.error = 'Your record is saved. Evaluation is not confirmed; retry the evaluation without entering the measurements again. Contact your care team if you need help; do not wait for this screen in an emergency.';
    }
  }
  return state;
}
