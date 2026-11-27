import { describe, expect, it } from "vitest";
import type { Column, Source } from "../generated/project.js";
import { columnTimeZone, takesTimeZone } from "./time-zones.js";

const column = (patch: Partial<Column>): Column => ({
  id: "col_time01",
  name: "measured_at",
  dataType: "dateTime",
  ...patch,
});
const source = (timeZone?: string): Source => ({
  id: "src_visit1",
  name: "Visit",
  ...(timeZone === undefined ? {} : { timeZone }),
  columns: [column({})],
});

describe("columnTimeZone", () => {
  it("takes the column's own zone over its table's", () => {
    expect(columnTimeZone(source("Europe/Rome"), column({ timeZone: "Z" }))).toBe("Z");
    expect(columnTimeZone(source("Europe/Rome"), column({}))).toBe("Europe/Rome");
    expect(columnTimeZone(source(), column({}))).toBeUndefined();
  });

  it("gives no zone to a column whose values have no time", () => {
    const dateOnly = column({ dateFormat: "dd/MM/yyyy", timeZone: "Z" });
    expect(takesTimeZone(dateOnly)).toBe(false);
    expect(columnTimeZone(source("Europe/Rome"), dateOnly)).toBeUndefined();
    const date = column({ dataType: "date", timeZone: "Z" });
    expect(columnTimeZone(source("Europe/Rome"), date)).toBeUndefined();
    expect(takesTimeZone(column({}))).toBe(true);
    expect(takesTimeZone(column({ dateFormat: "dd/MM/yyyy HH:mm" }))).toBe(true);
  });
});
