# HEARTLAND — Incident Response Runbook

**Status:** operational baseline; named roles, channels, legal review, tabletop, and facility acceptance pending

**Last updated:** July 14, 2026

**Boundary:** synthetic-only until every PHI release gate is approved

This runbook is intentionally free of credentials, private endpoints, patient data, and personal contact details. Those belong in the approved incident-management system, not this public repository.

## 1. Activation and severity

| Severity | Trigger examples | Initial triage target | Default action |
|---|---|---:|---|
| SEV-1 | Confirmed cross-patient access, master credential exposure, destructive compromise, likely reportable breach | 15 minutes during defined coverage | Contain first; suspend affected clinical workflow |
| SEV-2 | Account takeover, unauthorized provider, material alert-pipeline failure, high-confidence exploitation | 30 minutes | Revoke access; move to degraded workflow |
| SEV-3 | Contained weakness, repeated authorization denial, non-PHI outage, failed security control | 4 hours | Isolate, investigate, remediate within SLA |
| SEV-4 | Low-risk anomaly or improvement finding | 1 business day | Track through normal security backlog |

No clinical-response coverage is implied until a facility formally accepts staffing, hours, escalation targets, and downtime ownership.

## 2. Required roles

- Incident Commander: unassigned; must be named before PHI pilot.
- Security Officer: unassigned; must be named before PHI pilot.
- Clinical Safety Lead: unassigned; decides clinical-workflow suspension and recovery.
- Privacy/Legal Lead: unassigned; determines notification and regulatory obligations.
- Communications Lead: unassigned; controls approved external communication.
- Scribe: records timestamps, evidence references, decisions, and owners.

One person may hold multiple roles only after conflict and coverage review. Never put PHI, tokens, full request bodies, or secrets in the incident timeline.

## 3. Universal response sequence

1. Open incident record; assign severity, commander, scribe, and next update time.
2. Preserve evidence references: deployment IDs, commit SHA, aggregate audit IDs, provider/account IDs, and timestamps. Do not copy clinical payloads into chat or logs.
3. Contain: revoke sessions/credentials, suspend affected account or organization, stop unsafe worker, or activate downtime workflow.
4. Determine scope using authoritative provider, organization, assignment, consent, audit, and deployment records.
5. Eradicate root cause through a reviewed migration/config/code change. Never repair only the UI boundary.
6. Recover with least privilege, explicit data-integrity checks, and heightened monitoring.
7. Obtain Clinical Safety Lead approval before restoring any affected clinical workflow.
8. Decide notification/regulatory action with Privacy/Legal Lead; record rationale and deadline.
9. Publish blameless postmortem with corrective owners and due dates; retest the original attack path.

## 4. Scenario playbooks

### A. Service-role or secret exposure

- SEV-1 unless evidence proves the credential was non-production and unused.
- Remove the exposure path; revoke/rotate credential; invalidate dependent deployments and sessions where applicable.
- Review audit metadata, provider/link/role mutations, bulk access, export activity, and deployment logs for the exposure window.
- Redeploy only after old credential rejection is proven and secret scan passes.

### B. Account takeover or provider MFA loss

- Suspend provider membership; revoke all Auth sessions and verified factors through administrative recovery.
- Verify identity outside the compromised channel before restoring access.
- Review organization assignment, work reassignment, exports, messages, and access-review evidence.
- Require new password, new TOTP enrollment, and a fresh AAL2 session.

### C. Cross-organization or cross-patient access

- SEV-1; suspend affected principal and block the route/RPC/policy.
- Preserve request timestamp, actor ID, resource ID, organization ID, deployment, and audit references—no payload copies.
- Run the complete authorization matrix for the affected resource before recovery.
- Treat absence of obvious mutation as insufficient proof of no disclosure.

### D. Unauthorized provider or failed offboarding

- Revoke organization membership, provider-patient links as applicable, sessions, factors, and pending invitations.
- Reassign open work; record a new access review; inspect actions since the effective offboarding time.
- Fix the provisioning/offboarding control and perform a second-person verification.

### E. Lost or shared device

- Revoke sessions; verify local clinical cache remains absent; rotate credentials if browser storage may be exposed.
- Confirm shared-device logout purge and no-store behavior.
- Restore access only after identity verification and a new AAL2 session.

### F. Malicious or unexpected export

- Suspend export capability and principal; preserve export audit reference and object metadata.
- Determine rows, fields, recipients, and destination without duplicating the exported dataset.
- Revoke shared artifacts; rotate signed links; assess breach obligations.

### G. Corruption, deletion, or ransomware

- Stop writes to affected path; preserve deployment/database state and timestamps.
- Do not claim recovery until PITR/backup exists and a restore drill proves integrity.
- Reconcile patient, assignment, work-item, and audit counts; Clinical Safety Lead validates workflow safety.

### H. Alert or notification pipeline failure

- Activate `/downtime`; state clearly that no alert/device delivery is confirmed.
- Record scan/delivery aggregate counts and first/last known-good timestamps.
- Assign manual review owner and cadence accepted by facility; reconcile missed windows after recovery.

### I. Vendor or supply-chain compromise

- Freeze affected deploys; identify reachable dependency, secret, data path, and build provenance.
- Rebuild from clean lockfile and reviewed source; rotate exposed credentials; generate a new SBOM.
- Do not restore solely because an advisory was marked resolved; verify exploit path and artifact integrity.

### J. Suspected reportable breach

- Preserve evidence, contain, and immediately involve Privacy/Legal Lead.
- Record affected systems, people, data categories, time window, safeguards, and uncertainty.
- Regulatory, patient, customer, insurer, and law-enforcement decisions require counsel and documented deadlines.

## 5. Recovery evidence

An incident cannot close until evidence includes:

- original attack/failure path no longer works;
- negative authorization tests pass for affected and adjacent roles;
- migrations/config are applied and deployment points to reviewed commit;
- credentials/sessions expected to be invalid are rejected;
- data-integrity and backlog reconciliation are complete;
- monitoring captures the relevant aggregate signal;
- owner and due date exist for every corrective action;
- clinical, security, and privacy owners approve closure where applicable.

## 6. Mandatory exercises before PHI

- Tabletop: service-role exposure plus cross-patient read.
- Tabletop: alert pipeline unavailable during facility coverage.
- Break-glass/offboarding drill with session and membership revocation.
- Backup restore drill using an isolated target and integrity checklist.
- Independent authenticated penetration test and retest with zero open Critical/High.

Results, names, private contacts, timestamps, and evidence links must live in the approved incident system. A checked box in this repository is not proof of exercise completion.
