import { z } from 'zod';
import { reassignmentContextSchema } from './reassignment';

const target = z.object({ id: z.uuid(), name: z.string() }).strict();
export const transferContextSchema = reassignmentContextSchema.extend({ pending_recipient: z.uuid().nullable() })
  .refine((value) => value.eligible || (value.targets.length === 0 && value.next_cursor === null))
  .refine((value) => value.pending_recipient === null || !value.eligible);
export const designationContextSchema = z.object({
  organization_id: z.uuid(), patient_id: z.uuid(), current: target.nullable(),
  targets: z.array(target).max(25), next_cursor: z.uuid().nullable(),
}).strict();
export type TransferContext = z.infer<typeof transferContextSchema>;
export type DesignationContext = z.infer<typeof designationContextSchema>;
export const OWNERSHIP_CONTEXT_UNAVAILABLE = 'Current responsibility and eligible recipients are unavailable. Check your access and load the current view again.';
export const OWNERSHIP_WRITE_UNCONFIRMED = 'Confirmation is unavailable. The operation may have been recorded. Load the current view before submitting again; do not assume it was rolled back.';
