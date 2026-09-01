# HEARTLAND App v1.9.0

## Release scope

Version 1.9.0 formalizes the current public production snapshot of the HEARTLAND Companion Application. It rolls forward the AI-assisted synthetic workflow work introduced after v1.2.0 and includes the September 1, 2026 safety, explainability, and public-evidence hardening.

The public Evidence Lab uses fictional cases. AI supports bounded language tasks; version-controlled protocol-derived rules and explicit missing-data policies set simulated routing; a human reviewer verifies the displayed evidence and authorizes any next action.

## Implemented public workflows

- English- and Spanish-language daily and titration check-ins by tap, text, or optional voice.
- Simulated outreach calls, morning-round automation, and five-day synthetic scenarios.
- Read-only provider Copilot operating through 13 deterministic tools with a visible tool trace.
- Deterministic population replay for 500, 2,500, or 5,000 fictional check-ins.
- Work-the-queue flow from Chart to Call to Document using a shared deterministic case source.
- Protocol-grounded rule and result explanations that do not recalculate or alter the underlying output.
- Human-controlled SBAR wording proposals for Situation and Background, with accept, reject, and undo controls; Assessment and Recommendation remain provider-owned.
- Evidence Flow and Decision Receipts showing source text, structured extraction, unknowns, rule or missing-data policy, simulated disposition, and human follow-through.

## Safety and availability controls

- Deterministic preflight for selected English- and Spanish-language emergency phrases and obvious identifier patterns before supported model calls.
- Strict request and response schemas, forced tool outputs, bounded generated-text screening, and canonical fallbacks.
- Missing or ambiguous required clinical answers route to human review rather than reassurance.
- Microphone off by default with explicit opt-in and a non-voice fallback.
- Atomic, HMAC-scoped public usage limits with separate turn and Copilot buckets.
- Allowlisted aggregate telemetry without stored conversation transcripts.
- Graceful degradation when a model, speech service, database authorization check, or capacity budget is unavailable.

## Verification snapshot

The September 1, 2026 release candidate passed:

- 1,355 unit and integration tests;
- 72 desktop/mobile end-to-end tests;
- 44 database authorization contracts, including 18 contracts for the atomic sandbox-AI rate limiter;
- lint, TypeScript typecheck, production build, repository security scan, and npm audit at the high threshold;
- GitHub CodeQL analysis; and
- CycloneDX SBOM generation.

These controls verify specified software behavior. They are not clinical validation.

## Evidence boundaries

This release demonstrates implemented and inspectable software. It does not establish clinical validation, institutional deployment, regulatory status, HIPAA compliance, comprehensive de-identification, adoption, clinical safety, efficacy, staffing effects, or patient outcomes. Real PHI and unsupervised clinical use are not authorized. Institution-specific clinical, privacy, security, regulatory, accessibility, and workflow evaluation remain required before any governed real-world deployment.

In this release, “registered” means named and version-controlled within the software rule registry. It does not mean registered with a regulator, independently endorsed, or clinically validated.
