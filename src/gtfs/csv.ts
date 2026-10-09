export type CsvRecordHandler = (fields: string[], line: number) => void;
export type CsvErrorHandler = (line: number, message: string) => void;

/**
 * Incremental RFC 4180 parser. Feed it decoded text in arbitrary chunks;
 * records are emitted synchronously as soon as they are complete.
 */
export class CsvParser {
  private readonly onRecord: CsvRecordHandler;
  private readonly onError: CsvErrorHandler;
  private field = '';
  private fields: string[] = [];
  private fieldQuoted = false;
  private inQuotes = false;
  /** Saw `"` inside a quoted field: either an escaped quote or the closing quote. */
  private quotePending = false;
  /** Last character was a record-ending `\r`; a following `\n` belongs to it. */
  private pendingCr = false;
  private sawText = false;
  private line = 1;
  private recordLine = 1;

  constructor(onRecord: CsvRecordHandler, onError: CsvErrorHandler) {
    this.onRecord = onRecord;
    this.onError = onError;
  }

  push(chunk: string): void {
    let text = chunk;
    if (!this.sawText) {
      if (text.length === 0) return;
      this.sawText = true;
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    }
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (this.pendingCr) {
        this.pendingCr = false;
        if (ch === '\n') continue;
      }
      if (this.inQuotes) {
        if (this.quotePending) {
          this.quotePending = false;
          if (ch === '"') {
            this.field += '"';
            continue;
          }
          // The pending quote closed the field; handle `ch` as unquoted text.
          this.inQuotes = false;
        } else {
          if (ch === '"') {
            this.quotePending = true;
          } else {
            if (ch === '\n') this.line++;
            this.field += ch;
          }
          continue;
        }
      }
      if (ch === '"' && this.field.length === 0 && !this.fieldQuoted) {
        this.inQuotes = true;
        this.fieldQuoted = true;
      } else if (ch === ',') {
        this.endField();
      } else if (ch === '\n' || ch === '\r') {
        this.endRecord();
        this.line++;
        this.recordLine = this.line;
        if (ch === '\r') this.pendingCr = true;
      } else {
        this.field += ch;
      }
    }
  }

  end(): void {
    if (this.inQuotes && !this.quotePending) {
      this.onError(this.recordLine, 'Unterminated quoted field');
    }
    this.inQuotes = false;
    this.quotePending = false;
    this.endRecord();
  }

  private endField(): void {
    this.fields.push(this.field);
    this.field = '';
    this.fieldQuoted = false;
  }

  private endRecord(): void {
    if (this.fields.length === 0 && this.field.length === 0 && !this.fieldQuoted) return;
    this.endField();
    const fields = this.fields;
    this.fields = [];
    this.onRecord(fields, this.recordLine);
  }
}
