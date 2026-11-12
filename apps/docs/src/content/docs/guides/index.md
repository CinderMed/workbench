---
title: Guides
description: Worked examples of mapping tabular datasets to FHIR, one for each data shape.
---

CinderMed works with any tabular dataset that can be mapped to FHIR: registries, REDCap exports, EHR and ICU extracts, research databases and trial data. What matters is the shape of the data, not where it comes from:

- **Wide table**: one row per record, one column per variable.
- **Long table**: one row per measurement, with a column that says what was measured and columns that hold the value.
- **Several related tables**: tables linked by keys, mapped to resources that reference each other.

Data from a database comes in as its tables exported to CSV. Documents (JSON, XML), HL7 v2 messages, free text and images are not supported for now.

The worked examples each show one shape:

- **Metastra** (wide table): import a data dictionary, create the resource roles, fill in value maps and export the FML package.
- **MOTU** (several related tables): three tables linked by keys, with references between resources.
- A long-table example is planned.

Each example is a project file in the repository, checked on every change, so what you read here always works.
