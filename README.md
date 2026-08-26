# HEARTLAND Protocol App

**Clinical implementation companion for rural heart-failure workflows**

A Progressive Web Application that operationalizes the HEARTLAND Protocol — *Heart failure Evidence-based Access in Rural Treatment, Linking Advanced Network Delivery* — for primary care-led heart failure management in rural and resource-limited settings across the United States.

> **Source protocol**: Muller Ferreira V. *HEARTLAND Protocol: An Implementation Framework for Primary Care-Led Heart Failure Management in Rural Settings.* Published in Cureus (Springer Nature), indexed in PubMed, PubMed Central, Scopus, and Google Scholar.

---

## Disclaimers (read first)

> Public routes are an educational sandbox. The authenticated workspace is a controlled evaluation environment. Outputs do not independently diagnose, prescribe, establish billing eligibility, replace source-record review, or replace clinical judgment and institutional policy.

> *"The HEARTLAND Risk Stratification Framework is a proposed tool under development. It has not been validated against clinical outcomes data. Formal validation through registry data is a defined research objective."*

This release **does not establish FDA clearance or authorization and does not resolve medical-device classification**. It does not replace clinical judgment or institutional policy and does not establish HIPAA readiness or compliance. The schema can store health information, but **real PHI and unsupervised clinical use are not authorized** until organizational security, privacy, validation, staffing, incident-response, backup, legal/BAA, and governance gates are approved. Use synthetic or formally approved evaluation data only.

---

## Purpose

Heart failure affects over 6.7 million Americans and drives more than 1 million hospitalizations annually. Rural populations bear a 53% higher mortality rate, exacerbated by limited cardiology access — 86% of rural U.S. counties have no cardiologist. Despite strong clinical evidence for guideline-directed medical therapy (GDMT), fewer than 20% of eligible patients receive all four recommended medication classes simultaneously.

This app translates the eight HEARTLAND Protocol modules into interactive implementation-support workflows for non-specialist providers in Critical Access Hospitals, rural clinics, and community health centers.

## Features

| # | Module | Route |
|-|-|-|
| 1 | Risk Stratification Calculator | `/risk-calculator` |
| 2 | GDMT Optimization Pathway | `/gdmt-pathway` |
| 3 | Telephone Titration Checklist | `/titration-checklist` |
| 4 | Discharge Transitions (SBAR) | `/(provider)/discharge` |
| 5 | Remote Monitoring Track Assignment | `/remote-monitoring` |
| 6 | Comorbidity Management | `/(provider)/comorbidity-manager` |
| 7 | Primary Care Linkage | *Phase 2* |
| 8 | Implementation Tier Selector | `/tier-selector` |

Cross-cutting:

- Pocket Card Library — digital versions of all ten protocol figures
- Pharmacoeconomic Navigator — $15/month Generic Bridge calculator
- NIW Traction Report — monthly aggregate usage statistics (geographic spread, module engagement, growth)
- Offline-capable (PWA with service worker)
- Mobile-first, print-friendly
- Privacy-minimizing exports, row-level access control, immutable work events, and explicit access revocation

## Access

Anyone may create a 30-day tester account at **`app.heartlandprotocol.org/register?mode=tester`** using their own email. Tester accounts use synthetic data only, require no manual approval or authenticator, and cannot access clinical tables.

Clinical access remains controlled. Licensed healthcare professionals may request access at **`app.heartlandprotocol.org/request-access`**; provider workspaces require approval and MFA/AAL2. Patient-facing features are reachable through a professional invitation or reviewed linkage.

For research collaborations, pilot deployments at Critical Access Hospitals, or institutional inquiries: contact **vickymuller@heartlandprotocol.org**.

## Status

| Stream | State |
|-|-|
| Product workspace | Daily Loop, patient 60-second brief, action center, patient Today/Plan/Privacy, and privacy-minimized product telemetry implemented |
| Public sandbox | Sandbox 2.0 instantâneo, sem conta, com sete áreas conectadas, três casos sintéticos profundos e workflow persistente; conta tester é opcional e SMTP próprio ainda é necessário para confirmação confiável |
| Clinical release posture | Controlled evaluation only; real-PHI and pilot go-live gates remain closed pending independent validation and organizational controls |
| Product plan | Published in [`reference/HEARTLAND_PRODUCT_ADOPTION_PLAN.md`](./reference/HEARTLAND_PRODUCT_ADOPTION_PLAN.md) |
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

Protocol content and research materials are available through the existing deposits:

- **Cureus** (peer-reviewed, indexed PubMed/PMC/Scopus)
- **Zenodo** (protocol): [`10.5281/zenodo.19101219`](https://doi.org/10.5281/zenodo.19101219)
- **OSF**: [`10.17605/OSF.IO/YUSGH`](https://doi.org/10.17605/OSF.IO/YUSGH)
- **medRxiv**: three complementary systematic reviews registered in PROSPERO

## Software preservation

Software Heritage snapshot (archived 2026-08-25): [`swh:1:snp:3e39be4952047172a2c1a131c2965bd580a6dc69`](https://archive.softwareheritage.org/swh:1:snp:3e39be4952047172a2c1a131c2965bd580a6dc69/)

This persistent SWHID identifies the repository snapshot captured on that date; archival does not imply endorsement or validation.

## License

[MIT](./LICENSE). The app is free to use, modify, and redistribute for research, education, and professional implementation support — subject to the release and intended-use boundaries above.

## Author

**Vicky Muller Ferreira, MD**
Cardiologist · Implementation Science Researcher
ORCID: [0009-0009-1099-5690](https://orcid.org/0009-0009-1099-5690)
Email: vickymuller@heartlandprotocol.org
