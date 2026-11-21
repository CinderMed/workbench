/**
 * Tests only: the written paths of a project as the export resolves them from the FHIR definitions
 * (ADR-0023), here from an explicit list of the choice elements the fixtures and the test projects
 * use, so the fml tests need no definitions. The golden suite checks the real resolution: it
 * exports every fixture with the R4 definitions and compares the maps.
 */
import type { ProjectFile } from "@cindermed/model";
import {
  type WrittenPaths,
  type WrittenSegment,
  pathKey,
  pathsToWrite,
} from "../generator/written-paths.js";

/** Choice elements (`<type>.<path of base names>`) of the R4 resources the tests use. */
const CHOICES = new Set([
  "Observation.value",
  "Observation.component.value",
  "Observation.effective",
  "Condition.onset",
  "Condition.abatement",
  "Immunization.occurrence",
  "Immunization.protocolApplied.doseNumber",
  "MedicationDispense.medication",
  "Patient.multipleBirth",
  "Patient.deceased",
  "Procedure.performed",
  "RiskAssessment.occurrence",
]);

/** Primitive types, named in lower camel case after a choice element (`valueDateTime` → dateTime). */
const PRIMITIVES = new Set([
  "base64Binary",
  "boolean",
  "canonical",
  "code",
  "date",
  "dateTime",
  "decimal",
  "id",
  "instant",
  "integer",
  "markdown",
  "oid",
  "positiveInt",
  "string",
  "time",
  "unsignedInt",
  "uri",
  "url",
  "uuid",
]);

function segmentsOf(resourceType: string, path: string): WrittenSegment[] {
  const written: WrittenSegment[] = [];
  for (const part of path.split(".")) {
    const name = part.replace(/\[.*\]$/, "");
    const owner = [resourceType, ...written.map((w) => w.name)].join(".");
    const base = [...CHOICES]
      .filter((choice) => choice.startsWith(`${owner}.`))
      .map((choice) => choice.slice(owner.length + 1))
      .find(
        (b) =>
          !b.includes(".") &&
          name.length > b.length &&
          name.startsWith(b) &&
          /[A-Z]/.test(name.charAt(b.length)),
      );
    if (base === undefined) {
      written.push({ name });
      continue;
    }
    const suffix = name.slice(base.length);
    const lower = suffix.charAt(0).toLowerCase() + suffix.slice(1);
    written.push({ name: base, choiceType: PRIMITIVES.has(lower) ? lower : suffix });
  }
  return written;
}

/** The written paths of every role of a project. */
export function testWrittenPaths(project: ProjectFile): WrittenPaths {
  const paths = new Map<string, readonly WrittenSegment[]>();
  for (const instance of project.instances)
    for (const path of pathsToWrite(project, instance))
      paths.set(pathKey(instance.id, path), segmentsOf(instance.resourceType, path));
  return paths;
}
