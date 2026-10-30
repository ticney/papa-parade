import { describe, expect, it } from 'vitest';
import { parseCsv } from '../../../tools/playtest/csv.ts';

function table(text: string) {
  const parsed = parseCsv(text);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
}

describe('parseCsv', () => {
  it('reads a header and rows, with the line each record starts on', () => {
    const csv = table('a,b,c\n1,2,3\n4,5,6\n');
    expect(csv.header).toEqual(['a', 'b', 'c']);
    expect(csv.delimiter).toBe(',');
    expect(csv.rows).toEqual([
      { line: 2, fields: ['1', '2', '3'] },
      { line: 3, fields: ['4', '5', '6'] },
    ]);
  });

  it('keeps a comma, a doubled quote and a newline inside a quoted field', () => {
    const csv = table('a,b\n"x, y","say ""hi"""\n"one\ntwo",z\nlast,row\n');
    expect(csv.rows).toEqual([
      { line: 2, fields: ['x, y', 'say "hi"'] },
      { line: 3, fields: ['one\ntwo', 'z'] },
      { line: 5, fields: ['last', 'row'] },
    ]);
  });

  it('reads CRLF line ends', () => {
    const csv = table('a,b\r\n1,2\r\n3,4');
    expect(csv.rows.map((row) => row.fields)).toEqual([
      ['1', '2'],
      ['3', '4'],
    ]);
  });

  it('keeps a CRLF inside a quoted field as it is', () => {
    const csv = table('a,b\r\n"x\r\ny",2\r\n');
    expect(csv.rows[0]?.fields).toEqual(['x\r\ny', '2']);
  });

  it('strips a UTF-8 byte order mark', () => {
    const csv = table('﻿a,b\n1,2\n');
    expect(csv.header).toEqual(['a', 'b']);
  });

  it('uses ";" when the header line has no "," and has ";"', () => {
    const csv = table('a;b\n1,5;2\n');
    expect(csv.delimiter).toBe(';');
    expect(csv.rows[0]?.fields).toEqual(['1,5', '2']);
  });

  it('keeps "," when the header holds both', () => {
    expect(table('a,b;c\n1,2\n').delimiter).toBe(',');
  });

  it('skips blank lines and keeps the line numbers of the others', () => {
    const csv = table('a,b\n\n1,2\n   \n3,4\n');
    expect(csv.rows).toEqual([
      { line: 3, fields: ['1', '2'] },
      { line: 5, fields: ['3', '4'] },
    ]);
  });

  it('keeps an empty field and an empty quoted line', () => {
    const csv = table('a,b\n,x\n"",x\n');
    expect(csv.rows.map((row) => row.fields)).toEqual([
      ['', 'x'],
      ['', 'x'],
    ]);
  });

  it('skips a row of bare delimiters, like a spreadsheet leaves at the end of an export', () => {
    expect(table('a;b\n1;2\n;\n;\n').rows.map((row) => row.fields)).toEqual([['1', '2']]);
    expect(table('a,b\n1,2\n,\n  ,  \n').rows.map((row) => row.fields)).toEqual([['1', '2']]);
    // A quoted empty field is a value, not a blank.
    expect(table('a,b\n"",\n').rows.map((row) => row.fields)).toEqual([['', '']]);
  });

  it('ignores spaces around a quoted field', () => {
    const csv = table('a,b\nT1, "x, ""y"" z" \n');
    expect(csv.rows.map((row) => row.fields)).toEqual([['T1', 'x, "y" z']]);
  });

  it('counts a lone carriage return inside a quoted field as a line', () => {
    const parsed = parseCsv('a,b\r1,"x\ry"\r3\r');
    expect(parsed).toEqual({
      ok: false,
      error: 'line 4: expected 2 fields like the header, got 1',
    });
  });

  it('names the line of an unterminated quote', () => {
    const parsed = parseCsv('a,b\n1,2\n3,"oops\n4,5\n');
    expect(parsed).toEqual({ ok: false, error: 'line 3: a quoted field is never closed' });
  });

  it('names the line of a row with the wrong number of fields', () => {
    const parsed = parseCsv('a,b,c\n1,2,3\n4,5\n');
    expect(parsed).toEqual({
      ok: false,
      error: 'line 3: expected 3 fields like the header, got 2',
    });
  });

  it('refuses text after a closing quote', () => {
    const parsed = parseCsv('a,b\n"x"y,2\n');
    expect(parsed).toEqual({
      ok: false,
      error: 'line 2: unexpected "y" after the closing quote of a field',
    });
  });

  it('refuses an empty file', () => {
    expect(parseCsv('')).toEqual({ ok: false, error: 'the file is empty: expected a header line' });
    expect(parseCsv('\n\n').ok).toBe(false);
  });
});
