# HEARTLAND Protocol v3.3 — Clinical Content for App Development

Source: protocol_v33.pdf (31 pages, March 2026). This is the authoritative source.
PDF also available at: `heartland-app/reference/protocol_v33.pdf`

---

## MODULE 1: Risk Stratification

### 1.1 CKM Staging (AHA 2023 Presidential Advisory)

| Stage | Description | Prevalence | Life Expectancy Impact |
|-|-|-|-|
| 0 | No CKM risk factors | 13.2% | Reference |
| 1 | Excess adiposity (BMI ≥25) and/or prediabetes | 20.8% | Minimal |
| 2 | Metabolic risk factors (T2DM, HTN, high TG) and/or moderate-high CKD | 53.1% | Moderate |
| 3 | Subclinical CVD with CKM | 5.0% | Significant |
| 4 | Clinical CVD (including HF) ± kidney failure | **7.8%** | **-12.4 years at age 50** |

### 1.2 HEARTLAND Risk Score (Table 1 from protocol)

**10 variables, maximum 18 points**

| Risk Factor | Points |
|-|-|
| Age ≥75 years | +2 |
| Prior HF hospitalization within 6 months | +3 |
| eGFR <45 mL/min/1.73m² | +2 |
| BNP ≥500 pg/mL or NT-proBNP ≥1500 pg/mL | +2 |
| SBP <100 mmHg at admission | +2 |
| Diabetes mellitus | +1 |
| LVEF <30% | +2 |
| CKM Stage 3 or 4 | +2 |
| Distance to cardiology care >50 miles | +1 |
| Lives alone or limited social support | +1 |

**Score interpretation:**
- 0-4: LOW → Standard discharge; PCP follow-up within 14 days; Basic self-monitoring
- 5-8: MODERATE → Enhanced bundle; PCP follow-up within 7 days; 72h telehealth check; Home monitoring
- ≥9: HIGH → Intensive bundle; Cardiology input before discharge; 48h phone follow-up; CHW or equivalent support

### Comparison with Existing Scores (Table 6)

| Characteristic | MAGGIC | GWTG-HF | SHFM | HEARTLAND |
|-|-|-|-|-|
| Number of variables | 13 | 7 | 24+ | **10** |
| Outcome predicted | 1-3 year mortality | In-hospital mortality | 1-5 year survival | **Readmission risk + monitoring intensity** |
| Distance to care | No | No | No | **Yes** |
| Social support | No | No | No | **Yes** |
| Rurality | No | No | No | **Yes** |
| Primary care feasibility | Moderate | Low (hospital-designed) | Low (complex) | **High** |
| Validation status | Validated (39,372 pts) | Validated (hospital registry) | Validated (multiple cohorts) | **Pragmatic heuristic (not yet validated)** |
| Intended use | Prognostic | Prognostic | Prognostic | **Implementation support** |

**IMPORTANT DISCLAIMER:** This score is a pragmatic heuristic designed to supplement — not replace — validated prognostic instruments. It has not been statistically validated through derivation/validation cohorts with ROC analysis or calibration testing. Formal validation using registry data is a planned next step.

---

## MODULE 2: GDMT Optimization & 2025 Pharmacology

### 2.1 HFrEF (LVEF ≤40%) — Quadruple Therapy

| Drug Class | Agent (Generic) | Starting Dose | Target Dose | Safety Gates |
|-|-|-|-|-|
| ARNI | Sacubitril/valsartan | 24/26 mg BID | 97/103 mg BID | SBP >100; K+ <5.5 |
| Beta-blocker | Carvedilol | 3.125 mg BID | 25 mg BID (50 if >85kg) | HR >50; SBP >90 |
| MRA | Spironolactone | 12.5-25 mg daily | 25-50 mg daily | eGFR >30; K+ <5.0 |
| SGLT2i | Dapagliflozin or Empagliflozin | 10 mg daily | 10 mg daily (no titration) | eGFR >20 |

