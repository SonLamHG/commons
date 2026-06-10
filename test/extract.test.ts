import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractText, referencePath } from '../src/upload/extract.js';

describe('referencePath', () => {
  it('lands files under reference/ as .md, sanitizing the name', () => {
    expect(referencePath('brief.pdf')).toBe('reference/brief.md');
    expect(referencePath('June Brief.docx')).toBe('reference/June Brief.md');
    expect(referencePath('../evil/name.txt')).toBe('reference/-evil-name.md');
  });

  it('preserves Unicode letters such as Vietnamese diacritics', () => {
    expect(referencePath('yêu cầu.pdf')).toBe('reference/yêu cầu.md');
    expect(referencePath('Brief Tháng 6.docx')).toBe('reference/Brief Tháng 6.md');
  });
});

describe('extractText', () => {
  it('returns utf8 for text and markdown', async () => {
    expect(await extractText('a.txt', Buffer.from('hello world'))).toBe('hello world');
    expect(await extractText('a.md', Buffer.from('# Title'))).toBe('# Title');
  });

  it('extracts text from a real .docx', async () => {
    const buf = readFileSync('node_modules/mammoth/test/test-data/single-paragraph.docx');
    expect(await extractText('doc.docx', buf)).toBe('Walking on imported air');
  });

  it('extracts text from a real .pdf and strips page markers', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'commons-pdf-'));
    const pdf = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length 52>>stream
BT /F1 24 Tf 72 700 Td (Commons brief hello) Tj ET
endstream endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
trailer<</Root 1 0 R>>
%%EOF`;
    const f = join(dir, 'x.pdf');
    writeFileSync(f, pdf, 'latin1');
    try {
      const out = await extractText('brief.pdf', readFileSync(f));
      expect(out).toContain('Commons brief hello');
      expect(out).not.toMatch(/-- \d+ of \d+ --/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('throws on unsupported types', async () => {
    await expect(extractText('photo.png', Buffer.from('x'))).rejects.toThrow(/unsupported/);
  });

  it('throws (not stores blank) when a text file is empty', async () => {
    await expect(extractText('empty.txt', Buffer.from('   '))).rejects.toThrow(/rỗng|không có nội dung/);
  });

  it('throws a scan/OCR hint when a PDF yields no text layer', async () => {
    // A structurally-valid but text-less PDF (no content stream text).
    const pdf = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj
trailer<</Root 1 0 R>>
%%EOF`;
    await expect(extractText('scan.pdf', Buffer.from(pdf, 'latin1'))).rejects.toThrow(/scan|OCR/i);
  });
});
