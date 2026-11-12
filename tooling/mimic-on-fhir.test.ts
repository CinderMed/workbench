// Long-format golden case (#105): the Bundle our generated maps produce from the MIMIC-IV demo slice
// is compared with the open MIMIC-IV on FHIR demo (ODbL) on the key fields, not byte for byte: the
// demo uses its own profiles and ids. Resources are matched by identifier, and references are
// resolved to the source keys (subject_id, hadm_id) on both sides.
//
// Not compared, each a gap of the model or the generator (see the fixtures README):
// - times (effectiveDateTime, issued, Encounter.period): no time zone at the border yet (#107);
// - Patient.birthDate: derived from anchor_year and anchor_age in the demo (derived columns, B10);
// - referenceRange (ref_range_lower/upper), specimen, the lab-priority extension, flag;
// - the units system of a number without a unit (#108, see valueQuantity below).
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
  switch (r.resourceType) {
    case "Patient":
      return { gender: r["gender"] };
    case "Encounter": {
      const cls = r["class"] as Record<string, string>;
      return {
        status: r["status"],
        class: { system: cls["system"], code: cls["code"] },
        subject: ref("subject"),
      };
    }
    default: {
      const quantity = r["valueQuantity"] as Record<string, unknown> | undefined;
      return {
        status: r["status"],
        category: (r["category"] as { coding: Record<string, string>[] }[]).map(
          (c) => c.coding[0]?.["code"],
        ),
        code: coding("code"),
        valueQuantity:
          quantity === undefined
            ? undefined
            : {
                value: Number(quantity["value"]),
                unit: quantity["unit"],
                // Known difference (#108): for a number without a unit the demo still writes the
                // units system; our quantity writes system, unit and code only from a unit value.
                system: quantity["code"] === undefined ? undefined : quantity["system"],
                code: quantity["code"],
              },
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
});
