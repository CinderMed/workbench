---
"@cindermed/model": minor
"@cindermed/fml": minor
"@cindermed/export": minor
"@cindermed/web": minor
---

A quantity can take its unit text from a column (project format 1.5.0, #108): `unitColumnId` without `unitValueMapId` writes `src.uom as u -> q.unit = u`, one rule for any number of units, such as MIMIC-IV's `valueuom`. The new optional `unitSystem` also writes the text as the code of that system (`q.system = '<system>', q.code = u`); the schema accepts it only with `unitColumnId` and without `unitValueMapId`. Before, a unit column without a value map wrote no unit. The mapping table names the unit text and its system, and the grid's quantity editor offers "Unit text from a column" with the optional code system.
