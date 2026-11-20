import { Badge, Table, Text, UnstyledButton } from "@mantine/core";
import type { ProjectFile, ValidationResult } from "@cindermed/model";
import { useTranslation } from "react-i18next";
import { type CellAddress, locateFinding } from "../grid/findings";

export interface FindingsListProps {
  readonly project: ProjectFile;
  readonly results: readonly ValidationResult[];
  /** Selects the cell of a finding in the grid. */
  readonly onChoose: (address: CellAddress) => void;
}

/**
 * Every finding of the project (D7): severity, code, message, and where it is (row and column).
 * Choosing one selects its cell; findings with no cell in the grid (project or role level) are
 * listed too, with where they point.
 */
export function FindingsList({ project, results, onChoose }: FindingsListProps) {
  const { t } = useTranslation();
  const tables = new Map(project.sources.map((s) => [s.id, s.name]));
  const codes = new Map(project.mappings.map((m) => [m.id, m.code]));
  const columns = new Map(project.sources.flatMap((s) => s.columns.map((c) => [c.id, c.name])));
  const sorted = [...results].sort(
    (a, b) => Number(b.severity === "error") - Number(a.severity === "error"),
  );
  if (sorted.length === 0) return <Text>{t("findings.none")}</Text>;
  return (
    <Table aria-label={t("findings.title")} striped highlightOnHover>
      <Table.Thead>
        <Table.Tr>
          <Table.Th>{t("findings.column.severity")}</Table.Th>
          <Table.Th>{t("findings.column.code")}</Table.Th>
          <Table.Th>{t("findings.column.message")}</Table.Th>
          <Table.Th>{t("findings.column.row")}</Table.Th>
          <Table.Th>{t("findings.column.where")}</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {sorted.map((result, i) => {
          const address = locateFinding(project, result);
          const row =
            address === undefined
              ? ""
              : (codes.get(address.rowKey) ??
                columns.get(address.rowKey.replace(/^column:/, "")) ??
                "");
          const where =
            address === undefined
              ? t(`findings.object.${result.objectKind}`, { defaultValue: result.objectKind })
              : `${t(`grid.column.${address.column}`)}${project.sources.length > 1 ? ` · ${tables.get(address.sourceId) ?? ""}` : ""}`;
          const label = `${result.code}: ${result.message}`;
          return (
            <Table.Tr key={i}>
              <Table.Td>
                <Badge color={result.severity === "error" ? "red" : "yellow"} size="sm">
                  {t(`details.${result.severity}`)}
                </Badge>
              </Table.Td>
              <Table.Td>
                <code>{result.code}</code>
              </Table.Td>
              <Table.Td>
                {address === undefined ? (
                  result.message
                ) : (
                  <UnstyledButton
                    aria-label={t("findings.goTo", { finding: label })}
                    onClick={() => {
                      onChoose(address);
                    }}
                    style={{ textDecoration: "underline", textAlign: "left" }}
                  >
                    {result.message}
                  </UnstyledButton>
                )}
              </Table.Td>
              <Table.Td>{row}</Table.Td>
              <Table.Td>{where}</Table.Td>
            </Table.Tr>
          );
        })}
      </Table.Tbody>
    </Table>
  );
}
