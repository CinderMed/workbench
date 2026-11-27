/**
 * Tests only: the workbench's tzdata snapshot (ADR-0024) as the export passes it to the generator,
 * so the golden tests write the same `timeZones` as the export. The generator itself never reads
 * the snapshot: it gets the rules as plain data (`ZoneRuleSource`).
 */
import snapshot from "../../../export/src/time-zones/zones.json" with { type: "json" };
import type { ZoneRuleSource } from "../generator/normalization-spec.js";

const zones: Readonly<Record<string, readonly number[]>> = snapshot.zones;

export const TEST_ZONE_RULES: ZoneRuleSource = {
  tzdata: snapshot.tzdata,
  from: snapshot.from,
  to: snapshot.to,
  zone: (name) => (Object.hasOwn(zones, name) ? zones[name] : undefined),
};
