import { humanCommandSchema, type HumanInput } from '@/lib/care-workflow/human-types';
import { careStepCommandSchema } from '@/lib/care-workflow/step-command';
import { LAB_OBSERVATION_FIELDS } from '@/lib/labs/quality';

const label = (value: string) => value.replaceAll('_', ' ');
export function CareHumanEvidence({ input }: { input: HumanInput }) {
  const command = humanCommandSchema.parse({ command: input.command, payload: input.payload });
  return <div className="space-y-3 break-words" aria-label="Frozen human evidence">
    <p>Evidence: {command.payload.evidence}</p>
    <p>Occurred: {command.payload.occurred_at}</p>
    <p>Next action: {command.payload.next_action}</p><p>Next review: {command.payload.next_review_at}</p>
    {command.command === 'record_review' ? <div className="rounded-lg bg-blue-50 p-3">
      <p className="font-semibold">Documented human decision</p><p>{command.payload.details.decision}</p>
      <p className="mt-2 font-semibold">Limitations retained</p><p>{command.payload.details.limitations}</p>
      <p className="mt-2">An attestation about partial evidence does not make the result complete or confirm care completion.</p>
    </div> : command.command === 'record_contact' ? <div className="rounded-lg bg-amber-50 p-3">
      <p>Contact channel: {label(command.payload.details.channel)}</p>
      <p>Declared recipient: {label(command.payload.details.recipient_type)} · {command.payload.details.recipient_reference}</p>
      <p>Documented outcome: {label(command.payload.details.outcome)}</p>
      <p>{command.payload.details.review_addressed ? 'Declared as addressing the referenced review. Application state is shown separately.'
        : 'Not declared as addressing the current reviewed decision.'}</p>
      <p className="break-all">Review reference: {command.payload.details.review_event_id ?? 'None supplied'}</p>
      {command.payload.details.reason && <p>Contact barrier: {command.payload.details.reason}</p>}
      <p className="mt-2">This records a human statement; it does not certify delivery, comprehension or completed care.</p>
    </div> : command.command === 'resolve_exception' ? <div className="space-y-2 rounded-lg bg-amber-50 p-3">
      <CareExceptionSnapshot exception={command.payload.details.exception} />
      <p>Declared disposition: {label(command.payload.details.disposition)}</p>
      <p>Resolution reason: {command.payload.details.resolution_reason}</p>
      <p>Application state is shown separately. Resolving this barrier does not confirm delivery, resolve source invalidations or complete care.</p>
    </div> : <div className="space-y-2 rounded-lg bg-amber-50 p-3">
      <CareSourceSnapshot target={command.payload.details.invalidation} />
      <p>Declared disposition: {label(command.payload.details.disposition)}</p><p>Resolution reason: {command.payload.details.resolution_reason}</p>
      <p className="break-all">Referenced review: {command.payload.details.review_event_id}</p>
      <p>New source-specific review declaration: {command.payload.details.source_review_evidence}</p>
      <p className="break-all">Referenced contact: {command.payload.details.contact_event_id}</p>
      <p>New source-specific contact declaration: {command.payload.details.source_communication_evidence}</p>
      <p>Prior review and contact records remain unchanged. Application state is shown separately; this declaration does not certify delivery, comprehension, usable results or completed care.</p>
    </div>}
    <CareHumanBasis basis={input.basis} signature={input.basis_signature} />
  </div>;
}
export function CareSourceSnapshot({ target }: { target: Extract<HumanInput['payload']['details'], { invalidation: unknown }>['invalidation'] }) {
  return <div aria-label="Exact changed-source origin" className="space-y-1 break-words">
    <p className="font-semibold">Changed source: {LAB_OBSERVATION_FIELDS[target.analyte].label} — {label(target.change_status)}</p>
    <p>Change recorded: {target.change_recorded_at}</p><p>Follow-up obligation recorded: {target.recorded_at}</p>
    <p>Latest version recorded when loaded: {target.head_recorded_at}</p>
    <p>{target.head.status === 'cancelled' ? 'Cancelled source; no usable value' : `Source value at this snapshot: ${target.head.value} ${LAB_OBSERVATION_FIELDS[target.analyte].unit}`}</p>
    <p>Collected: {target.head.collected_at} · Version revision: {target.head.revision}</p>
    <details className="text-xs"><summary>Exact source-change identity</summary>
      <p className="break-all">Obligation: {target.invalidation_id} · Entry: {target.entry_id}</p>
      <p className="break-all">Original composition: {target.composition_event_id} · Revision: {target.composition_revision}</p>
      <p className="break-all">Root: {target.root_id} · Observed version: {target.observed_version_id}</p>
      <p className="break-all">Changed version: {target.change_version_id} · Revision: {target.change_revision}</p>
      <p className="break-all">Head version: {target.head.version_id} · Effective result: {target.head.effective_lab_result_id ?? 'None'}</p>
    </details>
  </div>;
}
export function CareExceptionSnapshot({ exception }: { exception: Extract<HumanInput['payload']['details'], { exception: unknown }>['exception'] }) {
  return <div aria-label="Exact barrier origin" className="space-y-1 break-words">
    <p className="font-semibold">Barrier: {label(exception.code)}</p><p>Original reason: {exception.reason}</p>
    <p>Original next action: {exception.next_action}</p><p>Original review deadline: {exception.next_review_at}</p>
    <p>Origin occurred: {exception.origin_occurred_at}</p><p>Barrier recorded: {exception.recorded_at}</p>
    <p className="break-all text-xs">Barrier ID: {exception.exception_id}</p>
    <p className="break-all text-xs">{exception.origin_event_id ? 'Operational origin' : 'Human contact origin'}: {exception.origin_event_id ?? exception.human_origin_event_id} · Origin revision: {exception.origin_revision}</p>
  </div>;
}
export function CareHumanBasis({ basis, signature }: { basis: HumanInput['basis']; signature: string }) {
  const fact = basis.operational_event && careStepCommandSchema.parse({ command: basis.operational_event.command, payload: basis.operational_event.payload });
  return <div className="space-y-3 break-words" aria-label="Human evidence basis">
    {basis.kind === 'laboratory_order' ? <>
      <p className="font-semibold">Laboratory evidence shown for this record</p>
      <ul className="space-y-2" aria-label="Frozen laboratory evidence">{basis.sources.map((source) => <li key={source.analyte} className="rounded-lg border p-3">
        <p className="font-medium">{LAB_OBSERVATION_FIELDS[source.analyte].label}: {source.quality === 'missing' ? 'Missing'
          : source.quality === 'cancelled' ? 'Cancelled source; no usable value'
            : `${source.head?.value} ${LAB_OBSERVATION_FIELDS[source.analyte].unit}${source.quality === 'invalid' ? ' — invalid source; not usable' : ''}`}</p>
        {source.head && <><p>Collected: {source.head.collected_at}</p><p>Observed source status: {label(source.head.status)}</p>
          <details className="mt-1 text-xs"><summary>Source identity and provenance</summary>
            <p className="break-all">Root: {source.root_id} · Source organization: {source.authority_organization_id}</p>
            <p className="break-all">Version observed at association: {source.observed_version_id}</p>
            <p className="break-all">Version shown for this record: {source.head.version_id} · Revision: {source.head.revision}</p>
          </details></>}
      </li>)}</ul>
      <p className="font-semibold">Processing evidence — separate from source quality</p>
      {!basis.processing.length && <p>No effective laboratory result had a processing record to show.</p>}
      {basis.processing.map((row) => <div key={row.lab_result_id} className="rounded-lg bg-slate-50 p-3">
        <p className="break-all text-xs">Result: {row.lab_result_id}</p>
        <p>{row.evaluation === null ? 'No evaluation record was available.' : `Processing: ${label(row.evaluation.status)}`}</p>
        {row.evaluation && <><p>Completed: {row.evaluation.completed_at ?? 'Not completed'}</p>
          <p>{row.evaluation.source_assessment === null ? 'Source assessment not recorded; this is not proof of source validity.'
            : `Source assessment recorded at ${row.evaluation.source_assessment.evaluated_at}.`}</p>
          {row.evaluation.source_assessment && <ul>{Object.entries(row.evaluation.source_assessment.analytes).map(([analyte, item]) =>
            <li key={analyte}>{label(analyte)} processing source: {label(item.reason)}</li>)}</ul>}</>}
        <p>A panel processing status does not classify every analyte or replace professional review.</p>
      </div>)}
    </> : basis.operational_event ? <div className="rounded-lg border p-3">
      <p className="font-semibold">{basis.kind === 'referral' ? 'Documented report' : 'Documented acquisition source'}</p>
      <p>Operational revision: {basis.operational_event.revision}</p>
      <p>Occurred: {basis.operational_event.occurred_at}</p>
      {fact && <><p>Evidence: {fact.payload.evidence}</p>
        {Object.entries(fact.payload.details).map(([key, value]) => <p key={key}>{label(key)}: {value === null ? 'Not supplied' : key === 'source' ? label(value) : value}</p>)}</>}
    </div> : <p>No report or acquisition evidence had been recorded for this human record.</p>}
    <details className="text-xs"><summary>Exact evidence identity</summary>
      <p className="break-all">Evidence signature: {signature}</p>
      <p className="break-all">Composition: {basis.composition_event_id ?? 'Not applicable or absent'}</p>
    </details>
  </div>;
}