### 2.2 HFpEF (LVEF >40%) — Evolving Evidence

| Priority | Agent (Generic) | Dose | Evidence Context |
|-|-|-|-|
| 1. SGLT2i | Dapagliflozin or Empagliflozin | 10 mg daily | Class IIa per 2022 AHA/ACC/HFSA. EMPEROR-Preserved + DELIVER. |
| 2. MRA | Finerenone OR Spironolactone | 10-20 mg / 12.5-25 mg | Finerenone: FINEARTS-HF 16% reduction CV death/HF events. Requires K+ <5.0 and eGFR ≥25. |
| 3. GLP-1 RA | Semaglutide | Titrate to 2.4 mg weekly | STEP-HFpEF: Improved symptoms in obesity phenotype (BMI ≥30). Obesity therapy with CV benefits. |
| 4. Diuretics | Loop diuretics | PRN | Symptom/volume control |

### Finerenone vs. Spironolactone Decision Guide

| Clinical Scenario | Suggested Approach | Rationale |
|-|-|-|
| HFpEF with eGFR 25-60, K+ <5.0 | Consider finerenone | FINEARTS-HF population; requires eGFR ≥25 and K+ <5.0 |
| History of hyperkalemia on MRA | Finerenone preferred (monitor K+ closely) | Lower hyperkalemia incidence in trials |
| Significant cost barrier | Spironolactone | ~$4/month generic vs. ~$500/month |
| HFrEF | Either acceptable | Both have supporting evidence |
| Uncertain, guideline-adherent approach | Spironolactone | Established guideline recommendation |

### Titration Safety Gates Summary

**UPTITRATE IF:** SBP ≥100, HR ≥50, K+ <5.0
**HOLD IF:** SBP <90, HR <50, K+ >5.5, Cr ↑>30%

### 2.3 Non-Pharmacological Management

**Dietary Sodium:** Target <2,000 mg/day
**Physical Activity:** Walking 5-10 min daily, gradually increase to 30 min moderate activity most days
**Cardiac Rehabilitation:** Class I recommendation — refer all eligible patients

### 2.4 Generic Bridge (~$15/month)

1. ACE inhibitor (Lisinopril) OR ARB (Losartan) — $4/month
2. Beta-blocker (Carvedilol generic) — $4/month
3. MRA (Spironolactone generic) — $4/month
4. Metformin (if diabetic/prediabetic) — $4/month

**KEY PRINCIPLE:** Generic therapy is superior to NO therapy. Never delay treatment while waiting for paperwork.

---

## MODULE 3: Telephone-Based GDMT Titration

### 3.1 Hozho Trial Evidence

| Parameter | Result |
|-|-|
| Population | 103 American Indians with HF in rural Navajo Nation |
| Primary Outcome | 66.2% vs 13.1% GDMT class addition at 30 days |
| Absolute Increase | 53% |
| Telehealth Completion | 80.5% adherence to phone visits |
| Safety | No increase in adverse events (6.6% vs 5.0%, p=0.51) |
| Method | Voice telephone calls (not smartphone apps) |

### 3.2 Dual-Track Execution

**Track A (Digital):** Smartphone, Bluetooth devices, app-based daily entry, automated alerts, video visits
**Track B (Analog):** Paper diary, standard devices (patient reads display), voice telephone calls, verbal report → staff enters manually

Both tracks follow **identical clinical decision algorithms**. Track selection based on patient capability, not clinical need.

### 3.3 Titration Decision Algorithm

| Parameter | Action |
|-|-|
| SBP ≥100 mmHg AND asymptomatic | UPTITRATE to next dose level |
| SBP 90-99 mmHg AND asymptomatic | HOLD current dose; reassess in 1 week |
| SBP <90 mmHg OR symptomatic hypotension | REDUCE dose or hold; consider cardiology input |
| HR <50 (for beta-blockers) | Reduce dose; if symptomatic, hold |
| K+ 5.0-5.5 | Reduce MRA/finerenone dose; recheck in 1 week |
| K+ >5.5 | HOLD MRA/finerenone and ARNI; urgent recheck; dietary counseling |
| Cr increase >30% | HOLD ARNI/MRA; evaluate; cardiology consult |

