import { err, ok, type Result } from '@shared/result';

const BYTE_ORDER_MARK = 0xfeff;

export interface CsvRow {
  /** 1-based line of the file the record starts on (a quoted newline makes a record span lines). */
  line: number;
  fields: string[];
}

export interface CsvTable {
  header: string[];
  rows: CsvRow[];
  delimiter: ',' | ';';
}

/** `,`, or `;` when the header line has no `,` and has `;` (a French spreadsheet exports `;`). */
function detectDelimiter(text: string): ',' | ';' {
  const newline = text.search(/[\r\n]/);
  const headerLine = newline === -1 ? text : text.slice(0, newline);
  return !headerLine.includes(',') && headerLine.includes(';') ? ';' : ',';
}

/**
 * Parses RFC 4180 text: quoted fields may hold the delimiter, `""` (a quote) and newlines; `\n` and
 * `\r\n` end a record; a UTF-8 BOM is dropped and blank lines (and rows of bare delimiters) are
 * skipped; spaces around a quoted field are ignored. The first record is the
 * header and every other one must have as many fields. Pure; never throws. An error names its line.
 */
export function parseCsv(input: string): Result<CsvTable, string> {
  const text = input.charCodeAt(0) === BYTE_ORDER_MARK ? input.slice(1) : input;
  const delimiter = detectDelimiter(text);

  const records: CsvRow[] = [];
  let fields: string[] = [];
  let field = '';
  let quoted = false; // the current field was opened with a quote
  let recordQuoted = false; // a field of the current record was opened with a quote
  let inQuotes = false;
  let afterQuote = false; // the closing quote of the current field was just read
  let line = 1;
  let recordLine = 1;
  let quoteLine = 1;

  const endField = (): void => {
    fields.push(field);
    field = '';
    quoted = false;
    afterQuote = false;
  };
  const endRecord = (): void => {
    endField();
    // A line with nothing on it is not a record, nor is a row of bare delimiters (a spreadsheet
    // leaves `;;;;;;` rows at the end of an export).
    const blank = !recordQuoted && fields.every((value) => value.trim() === '');
    if (!blank) records.push({ line: recordLine, fields });
    fields = [];
    recordQuoted = false;
  };

  for (let index = 0; index < text.length; index++) {
    const char = text[index] as string;
    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index++;
        } else {
          inQuotes = false;
          afterQuote = true;
        }
      } else {
        // A lone `\r` ends a line outside quotes (see below), so it counts here too; `\r\n` counts once.
        if (char === '\n' || (char === '\r' && text[index + 1] !== '\n')) line++;
        field += char;
      }
      continue;
    }
    if (char === '\r' && text[index + 1] === '\n') continue; // the `\n` ends the record
    if (char === '\n' || char === '\r') {
      endRecord();
      line++;
      recordLine = line;
      continue;
    }
    if (char === delimiter) {
      endField();
      continue;
    }
    if (afterQuote) {
      if (char === ' ' || char === '\t') continue; // `"x" ,` is fine, like `, "x"`
      return err(`line ${line}: unexpected "${char}" after the closing quote of a field`);
    }
    if (char === '"' && field.trim() === '' && !quoted) {
      field = ''; // the spaces before the opening quote are not part of the value
      inQuotes = true;
      quoted = true;
      recordQuoted = true;
      quoteLine = line;
      continue;
    }
    field += char;
  }
  if (inQuotes) return err(`line ${quoteLine}: a quoted field is never closed`);
  if (field !== '' || fields.length > 0 || quoted) endRecord();

  const [headerRecord, ...rows] = records;
  if (headerRecord === undefined) return err('the file is empty: expected a header line');
  const width = headerRecord.fields.length;
  for (const row of rows) {
    if (row.fields.length !== width) {
      return err(
        `line ${row.line}: expected ${width} fields like the header, got ${row.fields.length}`,
      );
    }
  }
  return ok({ header: headerRecord.fields.map((name) => name.trim()), rows, delimiter });
}
