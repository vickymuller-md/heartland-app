# HEARTLAND App v1.10.0

## Release scope

This October 2026 source release consolidates the controlled implementation work after v1.9.0. It is a clinical implementation companion and synthetic demonstration, not a prospectively validated care system. The archived source and a production deployment are separately verifiable artifacts.

## Implemented changes

- Examination orders, laboratory submission recovery and source provenance, corrected-result workflows, professional review and contact documentation, with explicit pending states instead of inferred completion.
- Organization-scoped work ownership, recoverable reassignment/transfer requests and restricted exception views. A transfer offer alone does not discharge responsibility.
- Recoverable, session-bound education submissions and teach-back records. A patient's quiz response is not professionally verified teach-back.
- Serialized notification preferences, notification-intent coupling and queued delivery/reconciliation controls. An intent, HTTP acceptance or acknowledgment is not evidence of delivered or understood care.
- Updated pharmacotherapy, trial-population and endpoint references, finerenone-specific monitoring, individual sodium-plan wording, dated affordability estimates and complete printable safety tables.
- Explicit clinician-directed medication holds: preserve the symptomatic low-pressure threshold and immediate provider contact without instructing independent medication changes.
- A recording-specific release gate for 58 synthetic clips: 31 English and 27 Spanish, comprising four English dialogues and 27 EN/ES prompt pairs. Twenty-eight current recordings have real generation receipts; thirty historical recordings retain their unreceipted provenance. Twenty-nine retired hashes remain blocked.
- Separate records for owner-reported clinical script acceptance, delegated automated documentary/ASR/decoder verification and synthetic release authorization. No clinician signature or human listening is fabricated. Exact script, locale, recording, comparison and evidence identities are checked before immutable playback URLs are built.
- Text fallback, microphone opt-in, no paid synthesis fallback for unavailable static recordings, and regression coverage across outreach, chat check-in and simulated calls.

## Verification and limits

The release gate validates evidence structure and byte/source binding, including revocation across authorization routes. Local ASR compares the spoken output with the script; it cannot certify pronunciation, prosody, human intelligibility or clinical suitability. The clinical acceptance was reported by the project owner as the clinician's acceptance, not provided as a direct signed attestation.

The hosted migration chain and public App are maintained separately from operational activation. Scheduled alert-scan recovery, external notification transport and other institution-gated background processes remain disabled. No automatic legacy fallback, broad permission grant, synthetic evidence modification or production-membership change is part of this release.

Synthetic software tests and local workflow rehearsals do not establish patient contact, clinical effectiveness, staffing coverage, institutional adoption, regulatory clearance, privacy/security compliance or patient outcomes. Real PHI and unsupervised patient care remain outside this release. The proposed HEARTLAND risk framework and included clinical prototypes retain their stated validation and local-policy limitations.

Historical version archives are preserved. This release does not replace the Cureus article or imply that the article evaluated the App or its language/speech features.
