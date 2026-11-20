# HEARTLAND App v1.11.0

Released November 20, 2026. This version consolidates the workflow and interface changes since v1.10.1.

## Workflow changes

- **Medication schedules.** A patient’s daily plan uses their selected time zone and the confirmed schedule for each medication. Daily, weekly, as-needed and unconfirmed instructions have distinct presentations. Changing a schedule preserves previously recorded doses and their timestamps.
- **Risk assessments.** The public calculator shows which of the ten answers are missing and offers an optional fictional example. When a professional saves an assessment, the record includes the answers, scoring version, score and time. Historical records indicate when individual answers are unavailable.
- **Team alerts and portal communication.** The work queue reconciles authorized alerts on reconnect. Retrying a message uses the original operation identifier. Selecting “Mark as read” preserves the first confirmed read time. The Today view derives outstanding education modules from the available catalog.
- **Reports and exports.** The patient summary shows the five most recent vital-sign observations in the selected period. The reporting paths include the end date and use corrected or voided laboratory records consistently. Medication and education reports use recorded doses and module activity. FHIR exports reflect effective observations. Historical planning indicators use their published comparison operators before rounding.

## Public walkthrough and accessibility

The home and guide open a fictional case in the sandbox. Visitors can review the rule that flagged it, record a simulated decision and reopen the case from its link. The home, tools and workspaces share the HEARTLAND palette and typefaces. Keyboard focus, text enlargement, high-contrast fields and chart labels support reading at narrow widths. The public sandbox continues to offer bilingual check-ins, simulated outreach and 58 synthetic recordings.

## Reproducibility and scope

The source includes database migrations 00080–00084 and automated tests for the new behavior. The version tag identifies the exact source. The Zenodo concept DOI links all archived releases. The toolkit has its own version and DOI. [Software archive](https://doi.org/10.5281/zenodo.19600593) · [Toolkit V3.4.1](https://doi.org/10.5281/zenodo.23076249)

The public sandbox uses fictional data. The authenticated workspace supports controlled evaluation. A portal read receipt establishes that the signed-in user selected the action. Clinical validation, actual care delivery, institutional readiness and prospective patient outcomes require separate evidence.
