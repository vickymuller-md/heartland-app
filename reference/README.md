# Reference Materials for HEARTLAND App Development

## Available in this folder

| File | Content |
|-|-|
| `HEARTLAND_1page_summary.md` | One-page protocol summary |
| `HEARTLAND_References.md` | 71 references with DOIs (if permissions fixed) |
| `HEARTLAND_Protocol_Complete.md` | Full 8-module protocol text (if permissions fixed) |
| `figures/` | 10 JPGs — pocket cards, checklists, reference cards |

## Permission Issue

The files `protocol/HEARTLAND_Protocol_Complete.md` and `protocol/HEARTLAND_References.md` in the parent project are owned by root with restricted permissions. To fix:

```bash
sudo chown rodrigocosta:staff ~/NIW-project/protocol/HEARTLAND_Protocol_Complete.md
sudo chown rodrigocosta:staff ~/NIW-project/protocol/HEARTLAND_References.md
sudo chmod 644 ~/NIW-project/protocol/HEARTLAND_Protocol_Complete.md
sudo chmod 644 ~/NIW-project/protocol/HEARTLAND_References.md
```

Then copy them here:
```bash
cp ~/NIW-project/protocol/HEARTLAND_Protocol_Complete.md ~/NIW-project/heartland-app/reference/
cp ~/NIW-project/protocol/HEARTLAND_References.md ~/NIW-project/heartland-app/reference/
```

## Alternative Sources (Always Accessible)

- Published Cureus article: DOI 10.7759/cureus.104817
- Zenodo deposit: DOI 10.5281/zenodo.18566403
- OSF deposit: DOI 10.17605/OSF.IO/YUSGH
- Summary: `~/NIW-project/HEARTLAND_1page_summary.md`
- Professional Plan v10 (contains module descriptions): `~/NIW-project/professional_plan_v10.Rmd`

## Figures (10 JPGs)

| File | Content | App Module |
|-|-|-|
| `01_Pocket_Card_GDMT.jpg` | GDMT optimization quick reference | Module 2 |
| `02_Pocket_Card_Red_Flags.jpg` | Clinical red flags / safety gates | Module 3 |
| `03_Patient_Daily_Diary.jpg` | Patient self-monitoring diary | Module 5 |
| `04_Track_Assignment_Form.jpg` | Digital vs Analog track assignment | Module 5 |
| `05_Financial_Navigation_Tracker.jpg` | 340B / PAP / Generic Bridge tracker | Module 2 |
| `06_Risk_Score_Reference.jpg` | Risk stratification scoring reference | Module 1 |
| `07_Implementation_Tiers_Summary.jpg` | Tier 1/2/3 resource requirements | Module 8 |
| `08_SBAR_Handoff_Template.jpg` | Structured handoff for primary care | Module 7 |
| `09_TeachBack_Checklist.jpg` | Patient discharge education checklist | Module 4 |
| `10_Comorbidity_Quick_Reference.jpg` | DM/CKD/AFib/Depression management | Module 6 |
