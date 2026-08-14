# SAHG-βDT V17 Browser Input Guide

## Exactness requirement

The browser runtime can reproduce the frozen V17 calculation only when the supplied inputs have the **same definitions and coding** as the model's canonical input contract. This is not a generic EHR parser.

### Static/current decision fields

Provide the values at the requested frozen decision landmark (24, 48, 72, 96, 120, 144, or 168 h after β-lactam t0):

- age (years)
- sex (male/female/unknown, using the same recorded-sex coding as the analytic dataset)
- weight_kg
- current_beta_asi
- current_antibacterial_count
- current_beta_lactam_count
- current_anti_mrsa (0/1)
- current_carbapenem (0/1; used for regimen-node eligibility/support logic)

### Structural availability profile

Select the frozen V17 source-database profile matching the canonical mapping used for the input: MIMIC-IV, eICU, AmsterdamUMCdb, HiRID, SICdb, or NWICU. This reproduces the database-level structural availability mask used by V17. For a new local dataset, an exact V17 calculation requires first defining its harmonized structural-availability contract; do not arbitrarily substitute a profile.

### Longitudinal CSV

Required columns:

```text
rel_t0_hour,variable,value
```

`rel_t0_hour` is time relative to the frozen β-lactam t0. The runtime uses the same 168-h history window, with at most 24 h pre-t0 history, and bins to a 1-h grid.

The 66 allowed `variable` names are stored in `data/variable_contract.json` and must be used exactly. The input is expected to represent the canonical harmonized event stream used by V17. There must be **at most one canonical value per 1-h bin × variable**. Duplicate rows mapping to the same bin and variable are rejected rather than silently averaged.

Blank template values are ignored. Binary variables use 0/1 as in the frozen data contract. Continuous values are winsorized and robust-normalized with the frozen MIMIC-IV development parameters included in `runtime/normalization.json`.

### Minimum history

A decision requires at least 8 explicit observed events and at least 3 distinct observed variables, matching the frozen eligibility contract.

## Dynamic policy state

For exact temporally smoothed V17 behavior, begin a new anonymous session at the 24-h landmark and evaluate the same patient sequentially at later landmarks. The browser stores only the policy stage/cooldown/pending state in local browser storage under the anonymous session code. Do not use direct identifiers as the session code.

If prior policy state is unavailable, choose **Independent landmark only**. That reproduces the frozen independent action selection for the supplied landmark, but it is not the final temporally smoothed longitudinal policy path.

## Privacy

This static site does not submit patient inputs to a prediction API. Nevertheless, do not enter direct identifiers or protected health information into a public research demo.
