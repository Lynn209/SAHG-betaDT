# SAHG-βDT

**SAHG-βDT** is a browser-based β-lactam treatment decision calculator for research use.

**Live calculator:** https://lynn209.github.io/SAHG-betaDT/

The tool accepts the patient's current antibacterial-treatment context together with a longitudinal ICU timeline and returns one of six policy actions (**A0–A5**) or **Abstain**. All model inference is performed locally in the browser; the calculator does not send patient inputs to a prediction API.

> **Research use only.** SAHG-βDT is not a substitute for clinician judgment and should not be used as autonomous clinical decision support. Do not enter direct patient identifiers.

---

## 1. How to use the calculator

The calculator is designed as a three-step workflow:

1. **Enter current patient information.**
2. **Upload recent ICU measurements as a CSV timeline.**
3. Select **Get SAHG-βDT recommendation** and review the policy output.

The public calculator currently uses **independent landmark mode**: it evaluates the selected decision time as a single assessment point without requiring a previously stored policy state.

Available assessment times are:

`24, 48, 72, 96, 120, 144, and 168 hours after t0`

where **t0** is the start of the β-lactam treatment episode used by the calculator.

---

## 2. Current patient information

| Field | What to enter | Meaning |
|---|---|---|
| **Decision time after antibiotic start** | 24–168 h in 24-h increments | The landmark at which the treatment decision is being evaluated. Only measurements available up to this time are used. |
| **Sex** | Male / Female / Unknown | Biological sex input used by the frozen model. |
| **Age** | Years | Patient age at the decision episode. |
| **Weight** | kg | Current/representative body weight used by the model. |
| **Current β-lactam Modified ASI** | Numeric score | Modified Antibiotic Spectrum Index for the currently active β-lactam regimen. Within the tool's coding, higher values represent broader β-lactam spectrum/intensity. Use the same Modified ASI coding used by the SAHG-βDT input definition. |
| **Active antibacterials** | Integer count | Number of systemic antibacterial agents currently active. |
| **Active β-lactams** | Integer count | Number of currently active β-lactam antibacterial agents. This count must not exceed the total active-antibacterial count. |
| **Anti-MRSA coverage** | Present / Absent | Whether the current regimen contains active anti-MRSA coverage. |
| **Carbapenem active** | Yes / No | Whether a carbapenem is currently active. |
| **Rescue / escalation-or-other in prior 24 h** | Yes / No | Select **Yes** if a factual rescue/escalation-or-other event corresponding to the A5 treatment state occurred during the preceding 24 hours. This is used by safety/stop gating. |

### Input consistency

The form values should describe the **same current regimen** as the treatment variables in the uploaded timeline. For example:

- `Active β-lactams` should not exceed `Active antibacterials`.
- A positive current β-lactam Modified ASI should normally correspond to an active β-lactam regimen.
- `Carbapenem active = Yes` should be used when the current β-lactam regimen includes a carbapenem.
- Do not describe one antibacterial regimen in the form and a different regimen in the final rows of the timeline CSV.

---

## 3. Longitudinal timeline CSV

Download the template from the calculator or from:

`templates/sahg_betadt_timeline_template.csv`

The public CSV format is:

```csv
time_from_t0_hours,measurement,value,unit_or_encoding
0,Heart rate,92,beats/min
0,Mean arterial pressure,76,mmHg
0,Blood lactate,1.8,mmol/L
24,Sequential Organ Failure Assessment (SOFA) score,5,points
```

### Required columns

| Column | Meaning |
|---|---|
| `time_from_t0_hours` | Measurement time relative to t0, in hours. Negative values denote measurements before t0. |
| `measurement` | Clinical measurement name. Use the names in the supplied template. |
| `value` | Numeric value. |
| `unit_or_encoding` | Human-readable unit/encoding. This column is included for clarity; the browser model uses the measurement name and numeric value. |

The browser converts the publication-ready clinical names to the frozen internal 66-variable model identifiers automatically.

### Missing measurements

