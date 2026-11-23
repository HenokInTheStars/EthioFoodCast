/**
 * CSV read and write, in the browser, with no dependency.
 *
 * Program staff work in Excel, so CSV in and CSV out is a product requirement,
 * not a nicety. The parser is deliberately small but handles the two things that
 * break naive ones: quoted fields containing commas and newlines, and escaped
 * double quotes ("") inside a quoted field. Anything richer than that should be
 * a server-side job.
 */

export type CsvValue = string | number | null;

/** RFC 4180-ish: returns rows of string cells. Empty trailing lines are dropped. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  // A BOM at the start of an Excel export otherwise becomes part of the first
  // header name and makes the first column unrecognisable.
  const body = text.replace(/^\uFEFF/, "");

  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];

    if (inQuotes) {
      if (char === '"') {
        if (body[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(cell.trim());
      cell = "";
    } else if (char === "\r") {
      // handled by the \n branch
    } else if (char === "\n") {
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell.trim());
    rows.push(row);
  }

  return rows.filter((entry) => entry.some((value) => value.length > 0));
}

/** Rows to a CSV string, quoting anything that needs it. */
export function toCsv(headers: string[], rows: CsvValue[][]): string {
  const escape = (value: CsvValue): string => {
    if (value === null || value === undefined) return "";
    const text = String(value);
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [headers.map(escape).join(","), ...rows.map((row) => row.map(escape).join(","))].join("\r\n");
}

/** Parse a CSV file into objects keyed by header name. */
export function csvToRecords(text: string): { records: Record<string, string>[]; headers: string[] } {
  const rows = parseCsv(text);
  const headers = rows[0] ?? [];
  if (headers.length === 0) return { records: [], headers: [] };
  const records = rows.slice(1).map((row) => {
    const record: Record<string, string> = {};
    headers.forEach((header, index) => {
      record[header] = row[index] ?? "";
    });
    return record;
  });
  return { records, headers };
}

/** Coerce a cell to a number when it parses as one, else keep the string. */
export function coerce(value: string): number | string {
  const trimmed = value.trim();
  if (trimmed === "") return null as unknown as string;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : trimmed;
}

/** Trigger a browser download of a CSV string. */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
