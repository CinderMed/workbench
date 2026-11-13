# @cindermed/normalizer

## 0.1.1

### Patch Changes

- Updated dependencies [db6c645]
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
