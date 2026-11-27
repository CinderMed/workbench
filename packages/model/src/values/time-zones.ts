/**
 * Time zones a project can declare (project format 1.5.0, ADR-0024): a fixed offset, or a zone of
 * the workbench's tzdata snapshot (`time-zone-names.json`, written with the offsets by
 * tooling/time-zones/build-zones.mjs). Only the names live here, so the check runs in the browser
 * too; the offsets are in @cindermed/export.
 */
import snapshot from "./time-zone-names.json" with { type: "json" };

/** Version of the IANA tzdata of the snapshot (e.g. 2026e). */
export const TZDATA_VERSION: string = snapshot.tzdata;

const NAMES: ReadonlySet<string> = new Set(snapshot.names);

/** A fixed offset as the schema accepts it: `Z`, `+01:00`, `-05:30`, up to ±14:00. */
export const isFixedOffset = (zone: string): boolean =>
  /^(Z|[+-](0[0-9]|1[0-3]):[0-5][0-9]|[+-]14:00)$/.test(zone);

/** A fixed offset, or an IANA zone of the snapshot. */
export const isKnownTimeZone = (zone: string): boolean => isFixedOffset(zone) || NAMES.has(zone);

/**
 * Whether a dateTime column's values have a time: its `dateFormat` has `HH`, or it has none (the
 * default `yyyy-MM-ddTHH:mm:ss`). Only such values get an offset.
 */
export const formatHasTime = (dateFormat: string | undefined): boolean =>
  dateFormat === undefined || dateFormat.includes("HH");
