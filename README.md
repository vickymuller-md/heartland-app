# HEARTLAND Protocol App

**Clinical Decision Support Tool for Rural Heart Failure Management**

A Progressive Web Application that operationalizes the HEARTLAND Protocol — *Heart failure Evidence-based Access in Rural Treatment, Linking Advanced Network Delivery* — for primary care-led heart failure management in rural and resource-limited settings across the United States.

> **Source protocol**: Muller Ferreira V. *HEARTLAND Protocol: An Implementation Framework for Primary Care-Led Heart Failure Management in Rural Settings.* Published in Cureus (Springer Nature), indexed in PubMed, PubMed Central, Scopus, and Google Scholar.

---

## Disclaimers (read first)

> *"This tool is designed for healthcare professionals as a clinical decision support resource. It does not provide medical diagnoses, treatment recommendations for individual patients, or replace clinical judgment. Not intended for direct patient care. For professional use only."*

> *"The HEARTLAND Risk Stratification Framework is a proposed tool under development. It has not been validated against clinical outcomes data. Formal validation through registry data is a defined research objective."*

This app is **not a medical device**, **not FDA-cleared**, and **not HIPAA-certified**. It processes **synthetic data only** — no patient health information is stored or transmitted.

---

## Purpose

Heart failure affects over 6.7 million Americans and drives more than 1 million hospitalizations annually. Rural populations bear a 53% higher mortality rate, exacerbated by limited cardiology access — 86% of rural U.S. counties have no cardiologist. Despite strong clinical evidence for guideline-directed medical therapy (GDMT), fewer than 20% of eligible patients receive all four recommended medication classes simultaneously.

This app translates the eight HEARTLAND Protocol modules into interactive decision support tools tuned for non-specialist providers in Critical Access Hospitals, rural clinics, and community health centers.

## Features

| # | Module | Route |
|-|-|-|
| 1 | Risk Stratification Calculator | `/(provider)/risk-calculator` |
| 2 | GDMT Optimization Pathway | `/(provider)/gdmt-pathway` |
| 3 | Telephone Titration Checklist | `/(provider)/titration-checklist` |
| 4 | Discharge Transitions (SBAR) | `/(provider)/discharge` |
| 5 | Remote Monitoring Track Assignment | `/(provider)/remote-monitoring` |
| 6 | Comorbidity Management | `/(provider)/comorbidity-manager` |
| 7 | Primary Care Linkage | *Phase 2* |
| 8 | Implementation Tier Selector | `/(provider)/tier-selector` |

Cross-cutting:

- Pocket Card Library — digital versions of all ten protocol figures
- Pharmacoeconomic Navigator — $15/month Generic Bridge calculator
- NIW Traction Report — monthly aggregate usage statistics (geographic spread, module engagement, growth)
- Offline-capable (PWA with service worker)
- Mobile-first, print-friendly
- HIPAA Safe Harbor date truncation on CSV exports (risk-minimization even with synthetic data)

## Requesting Access

Access is controlled. Licensed healthcare professionals may request access at **`app.heartlandprotocol.org/request-access`**. Registration requires a valid invitation code issued by the protocol author. Patient-facing features are reachable only via a professional's invitation.

For research collaborations, pilot deployments at Critical Access Hospitals, or institutional inquiries: contact **vickymuller@heartlandprotocol.org**.

## Status

| Stream | State |
|-|-|
| Cureus manuscript | Submitted; peer-review response in progress |
| HEARTLAND Protocol | v3.2 (February 2026) — authoritative |
| App | Phase 1 milestone complete; Phase 2 (Modules 4 & 7) in progress |
| Zenodo software DOI | Pending — will be minted at first public release via `.zenodo.json` |
| NIW petition integration | Tracked in [`NIW_INTEGRATION.md`](./NIW_INTEGRATION.md) |

## Stack

- Next.js 16 (App Router) · React 19 · TypeScript 5
- Tailwind CSS v4 · shadcn primitives · base-ui
- Supabase (auth + Postgres + RLS) for controlled access
- Serwist (PWA / service worker)
- react-to-print (monthly report PDF)
- Vitest (unit/integration tests)
- Deployment: Vercel → `app.heartlandprotocol.org`

## Local development

```bash
npm install
cp .env.example .env.local   # fill Supabase + GA4 keys
npm run dev
npm test
```

## Open science

This repository will be deposited to Zenodo under DOI minted from `.zenodo.json` at first public release. All protocol content is covered by the Cureus open-access publication and the existing repository deposits:

- **Cureus** (peer-reviewed, indexed PubMed/PMC/Scopus)
- **Zenodo** (protocol): [`10.5281/zenodo.18566403`](https://doi.org/10.5281/zenodo.18566403)
- **OSF**: [`10.17605/OSF.IO/YUSGH`](https://doi.org/10.17605/OSF.IO/YUSGH)
- **medRxiv**: three complementary systematic reviews registered in PROSPERO

## License

[MIT](./LICENSE). The app is free to use, modify, and redistribute for research, education, and professional clinical decision support — subject to the disclaimers above. Not a medical device.

## Author

**Vicky Muller Ferreira, MD**
Cardiologist · Implementation Science Researcher
ORCID: [0009-0009-1099-5690](https://orcid.org/0009-0009-1099-5690)
Email: vickymuller@heartlandprotocol.org