---

## MODULE 4: Structured Discharge Transitions

### 4.1 Discharge Bundle Components

| Component | Timing | Tier 1 | Tier 2/3 |
|-|-|-|-|
| Case Management Assessment | Within 24h of admission | If available | Required |
| Teach-Back Education | Before discharge | 3 core domains | 8 domains |
| Medication Reconciliation | Before discharge | Simplified | Full with PharmD |
| Follow-Up Scheduled | Before leaving | 14-day PCP | 7-day visit confirmed |

### 4.2 Task-Shifting Framework

| Task | Optimal Executor | Alternatives | No CHW Available |
|-|-|-|-|
| Teach-back education | RN | LPN (RN supervise), Pharmacist | RN with extended time; video |
| Discharge checklist | RN | MA with script, LPN | RN or provider |
| Daily weight/BP calls | RN, Pharmacist | MA, CHW, Automated IVR | MA with script; IVR system |
| Symptom assessment | RN | LPN → RN review | RN via phone |
| Red-flag triage | RN/Provider | NO SUBSTITUTION | NO SUBSTITUTION |
| Home device setup | Home Health RN | CHW, Family caregiver | Family with phone instruction |
| Financial/PAP navigation | Social Worker | CHW, Financial navigator | SW via phone; self-service resources |
| Dietary education | Dietitian | RN, CHW (with script) | Written materials; phone dietitian |

### 4.3 Teach-Back Core Domains

**Tier 1 (3 Core Domains — Required for All):**
- DAILY WEIGHT: Weigh same time daily; call if +3lbs/2 days or +5lbs/week
- MEDICATIONS: Take daily even when well; never stop without calling
- WARNING SIGNS: SOB, swelling, waking breathless → call clinic

**Tier 2/3 (Add 5 more):**
- What is HF, Sodium restriction, Fluid management, Detailed "when to call", Activity guidance

### 4.4 Post-Discharge Contact Protocol

| Timing | Purpose | Tier 1 | Tier 2/3 |
|-|-|-|-|
| 48-72 hours | Medication check, side effects, barriers | Phone call | Phone or video |
| Day 7 | Vitals, GDMT tolerability, weight trend | Phone acceptable | In-person or video preferred |
| Weeks 2-4 | Titration, adherence | Weekly calls | Structured protocol |
| High-risk | Intensive support | As resources allow | CHW engagement, frequent contact |

---

## MODULE 5: Remote Patient Monitoring

### 5.1 TIM-HF2 Evidence

| Outcome | Result |
|-|-|
| All-cause mortality | HR 0.70 (95% CI 0.50-0.96) — 30% reduction |
| Days lost to hospitalization | 4.88% vs 6.64% |
| Key finding | Patients living farther from cardiologists benefit most |

### 5.2 Red Flag Alert Criteria

| Finding | Action Required |
|-|-|
| Weight gain ≥3 lbs in 2 days | Call clinic same day |
| Weight gain ≥5 lbs in 1 week | Urgent evaluation within 24h |
| SBP <90 mmHg with symptoms | Hold GDMT; call provider |
| SpO2 <92% at rest (if baseline normal) | Urgent evaluation |
| New/worsening dyspnea at rest | Same-day evaluation |
| **Chest pain, syncope** | **EMERGENCY — Call 911** |

### 5.3 Billing Codes (2025)

| Code | Description | Approximate Reimbursement |
|-|-|-|
| 99453 | RPM initial setup | $19-21 |
| 99454 | RPM monthly device (≥16 days data) | $48-55 |
| 99457 | RPM first 20 min management | $48-52 |
| 99458 | RPM additional 20 min | $38-42 |
| 98975-98981 | RTM codes (similar structure) | Similar range |
| G0511 | RHC/FQHC Comprehensive Care Management | Consolidated |

