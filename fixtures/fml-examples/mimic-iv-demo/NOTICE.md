# MIMIC-IV demo slice: notice

**This folder is licensed under the Open Database License (ODbL) v1.0** (`LICENSE`), not under the
repository's Apache-2.0 licence. It contains public, de-identified demonstration data from PhysioNet: the only
non-synthetic rows in this repository.

Contains information from the **MIMIC-IV Clinical Database Demo** (version 2.2) and the **MIMIC-IV Clinical
Database Demo on FHIR** (version 2.1.0), which are made available here under the Open Database License (ODbL).
Everything derived from them in this folder (the slice, the normalized rows, the Bundles produced by our maps, the
project's value maps of lab items and units) is a derivative database under the same licence.

## Sources

| Dataset | Version | Files used | SHA-256 (as published in `SHA256SUMS.txt`) |
| --- | --- | --- | --- |
| MIMIC-IV Clinical Database Demo | 2.2 | `hosp/patients.csv.gz` | `59dcc6cd8450ddf03ad32cc7d76e41caa4c9633541715987f590c74835cf6fae` |
| | | `hosp/admissions.csv.gz` | `910b9f160ffdf1e08ea673585393f347c773ccc87d66875c627584a903ae8493` |
| | | `hosp/labevents.csv.gz` | `d51a4cf1ea63245abe7d544b0d50a928e9ee2ec5eb9a5ce85500aed0bd6c6dfc` |
| | | `hosp/d_labitems.csv.gz` | `72ea5f020469fd24543bd98ab3bd0a4f645a5a4b7802d9d52af20d736f9d76db` |
| MIMIC-IV Clinical Database Demo on FHIR | 2.1.0 | `fhir/MimicPatient.ndjson.gz` | `f64c61f64aaed317ddb013276515deaf9ca69815d5c0d70ca372f2a75284ce16` |
| | | `fhir/MimicEncounter.ndjson.gz` | `01d3583e4c8b9fbfde87baa8a6cf1cc6bf53c1db45c0b64120fcb80c34e6b17b` |
| | | `fhir/MimicObservationLabevents.ndjson.gz` | `89dcedb9bcddd6e2dff442bb1b4ed84c2a4b21e64cd3bbecb070a263acb154cb` |

## Selection

Extracted once by hand with `tooling/mimic/extract-slice.mjs` (not run in CI): patients 10031404, 10022281 and
10019568; their admissions; 20 lab events per patient (every row with a text value, then rows without `hadm_id`,
then rows with comments, then the lowest `labevent_id`); the `d_labitems` rows they use; and the FHIR demo's Patient,
Encounter and lab Observation resources with the same identifiers (`mimic-on-fhir/`). Source rows are kept whole.

## Citation

- Johnson, A., Bulgarelli, L., Pollard, T., Horng, S., Celi, L. A., & Mark, R. (2023). MIMIC-IV Clinical Database
  Demo (version 2.2). PhysioNet. RRID:SCR_007345. https://doi.org/10.13026/dp1f-ex47
- Bennett, A., Ulrich, H., Wiedekopf, J., Szul, P., Grimes, J., & Johnson, A. (2025). MIMIC-IV Clinical Database
  Demo on FHIR (version 2.1.0). PhysioNet. RRID:SCR_007345. https://doi.org/10.13026/vphg-y548
- Bennett, A. M., Ulrich, H., van Damme, P., Wiedekopf, J., & Johnson, A. E. (2023). MIMIC-IV on FHIR: converting a
  decade of in-patient data into an exchangeable, interoperable format. JAMIA 30(4), 718–725.
  https://doi.org/10.1093/jamia/ocad002
- Goldberger, A., et al. (2000). PhysioBank, PhysioToolkit, and PhysioNet. Circulation 101(23), e215–e220.
