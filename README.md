# SAHG-βDT V17 — GitHub Pages browser-only runtime

This directory is the generated static deployment. It requires **no Python/FastAPI/server at runtime**.

## Publish
Upload all files in this directory to a GitHub repository root, then enable **Settings → Pages → Deploy from a branch → main → /(root)**.

## Runtime
The browser loads the frozen ONNX ensemble and anonymized donor runtime and performs preprocessing, SAHG/DR inference, donor/OOD support checks, `coverage_p050`, temporal smoothing, A5 rescue, and true abstention locally. Patient input is not sent to a prediction API by this code.

## Exactness contract
The web tool reproduces V17 only when input follows the frozen canonical feature contract. The longitudinal CSV must use the supplied variable names and canonical time/value definitions. Do not substitute differently defined clinical variables.

## Research use only
This is a research deployment, not autonomous clinical decision support. Do not enter direct identifiers or protected health information.

## Public redistribution review
Read `PUBLIC_DERIVED_DATA_REVIEW_REQUIRED.txt` before making the repository public.