**Revenue Potential:** $150-200/month per high-risk patient with full capture.

### Track Assignment Form (Table 4)

| Assessment Item | Response |
|-|-|
| Patient Name | [Text field] |
| Medical Record Number (MRN) | [Text field] |
| Risk Score | [Text field] |
| Smartphone with reliable connectivity? | Yes / No |
| Comfortable using apps? | Yes / No |
| Reliable telephone access? | Yes / No |
| Track Assignment | Track A (Digital) / Track B (Analog) / Hybrid |
| Implementation Tier | Tier 1 / Tier 2 / Tier 3 |
| Equipment Provided | Blood pressure (BP) cuff / Scale / Paper diary |

---

## MODULE 6: Comorbidity Management

### Comorbidity Quick Reference (Table 3)

| Comorbidity | Key Considerations | What to Do |
|-|-|-|
| Atrial Fibrillation | Rate vs rhythm | Rate control, anticoagulation |
| Obstructive Sleep Apnea | Prevalent in HFpEF | Screen (STOP-BANG), CPAP |
| Iron Deficiency | Worsens symptoms | Check ferritin/TSAT, IV iron |
| Diabetes | SGLT2i is dual therapy | SGLT2i, metformin, GLP-1 RA |
| CKD | Limits dosing, hyperkalemia | Adjust doses, monitor K+, finerenone |
| COPD | Beta-blocker concerns overstated | Cardioselective BB (metoprolol) |
| Depression | Affects adherence | Screen PHQ-9, SSRIs safe |
| Hypertension | GDMT treats both | GDMT lowers BP, adjust others |

### 6.2 Advanced HF Referral Criteria

**Refer for advanced therapies if:**
- LVEF ≤35% despite ≥3 months of optimal GDMT
- ≥2 HF hospitalizations in past 12 months
- Need for continuous or frequent IV inotropes
- Peak VO2 <14 mL/kg/min on CPET
- Persistent NYHA Class IIIb-IV symptoms
- Considering LVAD or transplant listing

**Refer for device evaluation (ICD/CRT) if:**
- LVEF ≤35% after ≥3 months of GDMT
- LBBB with QRS ≥150 ms (CRT candidate)
- QRS 130-149 ms (possible CRT candidate)
- Primary prevention ICD consideration

---

## MODULE 7: Primary Care Coordination

### 7.1 SBAR Handoff

| Element | Content for HF Handoff |
|-|-|
| S — Situation | Patient discharged with HF; Type (HFrEF/HFpEF); LVEF; Trigger; HEARTLAND Risk Score; Track Assignment |
| B — Background | Prior admissions; CKM stage; Key comorbidities; NYHA class; Social support; Insurance |
| A — Assessment | Current GDMT with doses; Volume status; Recent labs; Financial barriers |
| R — Recommendation | Follow-up interval; Titration plan; Labs to order; When to request cardiology input |

### 7.2 PCP Empowerment — What Can Be Managed Independently

- GDMT titration per Module 3 algorithm when hemodynamically stable
- Diuretic adjustments for mild volume overload
- Finerenone initiation for HFpEF (if comfortable, with monitoring plan)
- Routine lab monitoring (BMP q1-2 weeks during titration, then quarterly)
- Vaccinations (influenza, pneumococcal, COVID-19)
- Depression/anxiety screening and treatment
- Cardiac rehabilitation referral
- Smoking cessation
- Diabetes co-management with HF-appropriate medications
- Iron deficiency screening and IV iron referral

### 7.3 Shared Medical Appointments (Tier 2/3)

| Component | Duration | Content |
|-|-|-|
| Group Education | 45-60 min | Sodium, weights, medications, warning signs |
| Individual Assessment | 5-10 min/patient | Vitals, symptom check, dose adjustments |

Candidates: NYHA I-II, stable GDMT ≥4 weeks, willing to participate.

---

## MODULE 8: Implementation Guidance

