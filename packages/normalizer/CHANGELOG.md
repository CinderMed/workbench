# @cindermed/normalizer

## 0.2.0

### Minor Changes

- 29d3164: Time zones at the border (#107, ADR-0024). Project format 1.5.0 adds an optional `timeZone` on a table and on a column: a fixed offset (`+01:00`, `Z`) or an IANA zone (`Europe/Rome`). Normalization 1.3.0 writes a dateTime with a time with its offset (`2025-01-15T10:00:00+01:00`). An IANA zone's offsets come from the zone's rules in the specification's new `timeZones`, which the export copies from a committed tzdata snapshot (2026e, 1970–2299), so every implementation gives the same result without a time-zone library. A local time in the spring-forward gap is an invalid value; one in the repeated fall-back hour takes the earlier offset. Integrity rule 10 reports a zone the snapshot does not have (`TIME_ZONE_UNKNOWN`, error) and a zone on a column that is not dateTime (`TIME_ZONE_NOT_DATETIME`, warning). Projects without a zone convert as before.

### Patch Changes

- 5b5460c: Each package now has the metadata a publish needs: `repository`, `homepage`, `bugs`, `engines` (Node 22.12 or later), a README and the LICENSE. Its tarball holds only `dist/` without source maps, its LICENSE and its README. Nothing is published: npm publishing is deferred after the MVP (#199), and every package stays private.
- Updated dependencies [6b56067]
- Updated dependencies [29d3164]
- Updated dependencies [e625743]
- Updated dependencies [5b5460c]
- Updated dependencies [3d4a3f1]
  - @cindermed/model@0.6.0

## 0.1.2

### Patch Changes

- Updated dependencies [84850af]
- Updated dependencies [232b1ec]
  - @cindermed/model@0.5.0

## 0.1.1

### Patch Changes

- Updated dependencies [7f23a9a]
- Updated dependencies [db6c645]
- Updated dependencies [87fe1bd]
- Updated dependencies [911e043]
  - @cindermed/model@0.4.0

## 0.1.0

### Minor Changes

- 7111d06: First release of the reference normalizer: `normalize(spec, input, options)` turns CSV text or bytes into normalized rows and issues (normalization 1.2.0), with SHA-256 or HMAC-SHA256 ids, WHATWG decoding, `serializeRows` byte-identical to the reference `normalize.mjs`, and the CSV reader `parseCsv`. The normalization schema describes the WHATWG decoding of `input.encoding`.
- 609a0b4: The normalizer streams: `normalizeRow` normalizes one record (pure, synchronous), `CsvReader` and `createDecoder` read chunks of text or bytes, `createNormalizer`/`normalizeStream` turn chunks into row and issue events with flat memory, and `serializeRowNdjson` writes one row per line. `normalize` and `serializeRows` are built on them and still match the reference normalizer byte for byte.

### Patch Changes

- Updated dependencies [fb6d6a8]
- Updated dependencies [5724d33]
- Updated dependencies [2940d8e]
- Updated dependencies [7111d06]
- Updated dependencies [4d77491]
- Updated dependencies [391d212]
- Updated dependencies [5724d33]
  - @cindermed/model@0.3.0
