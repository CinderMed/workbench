---
"@cindermed/normalizer": minor
---

The normalizer streams: `normalizeRow` normalizes one record (pure, synchronous), `CsvReader` and `createDecoder` read chunks of text or bytes, `createNormalizer`/`normalizeStream` turn chunks into row and issue events with flat memory, and `serializeRowNdjson` writes one row per line. `normalize` and `serializeRows` are built on them and still match the reference normalizer byte for byte.
