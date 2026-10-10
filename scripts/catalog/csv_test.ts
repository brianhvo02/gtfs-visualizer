import {describe, expect, it} from 'vitest';
import {parseCsv} from './csv.ts';

describe('parseCsv', () => {
  it('handles BOM, quotes, doubled quotes, and CR/LF in quotes', () => {
    expect(parseCsv('﻿a,b\n"x, y","say ""hi"""\n"multi\nline",z\r\n')).toEqual([
      ['a', 'b'],
      ['x, y', 'say "hi"'],
      ['multi\nline', 'z'],
    ]);
  });
});
