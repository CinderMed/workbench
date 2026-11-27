/**
 * The workbench's tzdata snapshot (ADR-0024): for every IANA zone, its offset on 1970-01-01 and
 * each change until 2300-01-01, written by tooling/time-zones/build-zones.mjs from a pinned tzdata
 * and changed only in a dedicated PR. The export copies the zones a table uses into its
 * normalization specification, so the conversion gives the same offsets on every machine.
 */
import type { ZoneRuleSource } from "@cindermed/fml";
import snapshot from "./zones.json" with { type: "json" };

const zones: Readonly<Record<string, readonly number[]>> = snapshot.zones;

export const ZONE_RULES: ZoneRuleSource = {
  tzdata: snapshot.tzdata,
  from: snapshot.from,
  to: snapshot.to,
  zone: (name) => (Object.hasOwn(zones, name) ? zones[name] : undefined),
};
