/**
 * CSV generation.
 *
 * Hand-written rather than pulled from a package: the entire job is
 * quoting and one security rule, and every maintained CSV library I would
 * reach for either targets Node streams or leaves formula injection to
 * the caller anyway. The rule below is the part that actually matters.
 */

/**
 * Neutralize spreadsheet formulas.
 *
 * Excel, LibreOffice and Sheets execute a cell beginning with = + - @ or
 * certain control characters. A guest who types
 * `=HYPERLINK("http://evil","click")` into a message field would otherwise
 * become a live link in the couple's downloaded spreadsheet.
 *
 * Quoting alone does NOT prevent this — the quotes are consumed by the CSV
 * parser and the formula still reaches the cell. The value must be altered
 * so it can never be parsed as a formula, which is what prefixing with an
 * apostrophe does: spreadsheets treat it as a literal-text marker and
 * strip it on display, so the reader still sees the original text.
 */
function neutralize(value: string): string {
  // Tab, CR and LF are included because they can be used to shift the
  // dangerous character out of position-zero detection in some parsers.
  if (/^[=+\-@\t\r]/.test(value)) return `'${value}`;
  return value;
}

function escapeCell(input: unknown): string {
  if (input === null || input === undefined) return "";

  const raw = String(input);
  const safe = neutralize(raw);

  // Quote when the value contains a delimiter, quote or newline; double
  // any embedded quotes per RFC 4180.
  if (/[",\r\n]/.test(safe)) return `"${safe.replace(/"/g, '""')}"`;
  return safe;
}

export function toCsv(headers: string[], rows: Array<Array<unknown>>): string {
  const lines = [headers.map(escapeCell).join(",")];
  for (const row of rows) lines.push(row.map(escapeCell).join(","));

  // CRLF and a UTF-8 BOM: without the BOM, Excel on Windows misreads
  // non-ASCII names, which for a Chinese wedding is every row.
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

/** Filename that survives quoting and cannot smuggle header injection. */
export function csvFilename(base: string): string {
  const safe = base.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 60) || "responses";
  return `${safe}.csv`;
}
