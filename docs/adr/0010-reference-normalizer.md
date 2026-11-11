# ADR-0010: Reference normalizer: hashing library, decoding, CSV reader and reports

- Status: accepted
- Date: 2026-11-11
- Module: 2 (Generator and package)

## Context

`@cindermed/normalizer` is the TypeScript reference implementation of the normalization specification (normalization.schema.json 1.2.0). It ports `fixtures/fml-examples/tools/normalize.mjs`, and the two must give the same rows byte for byte. The package is a domain package, so it does no I/O (ADR-0001). It must run in Node, for the export and the conversion module, and in the browser, for previews and the module 5 import wizard. Ids are SHA-256, or HMAC-SHA256 with a key kept outside the package. The data file may come as bytes in one of four encodings. Reports may contain patient data, and the logs must not (CLAUDE.md).

## Decision

- **Hashing: @noble/hashes 2.4.0**, pinned exactly (`sha256`, `hmac`, `bytesToHex`, `utf8ToBytes`).
  - It is synchronous, pure JavaScript, audited, has no dependencies and runs in Node and in the browser.
  - `node:crypto` would tie the package to Node. WebCrypto (`crypto.subtle`) is asynchronous only, and that would make the whole normalizer asynchronous.
- **HMAC.** With `hash.keyId`, the caller gives the key through `options.hmacKey(keyId)`, as bytes or UTF-8 text.
  - A missing key is a failure (`hmacKeyMissing`), whatever `onInvalidValue` says.
  - The key and the key id never appear in issues or messages.
- **Decoding follows the WHATWG Encoding Standard** (`TextDecoder`), everywhere: in the package, in the reference `normalize.mjs`, and in the normalization schema's description of `input.encoding`.
  - `iso-8859-1` is decoded as windows-1252, so 0x80 is `€`. UTF-8 drops a leading byte order mark.
  - Input can be text, used as it is, or bytes, decoded with `input.encoding`.
  - Domain packages load no DOM or Node types, so the package declares the two `TextDecoder` members it uses.
- **CSV reader.** `parseCsv` (RFC 4180: quotes, doubled quotes, line ends inside quotes, `\n`, `\r\n` and `\r`) is exported from `@cindermed/normalizer`. The module 5 import wizard reuses it, so the file the user previews is read exactly as the conversion reads it.
- **Numbers in memory.** Integers and decimals stay as canonical text, in a tagged value `{ kind: "number", text }`, never as JavaScript numbers. That keeps digits such as `11.20` and integers beyond 2^53. Only `serializeRows` writes them as JSON numbers.
- **Reports.** Each issue has `kind` (`invalidValue`, `notAllowed`, `invalidId`, `hmacKeyMissing`), plus `row`, `column` or `idField`, and `value`.
  - The cell value or computed id is only in `value`, never in `message`, so messages can be logged.
  - With `onInvalidValue: fail`, the first invalid value is returned as `failure` with no rows. Nothing is thrown and nothing exits.
- **Same behaviour as the reference.**
  - The run-time `input` settings override the specification's, as ADR-0009 says.
  - An id that is not a valid FHIR id is reported and left out, even with `fail`, as in `normalize.mjs`.
  - The cell parsers come from `@cindermed/model`, so integrity rule 9 and the conversion agree.
- **Tests.**
  - Every `*.normalized.json` of the verified examples is reproduced byte for byte.
  - A differential test (`tooling/normalizer-reference.test.ts`) runs the package and `normalize.mjs` on the same bytes. It compares rows byte for byte, and issues by row, column or id field, kind and value. It does not compare message text.

## Consequences

- The reference `normalize.mjs` and the package change together. A behaviour change needs both, plus a differential case.
- Decoding with `iso-8859-1` differs from a strict Latin-1 reader for bytes 0x80–0x9F. That is the decision, and the schema says so. A file that really holds C1 control characters is not supported.
- A 20-digit integer or `11.20` stays exact in memory. A caller that needs a JavaScript number must convert it and accept the loss.
- Revisit the hashing library if the platform gets a synchronous WebCrypto digest, or if a FIPS-validated implementation becomes a requirement.

## Addendum (2026-11-11): streaming, row by row

CinderMed must handle any tabular dataset. Long tables such as an ICU lab-event extract can hold hundreds of millions of rows, so the normalizer must not hold a whole file in memory.

- **Core per row.** `normalizeRow(spec, record, context)` normalizes one record. The record maps each header (NFC, trimmed) to its cell, and the context gives the row number and the HMAC key. It is pure and synchronous, and it returns a row (with its issues), a row rejected under `reject-row`, or the failure of `fail`. Nothing is kept between records.
- **Incremental CSV.** `CsvReader` takes text in chunks of any size and returns only the records each chunk completes. It is a state machine (in a field, in a quoted part, after a quote inside a quoted part, after a CR), so a quote, a doubled quote or a CR LF split by a chunk boundary is read as if the text were whole. `parseCsv` uses the same reader on a whole text.
- **Incremental decoding.** `createDecoder(encoding)` decodes byte chunks with `TextDecoder` in stream mode, so a multi-byte character split across chunks is decoded once. It drops a byte order mark only at the start of the file.
- **Stream API.** `createNormalizer(spec, options)` returns `push(chunk)` and `end()`, which give events (`row`, `issue`, `failed`). `normalizeStream` wraps it for async or sync iterables, such as a Node stream. After `failed`, the rest of the file is ignored.
- **Built on top.** The whole-file `normalize()` and `serializeRows()` use the stream API and stay byte-identical to `normalize.mjs`. The differential test and the fixtures are unchanged. `serializeRowNdjson` writes one compact row per line (NDJSON) for streaming output.
- **Tests.**
  - Every split of a sample's bytes into two chunks, one-byte chunks and one-character chunks give the same events as the whole input. The sample has quoted cells with delimiters, doubled quotes and line breaks, CRLF and CR, a BOM, and 2-, 3- and 4-byte UTF-8 characters.
  - `tooling/normalizer-memory.test.ts` streams generated rows of a long lab-event shape, never committed or written to disk, through the built package. The heap after a full GC must not grow by more than 4 MB between the first and the last checkpoint. PR checks use 100,000 rows (about 2 seconds); the nightly workflow (`nightly.yml`) uses 1,000,000 rows. Measured at 1,000,000 rows: flat at about 5.4 MB, in about 16 seconds.