You **do not need every variable at every time point**.

For an unavailable measurement:

- leave the `value` cell blank, or omit that row;
- do **not** enter invented values;
- do **not** enter text such as `NA`, `N/A`, or `null` in the numeric `value` column.

Blank-value rows are skipped by the browser and the remaining observed measurements are processed with the model's missingness masks.

The current runtime requires at least:

- **8 observed hourly measurements**, and
- **3 distinct recognized variables**.

Duplicate values for the same measurement in the same 1-hour model bin are rejected.

The runtime supports a **168-hour model history**, with at most **24 hours of pre-t0 history** when that period is available. Measurements occurring after the selected decision time are not used.

---

## 4. Longitudinal variables accepted by the calculator

### 4.1 Vital signs and oxygenation

| Measurement | Unit / encoding | Interpretation |
|---|---|---|
| Heart rate | beats/min | Heart rate. |
| Systolic blood pressure | mmHg | Systolic arterial pressure. |
| Diastolic blood pressure | mmHg | Diastolic arterial pressure. |
| Mean arterial pressure | mmHg | Mean arterial pressure (MAP). |
| Respiratory rate | breaths/min | Respiratory frequency. |
| Peripheral oxygen saturation (SpO₂) | % | Pulse-oximetry oxygen saturation. |
| Body temperature | °C | Body temperature. |
| Fraction of inspired oxygen (FiO₂) | % | Inspired oxygen concentration. Enter as percent, e.g. `40`, not `0.40`. |
| Arterial oxygen partial pressure (PaO₂) | mmHg | Arterial oxygen tension. |
| SpO₂/FiO₂ ratio (S/F ratio) | ratio | Oxygenation ratio based on SpO₂ and FiO₂. |
| PaO₂/FiO₂ ratio (P/F ratio) | ratio | Oxygenation ratio based on PaO₂ and FiO₂. |

### 4.2 Laboratory measurements

| Measurement | Unit / encoding | Interpretation |
|---|---|---|
| Blood lactate | mmol/L | Marker of systemic hypoperfusion/metabolic stress. |
| Serum creatinine | mg/dL | Renal function marker. |
| Blood urea nitrogen | mg/dL | Blood urea nitrogen (BUN). |
| Serum sodium | mmol/L | Serum sodium concentration. |
| Serum potassium | mmol/L | Serum potassium concentration. |
| Serum chloride | mmol/L | Serum chloride concentration. |
| Serum bicarbonate | mmol/L | Serum bicarbonate concentration. |
| Blood glucose | mg/dL | Blood glucose concentration. |
| Total serum calcium | mg/dL | Total serum calcium. |
| Ionized calcium | mmol/L | Ionized calcium. |
| Hemoglobin | g/dL | Hemoglobin concentration. |
| Hematocrit | % | Hematocrit. |
| Platelet count | ×10⁹/L | Platelet count. |
| White blood cell count | ×10⁹/L | Total white blood cell count. |
| Neutrophils | % | Neutrophil percentage. |
| Lymphocytes | % | Lymphocyte percentage. |
| Serum albumin | g/dL | Serum albumin concentration. |
| Total bilirubin | mg/dL | Total bilirubin. |
| C-reactive protein (CRP) | mg/L | C-reactive protein. |
| International normalized ratio (INR) | ratio | INR. |
| Prothrombin time (PT) | s | Prothrombin time. |
| Partial thromboplastin time (PTT) | s | Partial thromboplastin time. |

### 4.3 Clinical state and organ support