### 8.1 Quality Metrics

| Metric | Tier 1 Target | Tier 2/3 Target |
|-|-|-|
| 48-72h post-discharge contact | >70% | >90% |
| ≥2 GDMT classes at discharge (HFrEF) | >60% | >80% |
| 7-day follow-up attendance | >60% | >85% |
| 30-day readmission rate | Improvement from baseline | <15% |
| Teach-back documentation | >70% | >90% |

### 8.2 Implementation Tiers Summary (Table 2)

| Component | Tier 1 (Minimal) | Tier 2 (Standard) | Tier 3 (Advanced) |
|-|-|-|-|
| Risk Stratification | Score at discharge | Full CKM + Score | Full CKM + Score |
| GDMT | ≥2 classes, prioritize SGLT2i + BB | Target all classes in 14 days | Rapid sequence per STRONG-HF |
| Monitoring | Track B (Analog) | Dual-track (A/B) | Track A with automated alerts |
| Discharge Education | Condensed teach-back (3 domains) | Full teach-back (8 domains) | Full + CHW reinforcement |
| Follow-up | 48-72h call, 14-day visit | 48h call, 7-day visit, weekly ×4 | 48h call, 7-day visit, weekly ×4+ |
| Staffing | RN/MA + physician (MD) | RN champion, MA, PharmD | RN coordinator, PharmD, CHW |
| CHW | Alternative/Family | High-risk only | Integrated team member |
| Financial | Generic Bridge | PAP pursuit + Generic Bridge | Full navigation + 340B + PAP |

### 8.3 Value-Based Payment Preparation (ASM 2027)

- Register for CMS Innovation Center updates
- Establish baseline quality metrics
- Implement structured GDMT optimization
- Document telehealth capabilities
- Review HRRP readmission history
- Establish specialist teleconsult relationships

---

## APPENDIX A: Key Clinical Trials

| Trial | Year | Key Finding | Context |
|-|-|-|-|
| EMPEROR-Preserved | 2021 | Empagliflozin reduces CV death/HF hospitalization in HFpEF (LVEF >40%) | Class IIa per 2022 AHA/ACC/HFSA |
| DELIVER | 2022 | Dapagliflozin confirms SGLT2i benefit across broad HFpEF | Class IIa |
| FINEARTS-HF | 2024 | Finerenone 16% reduction CV death/HF events in HFmrEF/HFpEF | Emerging evidence; guideline integration ongoing |
| STEP-HFpEF | 2023 | Semaglutide improved symptoms in obese HFpEF | Obesity therapy with HF benefits |
| Hozho Trial | 2024 | 53% increase GDMT via telephone in rural population | Validates low-tech approach |
| STRONG-HF | 2022 | Rapid GDMT titration safe and effective | Tier 3 methodology |
| TIM-HF2 | 2018 | 30% mortality reduction with remote monitoring | Foundation for RPM |

## APPENDIX B: Manufacturer Assistance Programs

| Medication | Manufacturer | Resource |
|-|-|-|
| Sacubitril/valsartan | Novartis | Patient assistance program available |
| Finerenone | Bayer | Savings program available |
| Empagliflozin | Lilly/BI | Patient assistance available |
| Dapagliflozin | AstraZeneca | Patient assistance available |
| Semaglutide | Novo Nordisk | Patient assistance available |

Additional: NeedyMeds.org, RxAssist.org, 340B pricing for eligible facilities (FQHC, CAH).

---

## LIMITATIONS AND SCOPE

1. **No prospective validation.** Expected outcomes are extrapolated from source trials that tested individual interventions, not the integrated bundle.
2. **Risk score not statistically calibrated.** Pragmatic heuristic, not regression-based. Formal validation is a planned next step.
3. **Narrative review methodology.** Not a systematic review with predefined search strategies.
4. **Clinical judgment remains paramount.** This protocol does not substitute for clinical judgment.
5. **Population-specific adaptations may be necessary.** Designed for rural US settings; other populations may require modifications.
