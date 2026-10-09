import {describe, expect, it} from 'vitest';
import {CsvParser} from './csv.ts';

interface Parsed {
  readonly records: Array<{fields: string[]; line: number}>;
  readonly errors: Array<{line: number; message: string}>;
}

function parse(chunks: readonly string[]): Parsed {
  const records: Array<{fields: string[]; line: number}> = [];
  const errors: Array<{line: number; message: string}> = [];
  const parser = new CsvParser(
    (fields, line) => records.push({fields, line}),
    (line, message) => errors.push({line, message}),
  );
  for (const chunk of chunks) parser.push(chunk);
  parser.end();
  return {records, errors};
}

const fieldsOf = (parsed: Parsed): string[][] => parsed.records.map((r) => r.fields);

describe('CsvParser', () => {
  it('parses simple records', () => {
    expect(fieldsOf(parse(['a,b,c\n1,2,3\n']))).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });
  it('handles quoted fields with commas, escaped quotes, and newlines', () => {
    const parsed = parse(['id,name\n1,"Main St, ""North""\nEntrance"\n2,x\n']);
    expect(fieldsOf(parsed)).toEqual([
      ['id', 'name'],
      ['1', 'Main St, "North"\nEntrance'],
      ['2', 'x'],
    ]);
    expect(parsed.records.map((r) => r.line)).toEqual([1, 2, 4]);
  });
  it('handles CRLF line endings', () => {
    expect(fieldsOf(parse(['a,b\r\n1,2\r\n']))).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });
  it('strips a leading BOM', () => {
    expect(fieldsOf(parse(['﻿stop_id\n1\n']))).toEqual([['stop_id'], ['1']]);
  });
  it('keeps empty fields and handles a missing trailing newline', () => {
    expect(fieldsOf(parse(['a,,c\n,,']))).toEqual([
      ['a', '', 'c'],
      ['', '', ''],
    ]);
  });
  it('skips empty lines but counts them', () => {
    const parsed = parse(['a\n\n1\n\n']);
    expect(fieldsOf(parsed)).toEqual([['a'], ['1']]);
    expect(parsed.records.map((r) => r.line)).toEqual([1, 3]);
  });
  it('gives identical results however the input is chunked', () => {
    const text = '﻿id,name\r\n1,"a ""q"", b"\r\n2,"multi\r\nline"\r\n3,plain\r\n';
    const whole = parse([text]);
    for (let split = 0; split <= text.length; split++) {
      expect(parse([text.slice(0, split), text.slice(split)])).toEqual(whole);
    }
    expect(parse(text.split(''))).toEqual(whole);
  });
  it('reports an unterminated quote and still emits the record', () => {
    const parsed = parse(['a,b\n1,"oops\n']);
    expect(parsed.errors).toEqual([{line: 2, message: 'Unterminated quoted field'}]);
    expect(fieldsOf(parsed)).toEqual([
      ['a', 'b'],
      ['1', 'oops\n'],
    ]);
  });
});
