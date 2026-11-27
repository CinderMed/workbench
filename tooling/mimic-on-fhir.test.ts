// Long-format golden case (#105): the Bundle our generated maps produce from the MIMIC-IV demo slice
// is compared with the open MIMIC-IV on FHIR demo (ODbL) on the key fields, not byte for byte: the
// demo uses its own profiles and ids. Resources are matched by identifier, and references are
// resolved to the source keys (subject_id, hadm_id) on both sides.
//
// Times are compared with their offsets (#107): the tables declare America/New_York, whose
// daylight-saving rules MIMIC-IV on FHIR applies to the shifted dates (-04:00, -05:00).
//
// Key fields (#198): identifier (system and value), status, codes, subject and encounter, times,
// value with unit, system and code, reference range, gender, class. The elements only the demo
// writes are listed in ACCEPTED, each with its reason, and checked exactly: a new difference fails,
// and so does a listed one that is gone (remove it then). `meta` holds the demo's profiles.
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const dir = resolve(import.meta.dirname, "../fixtures/fml-examples/mimic-iv-demo");
type Resource = Record<string, unknown> & { resourceType: string; id: string };

const ours: Resource[] = (
  JSON.parse(readFileSync(join(dir, "test-data/bundle-merged.json"), "utf8")) as {
    entry: { resource: Resource }[];
  }
).entry.map((e) => e.resource);
const theirs: Resource[] = ["Patient", "Encounter", "Observation"].flatMap((type) =>
  readFileSync(join(dir, `mimic-on-fhir/${type}.ndjson`), "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as Resource),
);

const identifier = (r: Resource): string =>
  (r["identifier"] as { value: string }[] | undefined)?.[0]?.value ?? "";

/** Source key of every resource, by `Type/id`, so references compare across the two id schemes. */
function keys(resources: Resource[]): Map<string, string> {
  return new Map(
    resources.map((r) => [`${r.resourceType}/${r.id}`, `${r.resourceType}:${identifier(r)}`]),
  );
}

/** Elements only MIMIC-IV on FHIR writes, by resource type, with the reason each is accepted. */
const ACCEPTED: Record<string, Record<string, string>> = {
  Patient: {
    birthDate: "derived from anchor_year and anchor_age in the demo (derived columns, B10)",
    name: "a synthetic name (Patient_<subject_id>) the source has no column for",
    communication: "from admissions.language, a per-admission value, not mapped on Patient",
    maritalStatus: "from admissions.marital_status, a per-admission value, not mapped on Patient",
    extension:
      "US Core race, ethnicity and birth sex: race is per admission, birth sex a profile rule",
    managingOrganization: "the demo's Organization resource, outside the slice",
  },
  Encounter: {
    type: "a fixed SNOMED code of the demo's profile, not a source value",
    priority: "admission_type mapped to v3-ActPriority: not mapped in the slice",
    serviceType: "from the services table, outside the slice",
    hospitalization: "admission_location and discharge_location: not mapped in the slice",
    location: "from the transfers table, outside the slice",
    serviceProvider: "the demo's Organization resource, outside the slice",
  },
  Observation: {
    issued: "storetime is not mapped",
    specimen: "specimen_id refers to a Specimen resource, outside the slice",
    extension: "the lab-priority extension (priority is not mapped)",
  },
};

/**
 * Accepted at value level: for a number without a unit the demo still writes the units system;
 * our quantity writes unit, system and code only from a unit text (#108).
 */
const SYSTEM_WITHOUT_UNIT = "system without unit";

function keyFields(r: Resource, refs: Map<string, string>): Record<string, unknown> {
  const ref = (field: string) => {
    const reference = (r[field] as { reference?: string } | undefined)?.reference;
    return reference === undefined ? undefined : refs.get(reference);
  };
  const coding = (field: string) =>
    ((r[field] as { coding?: Record<string, string>[] } | undefined)?.coding ?? []).map((c) => ({
      system: c["system"],
      code: c["code"],
      display: c["display"],
    }));
  const id = (r["identifier"] as Record<string, string>[] | undefined)?.map((i) => ({
    system: i["system"],
    value: i["value"],
  }));
  switch (r.resourceType) {
    case "Patient":
      return { identifier: id, gender: r["gender"] };
    case "Encounter": {
      const cls = r["class"] as Record<string, string>;
      return {
        identifier: id,
        status: r["status"],
        class: { system: cls["system"], code: cls["code"] },
        subject: ref("subject"),
        period: r["period"],
      };
    }
    default: {
      const quantity = (q: Record<string, unknown> | undefined) =>
        q === undefined
          ? undefined
          : {
              value: Number(q["value"]),
              unit: q["unit"],
              // SYSTEM_WITHOUT_UNIT, accepted.
              system: q["code"] === undefined ? undefined : q["system"],
              code: q["code"],
            };
      const ranges = r["referenceRange"] as Record<string, Record<string, unknown>>[] | undefined;
      return {
        identifier: id,
        status: r["status"],
        effectiveDateTime: r["effectiveDateTime"],
        category: (r["category"] as { coding: Record<string, string>[] }[]).map(
          (c) => c.coding[0]?.["code"],
        ),
        code: coding("code"),
        valueQuantity: quantity(r["valueQuantity"] as Record<string, unknown> | undefined),
        referenceRange: ranges?.map((range) => ({
          low: quantity(range["low"]),
          high: quantity(range["high"]),
        })),
        valueString: r["valueString"],
        note: (r["note"] as { text: string }[] | undefined)?.map((n) => n.text),
        subject: ref("subject"),
        encounter: ref("encounter"),
      };
    }
  }
}

describe("MIMIC-IV demo slice against MIMIC-IV on FHIR (key fields)", () => {
  const ourRefs = keys(ours);
  const theirRefs = keys(theirs);
  const byKey = (resources: Resource[]) =>
    new Map(resources.map((r) => [`${r.resourceType}:${identifier(r)}`, r]));
  const mine = byKey(ours);
  const reference = byKey(theirs);

  it("produces the same resources (3 Patients, 3 Encounters, 60 Observations)", () => {
    expect([...mine.keys()].sort()).toEqual([...reference.keys()].sort());
    expect(mine.size).toBe(66);
  });

  it.each([...reference.keys()].sort())("%s has the same key fields", (key) => {
    const our = mine.get(key);
    const their = reference.get(key);
    if (our === undefined || their === undefined) throw new Error(`missing ${key}`);
    expect(keyFields(our, ourRefs)).toEqual(keyFields(their, theirRefs));
  });

  it("differs only by the accepted elements, each still a difference", () => {
    // Elements one side writes and the other does not, by resource type (meta: the demo's profiles).
    const onlyIn = (a: Map<string, Resource>, b: Map<string, Resource>) => {
      const found: Record<string, Set<string>> = {};
      for (const [key, r] of a) {
        const other = b.get(key) ?? {};
        for (const element of Object.keys(r))
          if (element !== "meta" && !(element in other))
            (found[r.resourceType] ??= new Set()).add(element);
      }
      return Object.fromEntries(
        Object.entries(found).map(([type, elements]) => [type, [...elements].sort()]),
      );
    };
    const accepted = Object.fromEntries(
      Object.entries(ACCEPTED).map(([type, elements]) => [type, Object.keys(elements).sort()]),
    );
    expect(onlyIn(reference, mine)).toEqual(accepted);
    expect(onlyIn(mine, reference)).toEqual({});
  });

  it(`still has the accepted value-level difference: ${SYSTEM_WITHOUT_UNIT}`, () => {
    const withoutUnit = [...reference.values()].filter((r) => {
      const q = r["valueQuantity"] as Record<string, unknown> | undefined;
      return q !== undefined && q["code"] === undefined && q["system"] !== undefined;
    });
    expect(withoutUnit.length).toBeGreaterThan(0);
  });
});