| Measurement | Unit / encoding | Interpretation |
|---|---|---|
| Sequential Organ Failure Assessment (SOFA) score | points | SOFA organ-dysfunction score. |
| Systemic Inflammatory Response Syndrome (SIRS) score | points | SIRS score. |
| National Early Warning Score (NEWS) | points | NEWS deterioration score. |
| Partial NEWS indicator | 0/1 | Indicator used by the frozen input pipeline when NEWS is partially represented/available. |
| Glasgow Coma Scale (GCS) | points | Neurologic consciousness score. |
| Urine output | mL/h | Hourly urine output. |
| Invasive mechanical ventilation | 0/1 | `1` = active/present; `0` = absent. |
| High-flow nasal cannula (HFNC) | 0/1 | `1` = active/present; `0` = absent. |
| Non-invasive ventilation (NIV) | 0/1 | `1` = active/present; `0` = absent. |
| Tracheostomy | 0/1 | `1` = present; `0` = absent. |
| Renal replacement therapy present | 0/1 | RRT is present in the current clinical state. |
| Renal replacement therapy active | 0/1 | RRT is actively being delivered. |
| Extracorporeal membrane oxygenation (ECMO) | 0/1 | `1` = ECMO present; `0` = absent. |
| Vasopressor use | 0/1 | `1` = vasopressor support present; `0` = absent. |
| Norepinephrine-equivalent dose | µg/kg/min | Combined vasopressor intensity expressed as norepinephrine-equivalent dose. |
| Norepinephrine infusion rate | µg/kg/min | Norepinephrine dose. |
| Epinephrine infusion rate | µg/kg/min | Epinephrine dose. |
| Dopamine infusion rate | µg/kg/min | Dopamine dose. |
| Dobutamine infusion rate | µg/kg/min | Dobutamine dose. |
| Vasopressin infusion rate | U/min | Vasopressin dose. |
| Sedation exposure | 0/1 | `1` = sedation exposure present; `0` = absent. |

### 4.4 Current anti-infective exposure

| Measurement | Unit / encoding | Interpretation |
|---|---|---|
| Number of active systemic antibacterials | count | Number of systemic antibacterial agents active at that time. |
| Number of active β-lactams | count | Number of active β-lactam agents. |
| Anti-MRSA coverage | 0/1 | `1` = anti-MRSA coverage present; `0` = absent. |
| β-lactam Modified Antibiotic Spectrum Index (ASI) | points | Modified spectrum-intensity score of the active β-lactam regimen. |
| Carbapenem exposure | 0/1 | `1` = carbapenem active; `0` = absent. |
| Additional anaerobic coverage | 0/1 | Additional anaerobic antibacterial coverage. |
| Atypical pathogen coverage | 0/1 | Coverage directed at atypical organisms. |
| Aminoglycoside exposure | 0/1 | Aminoglycoside active. |
| Fluoroquinolone exposure | 0/1 | Fluoroquinolone active. |
| Polymyxin exposure | 0/1 | Polymyxin active. |
| Antifungal exposure | 0/1 | Systemic antifungal therapy active. |
| Antiviral exposure | 0/1 | Systemic antiviral therapy active. |

For binary variables, use:

- `1` = present / active
- `0` = absent / inactive

---

## 5. What do A0–A5 mean?

SAHG-βDT evaluates six treatment states.

| Action | Label | Practical meaning |
|---|---|---|
| **A0** | **Continue current regimen** | Keep the current antibacterial regimen unchanged at this decision point. A0 is the reference action used for risk-difference comparisons. |
| **A1** | **Remove companion coverage** | Remove additional companion antibacterial coverage while retaining the core β-lactam strategy when this action is clinically implementable. |
| **A2** | **β-lactam de-escalation** | Narrow the β-lactam spectrum/intensity rather than stopping β-lactam therapy completely. |
| **A3** | **Discontinue β-lactam** | Stop the active β-lactam component while other antibacterial therapy may remain if applicable. |
| **A4** | **Discontinue all antibacterials** | Stop all active systemic antibacterial therapy. This is subject to stricter safety constraints. |
| **A5** | **Rescue / escalation-or-other** | Rescue or escalation/other treatment state. This is a safety override rather than a routine de-escalation action. |
| **Ø** | **Abstain** | The calculator does not issue a supported policy recommendation for this decision point. |

### Basic action eligibility in the current browser runtime

The frozen browser input logic uses the current regimen to determine which actions are clinically implementable:

- **A0** is the reference/continue action.
- **A1** requires removable companion coverage (for example active anti-MRSA coverage or more than one active antibacterial while a β-lactam is active).
- **A2** requires a β-lactam Modified ASI compatible with de-escalation.
- **A3** requires an active β-lactam.
- **A4** requires active antibacterial therapy and must also pass the stop-safety gate.
- **A5** is only selected through the frozen rescue override criteria.

For the stop-all action (**A4**), the frozen coverage policy additionally requires a decision time of at least **72 h**, acceptable modeled risk under both the reference and stop-all actions, no recent factual A5 rescue/escalation signal, and the relevant support checks.

The underlying sequential policy contains additional temporal-confirmation logic. The current public calculator displays **independent landmark** output.

---

## 6. How the recommendation is chosen

The recommendation is **not simply the action with the lowest displayed predicted risk**.

The frozen V17 `coverage_p050` policy combines the action-specific predicted risk with safety and support information, including:

- treatment-action eligibility;
- propensity support;
- donor effective sample size;
- donor distance/support;
- regimen-node support;
- model–donor agreement;
- directional agreement;
- uncertainty/calibration penalties;
- out-of-distribution (OOD) status;
- stop-action safety gating;
- rescue override rules.

If no action has sufficient empirical support, or the patient state is outside the supported distribution, the calculator may return **Abstain**.

---

## 7. Understanding the recommendation panel

### Recommendation

The large card reports:

- **Action code** — A0, A1, A2, A3, A4, A5, or Ø.
- **Action label** — human-readable recommendation.
- **Confidence** — High, Moderate, Low, or Abstain.
- **Transition** — the deployment mode/state used for the returned action.

In the current public calculator:

`Transition independent_landmark_only`

means the recommendation was produced for the selected decision point without applying a preceding sequential policy history.

### OOD

**OOD** means **out of distribution**.

- **OOD PASS**: the patient's model representation is within the frozen supported distribution according to the OOD gate.
- **OOD FLAG**: the representation exceeds the frozen OOD threshold; this can lead to abstention.

### Abstain

- **Abstain NO**: the runtime found sufficient support to return a policy action.
- **Abstain YES**: no supported action should be issued.

Possible frozen abstention reasons include:

- all actions lack minimum support;
- the A0 reference action lacks minimum support;
- no clinically implementable action;
- severely insufficient usable input;
- out-of-distribution patient state.

---

## 8. Compare candidate actions

The candidate-action table displays the model's action-specific estimates.

### Risk

**Risk** is the modeled probability of the calculator's **72-hour broad-failure outcome** under that candidate action.

Lower predicted risk is generally favorable, but the final policy also requires support and safety checks.

### Δ vs A0

**Δ vs A0** is the absolute risk difference relative to continuing the current regimen:

`Risk(action) − Risk(A0)`

Interpretation:

- **negative value**: lower modeled risk than A0;
- **0**: reference A0;
- **positive value**: higher modeled risk than A0.

A value of `-5.0 pp` means an estimated absolute risk reduction of 5 percentage points relative to A0.

### ESS

**ESS** is the donor **effective sample size** supporting that action around the current patient state.

The frozen runtime uses:

- hard minimum donor ESS: **10**
- preferred donor ESS: **20**

A higher ESS generally indicates stronger local empirical donor support, but ESS is only one component of the final policy gate.

---

## 9. Technical support details

The expandable technical panel reports additional diagnostics.

