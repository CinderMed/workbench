// Every normalized row file of the verified examples is reproduced byte for byte from its
// specification and CSV (fixtures/fml-examples, issue #75).
import type { NormalizationSpec } from "@cindermed/model";
import { describe, expect, it } from "vitest";
import visitSpec from "../../../fixtures/fml-examples/boolean-value-map/normalization-Visit.json" with { type: "json" };
import visitEmptyCsv from "../../../fixtures/fml-examples/boolean-value-map/test-data/visit-empty.csv?raw";
import visitEmpty from "../../../fixtures/fml-examples/boolean-value-map/test-data/visit-empty.normalized.json?raw";
import visitNoCsv from "../../../fixtures/fml-examples/boolean-value-map/test-data/visit-no.csv?raw";
import visitNo from "../../../fixtures/fml-examples/boolean-value-map/test-data/visit-no.normalized.json?raw";
import visitLowerCsv from "../../../fixtures/fml-examples/boolean-value-map/test-data/visit-si-lowercase.csv?raw";
import visitSiCsv from "../../../fixtures/fml-examples/boolean-value-map/test-data/visit-si.csv?raw";
import visitSi from "../../../fixtures/fml-examples/boolean-value-map/test-data/visit-si.normalized.json?raw";
import firstOverviewSpec from "../../../fixtures/fml-examples/metastra/normalization-FirstOverview.json" with { type: "json" };
import negativeCsv from "../../../fixtures/fml-examples/metastra/test-data/negative-row.csv?raw";
import negative from "../../../fixtures/fml-examples/metastra/test-data/negative-row.normalized.json?raw";
import sampleCsv from "../../../fixtures/fml-examples/metastra/test-data/sample-row.csv?raw";
import sample from "../../../fixtures/fml-examples/metastra/test-data/sample-row.normalized.json?raw";
import fallSpec from "../../../fixtures/fml-examples/motu/normalization-Fall.json" with { type: "json" };
import staySpec from "../../../fixtures/fml-examples/motu/normalization-HospitalStay.json" with { type: "json" };
import patientSpec from "../../../fixtures/fml-examples/motu/normalization-MotuPatient.json" with { type: "json" };
import fallInvalidCsv from "../../../fixtures/fml-examples/motu/test-data/Fall-invalid.csv?raw";
import fallInvalid from "../../../fixtures/fml-examples/motu/test-data/Fall-invalid.normalized.json?raw";
import fallCsv from "../../../fixtures/fml-examples/motu/test-data/Fall.csv?raw";
import fall from "../../../fixtures/fml-examples/motu/test-data/Fall.normalized.json?raw";
import stayCsv from "../../../fixtures/fml-examples/motu/test-data/HospitalStay.csv?raw";
import stay from "../../../fixtures/fml-examples/motu/test-data/HospitalStay.normalized.json?raw";
import patientCsv from "../../../fixtures/fml-examples/motu/test-data/MotuPatient.csv?raw";
import patient from "../../../fixtures/fml-examples/motu/test-data/MotuPatient.normalized.json?raw";
import fallFailSpec from "../../../fixtures/fml-examples/tests/fall-fail.json" with { type: "json" };
import { normalize, serializeRows } from "./index.js";

const spec = (document: unknown): NormalizationSpec => document as NormalizationSpec;

const cases = [
  ["metastra sample-row", firstOverviewSpec, sampleCsv, sample],
  ["metastra negative-row", firstOverviewSpec, negativeCsv, negative],
  ["motu MotuPatient", patientSpec, patientCsv, patient],
  ["motu HospitalStay", staySpec, stayCsv, stay],
  ["motu Fall", fallSpec, fallCsv, fall],
  ["motu Fall-invalid (report-drop)", fallSpec, fallInvalidCsv, fallInvalid],
  ["boolean-value-map visit-si", visitSpec, visitSiCsv, visitSi],
  ["boolean-value-map visit-no", visitSpec, visitNoCsv, visitNo],
  ["boolean-value-map visit-empty", visitSpec, visitEmptyCsv, visitEmpty],
] as const;

describe("verified examples", () => {
  it.each(cases)("%s: reproduces the normalized rows byte for byte", (_name, s, csv, expected) => {
    const result = normalize(spec(s), csv);
    if (!result.ok) throw new Error(result.failure.message);
    expect(serializeRows(result.rows)).toBe(expected);
  });

  it("reports the invalid date of Fall-invalid without its value in the message", () => {
    const result = normalize(spec(fallSpec), fallInvalidCsv);
    expect(result).toMatchObject({
      ok: true,
      issues: [{ kind: "invalidValue", row: 1, column: "AdmissionDate", value: "31/02/2023" }],
    });
    if (result.ok) expect(result.issues[0]?.message).not.toContain("31/02/2023");
  });

  it("stops at the first invalid value with onInvalidValue: fail (tests/fall-fail)", () => {
    expect(normalize(spec(fallFailSpec), fallInvalidCsv)).toEqual({
      ok: false,
      failure: {
        kind: "invalidValue",
        row: 1,
        column: "AdmissionDate",
        value: "31/02/2023",
        message:
          'row 1, column "AdmissionDate": the value is not a valid date (onInvalidValue: fail)',
      },
    });
    const valid = normalize(spec(fallFailSpec), fallCsv);
    if (!valid.ok) throw new Error(valid.failure.message);
    expect(serializeRows(valid.rows)).toBe(fall);
  });

  it("stops on 'sì', which is not one of the allowed values Sì/No (visit-si-lowercase)", () => {
    expect(normalize(spec(visitSpec), visitLowerCsv)).toEqual({
      ok: false,
      failure: {
        kind: "notAllowed",
        row: 1,
        column: "fumatore",
        value: "sì",
        message:
          'row 1, column "fumatore": the value is not an allowed value (onInvalidValue: fail)',
      },
    });
  });
});
