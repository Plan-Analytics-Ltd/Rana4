/**
 * Hybrid import workbook template — sheet names and column headers must stay aligned
 * with import parsers (Assignments in assignments.parser.ts; other sheets when import ships).
 */

import ExcelJS from "exceljs";

const HEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFD9D9D9" },
};

const HEADER_FONT: Partial<ExcelJS.Font> = { bold: true };

const LIST_LEVEL = '"ACTIVITY,DELIVERABLE"';
const LIST_STATUS = '"DRAFT,PENDING_APPROVAL,ACTIVE,LOCKED"';
const LIST_REL_TYPE = '"FS,SS,FF,SF"';

function styleDataSheetHeader(ws: ExcelJS.Worksheet, lastCol: number): void {
  ws.views = [{ state: "frozen", ySplit: 1 }];
  const row = ws.getRow(1);
  row.height = 20;
  for (let c = 1; c <= lastCol; c++) {
    const cell = row.getCell(c);
    cell.font = { ...HEADER_FONT };
    cell.fill = HEADER_FILL;
    cell.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
  }
}

/** Rough auto-width from cell contents (cap max width). */
function autosizeColumns(ws: ExcelJS.Worksheet, colCount: number, maxW = 52): void {
  for (let c = 1; c <= colCount; c++) {
    let maxLen = 10;
    ws.getColumn(c).eachCell({ includeEmpty: false }, (cell) => {
      const raw = cell.value;
      let len = 0;
      if (raw === null || raw === undefined) len = 0;
      else if (typeof raw === "object" && "richText" in (raw as object)) len = 32;
      else len = String(raw).length;
      if (len > maxLen) maxLen = len;
    });
    ws.getColumn(c).width = Math.min(Math.max(maxLen + 2, 12), maxW);
  }
}

/** exceljs exposes dataValidations at runtime; typings omit it on Worksheet. */
type WorksheetWithDataValidations = ExcelJS.Worksheet & {
  dataValidations: {
    add(
      address: string,
      validation: {
        type: "list";
        allowBlank?: boolean;
        formulae: string[];
        showErrorMessage?: boolean;
        errorStyle?: string;
        errorTitle?: string;
        error?: string;
      }
    ): void;
  };
};

function addListValidation(ws: ExcelJS.Worksheet, rangeA1: string, formulaeQuotedList: string): void {
  (ws as WorksheetWithDataValidations).dataValidations.add(rangeA1, {
    type: "list",
    allowBlank: true,
    formulae: [formulaeQuotedList],
    showErrorMessage: true,
    errorStyle: "error",
    errorTitle: "Invalid value",
    error: "Pick a value from the list.",
  });
}

export async function generateImportTemplate(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Rana4";
  wb.created = new Date();

  // --- Standards
  const standards = wb.addWorksheet("Standards", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  standards.addRow(["standard_name", "description"]);
  standards.addRow(["Example Standard", "Optional description"]);
  standards.addRow(["Secondary Example Standard", "Second optional description"]);
  styleDataSheetHeader(standards, 2);
  autosizeColumns(standards, 2);

  // --- Fragnets
  const fragnets = wb.addWorksheet("Fragnets");
  fragnets.addRow(["fragnet_name", "standard_name", "description"]);
  fragnets.addRow(["IFC", "Example Standard", "Optional description"]);
  fragnets.addRow(["Phase 2 Close-out", "Example Standard", "Second fragnet example"]);
  styleDataSheetHeader(fragnets, 3);
  autosizeColumns(fragnets, 3);

  // --- Deliverables
  const deliverables = wb.addWorksheet("Deliverables");
  deliverables.addRow(["deliverable_name", "fragnet_name", "best_duration", "likely_duration", "external_project_id"]);
  deliverables.addRow(["IFC Drawings", "IFC", 10, 15, "EXT-001"]);
  deliverables.addRow(["Specifications", "IFC", 8, 12, "EXT-001"]);
  styleDataSheetHeader(deliverables, 5);
  autosizeColumns(deliverables, 5);

  // --- Activities
  const activities = wb.addWorksheet("Activities");
  activities.addRow([
    "activity_code",
    "activity_name",
    "fragnet_name",
    "deliverable_name",
    "best_duration",
    "likely_duration",
    "status",
  ]);
  activities.addRow(["A1001", "Internal Check", "IFC", "IFC Drawings", 5, 5, "DRAFT"]);
  activities.addRow(["A1002", "External Review", "IFC", "IFC Drawings", 3, 4, "DRAFT"]);
  styleDataSheetHeader(activities, 7);
  addListValidation(activities, "G2:G5000", LIST_STATUS);
  autosizeColumns(activities, 7);

  // --- Assignments (column order matches assignments.parser canon keys)
  const assignments = wb.addWorksheet("Assignments");
  assignments.addRow([
    "level",
    "fragnet_name",
    "deliverable_name",
    "activity_code",
    "resource_type",
    "resource_name",
    "units",
  ]);
  assignments.addRow(["DELIVERABLE", "IFC", "IFC Drawings", "", "Labour", "Engineer", 10]);
  assignments.addRow(["ACTIVITY", "IFC", "IFC Drawings", "A1001", "Labour", "Engineer", 5]);
  assignments.addRow(["ACTIVITY", "IFC", "IFC Drawings", "A1001", "Plant", "Crane", 2]);
  assignments.addRow(["DELIVERABLE", "IFC", "Specifications", "", "Labour", "Quantity Surveyor", 8]);
  styleDataSheetHeader(assignments, 7);
  addListValidation(assignments, "A2:A5000", LIST_LEVEL);
  autosizeColumns(assignments, 7);

  // --- Relationships
  const relationships = wb.addWorksheet("Relationships");
  relationships.addRow([
    "fragnet_name",
    "predecessor_activity_code",
    "successor_activity_code",
    "relationship_type",
    "lag",
  ]);
  relationships.addRow(["RIBA 4", "A1000", "A1001", "FS", "+5"]);
  styleDataSheetHeader(relationships, 5);
  addListValidation(relationships, "D2:D5000", LIST_REL_TYPE);
  autosizeColumns(relationships, 5);

  // --- Instructions (no header row; plain text column A)
  const instructions = wb.addWorksheet("Instructions");
  const lines = [
    '1. "Upload Rate Card BEFORE using this template"',
    '2. "Do NOT rename sheets"',
    '3. "Do NOT rename columns"',
    '4. "Names must match exactly (case-insensitive, trimmed)"',
    '5. "Activity codes must be unique per Fragnet"',
    '6. "Deliverables must belong to the specified Fragnet"',
    '7. "Assignments require valid resources from rate card"',
    '8. "Leave activity_code empty for DELIVERABLE assignments"',
    '9. "Units must be greater than 0 if provided"',
  ];
  lines.forEach((text, i) => {
    instructions.getCell(i + 1, 1).value = text;
    instructions.getCell(i + 1, 1).alignment = { wrapText: true, vertical: "top" };
  });
  instructions.getColumn(1).width = 92;

  const raw = await wb.xlsx.writeBuffer();
  return Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
}