| Output | Meaning |
|---|---|
| **Policy score** | Penalized risk-difference score used by the frozen coverage policy. It combines the action's risk contrast with uncertainty/support penalties. Lower is more favorable, subject to the policy gates. |
| **Selected Δ risk** | Risk difference between the selected action and A0. |
| **Predicted failure** | Predicted 72-h broad-failure risk for the selected action. |
| **Donor ESS** | Effective sample size of local donor support for the selected action. |
| **OOD distance** | Distance of the patient's representation from the frozen reference distribution used by the OOD gate. |
| **Regimen node** | Internal category describing the current antibacterial regimen (for example non-β-lactam, narrow β-lactam, moderate β-lactam, broad non-carbapenem β-lactam, or carbapenem/very-broad β-lactam, with optional anti-MRSA coverage). |
| **Minimum support** | Whether the selected action satisfies the frozen minimum-support contract. |
| **Decision hour** | The selected landmark after t0. |
| **Observed events** | Number of usable hourly measurement events entering the browser preprocessing pipeline. |
| **Observed variables** | Number of distinct recognized longitudinal variables represented in the uploaded timeline. |

---

## 10. Modified ASI and regimen categories

The calculator uses the **current β-lactam Modified ASI** together with current treatment counts and carbapenem/anti-MRSA status to describe the current regimen.

The browser runtime internally separates regimens into categories such as:

- no systemic antibacterial;
- non-β-lactam antibacterial;
- narrow β-lactam;
- moderate β-lactam;
- broad non-carbapenem β-lactam;
- carbapenem or very-broad β-lactam;

with an additional anti-MRSA suffix when relevant.

The exact Modified ASI value should come from the same medication-to-ASI mapping used for SAHG-βDT. This repository's calculator does **not** infer an ASI score from a drug name typed by the user.

---

## 11. Browser-only processing

The public deployment is browser-only:

- CSV parsing occurs locally;
- preprocessing occurs locally;
- ONNX model inference occurs locally;
- donor-support calculations occur locally;
- OOD and policy evaluation occur locally.

There is no prediction API call in the normal calculator workflow.

The first calculation may take longer because the browser must download and initialize the frozen ONNX models and donor-support assets. Subsequent calculations within the same open page are usually faster.

---

## 12. Important data-entry rules

1. Use the exact clinical measurement names from the downloadable template.
2. Use the units/encodings shown in the template.
3. For **FiO₂**, use percent values (for example `40` for 40%), not fractions such as `0.40`.
4. Leave unavailable values blank rather than entering text placeholders.
5. Do not duplicate the same measurement within the same one-hour model bin.
6. Do not enter measurements that were not available by the selected decision time.
7. Keep the current-regimen form values consistent with the treatment-exposure rows in the timeline.
8. Do not include names, medical-record numbers, dates of birth, addresses, or other direct patient identifiers.

---

## 13. Frozen runtime

The current browser runtime uses:

- **Policy version:** V17
- **Frozen candidate:** `coverage_p050`
- **Policy family:** coverage
- **Policy mode:** penalized risk difference
- **Actions:** 6
- **Longitudinal variables:** 66
- **Decision grid:** 24–168 h
- **Time grid:** 1 hour
- **Maximum model history:** 168 h
- **Maximum events per sample:** 1024
- **Minimum observed events:** 8
- **Minimum observed variables:** 3
- **Hard minimum donor ESS:** 10
- **Preferred donor ESS:** 20
- **Confidence level:** 95%
- **Non-inferiority margin:** 0.05 absolute risk

The calculator runs a frozen browser-runtime self-check internally before first use. That technical self-test is intentionally not displayed in the user-facing interface.

---

## 14. Repository structure

```text
SAHG-betaDT/
├── index.html
├── assets/
│   ├── css/
│   ├── icons/
│   └── js/
├── data/
├── runtime/
│   ├── donor/
│   ├── models/
│   └── *.json
├── templates/
│   └── sahg_betadt_timeline_template.csv
├── validation/
├── INPUT_GUIDE.md
└── README.md
```

---

## 15. Disclaimer

SAHG-βDT is provided for **research and methodological evaluation**.

The output should be interpreted together with the complete clinical context, microbiology, source control, infection diagnosis, treatment indication, drug allergy history, organ function, dosing considerations, local antimicrobial-resistance patterns, and clinician judgment.

The calculator must not be used as an autonomous instruction to initiate, stop, narrow, or escalate antimicrobial therapy.

---

## Live tool

**https://lynn209.github.io/SAHG-betaDT/**
