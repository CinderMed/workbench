# @cindermed/model

## 0.2.0

### Minor Changes

- 9621442: Add `checkIntegrity` with integrity rules 1–3 (unique ids and valid references, unique role keys and row codes, columns from the right table) and their stable `IntegrityCode` result codes.
- baa2634: Check integrity rules 4–8 (structural parts): declared slices, reachable references, value map source values, resource id length and characters, `repeat: eachValue` on multiple-choice columns. Export `MAX_ID_LENGTH` and `idLength`.
- 0f9df12: Read and write the JSON project file (H3): `parseProject` (JSON, format version, schema and integrity checks), `serializeProject` (canonical schema key order), `validateProject`, `migrateProject` with the `PROJECT_MIGRATIONS` registry, and the `ProjectFileCode` result codes `INVALID_JSON` and `UNSUPPORTED_FORMAT_VERSION`.
- 242c717: Export TypeScript types generated from the JSON Schemas (`ProjectFile` and its parts, `NormalizationSpec`, `ExportManifest`) and the type guards `isProjectFile`, `isNormalizationSpec` and `isExportManifest`.

## 0.1.0

### Minor Changes

- 5704d2e: Add the project (1.2.0), normalization (1.0.0) and manifest (1.0.0) JSON Schemas with Ajv validators that return results in the shared `{severity, code, objectKind, id, field, message}` shape.
