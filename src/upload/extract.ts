import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';

export const SUPPORTED = ['.md', '.markdown', '.txt', '.pdf', '.docx'] as const;

function ext(filename: string): string {
  const i = filename.lastIndexOf('.');
  return i >= 0 ? filename.slice(i).toLowerCase() : '';
}

/** The reference/ path an uploaded file lands at: reference/<basename>.md.
 *  Preserves Unicode letters (e.g. Vietnamese) — only strips path separators
 *  and characters unsafe in a filename. */
export function referencePath(filename: string): string {
  const base = filename.slice(0, filename.length - ext(filename).length) || filename;
  const safe = base
    .replace(/[/\\]+/g, '-')
    .replace(/[^\p{L}\p{N} _-]/gu, '')
    .trim() || 'upload';
  return `reference/${safe}.md`;
}

async function extract(filename: string, buffer: Buffer): Promise<string> {
  const e = ext(filename);
  if (e === '.md' || e === '.markdown' || e === '.txt') {
    return buffer.toString('utf8');
  }
  if (e === '.docx') {
    const { value } = await mammoth.extractRawText({ buffer });
    return value.trim();
  }
  if (e === '.pdf') {
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    try {
      const { text } = await parser.getText();
      // pdf-parse inserts "-- N of M --" page separators; drop them.
      return text.replace(/^-- \d+ of \d+ --$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
    } finally {
      await parser.destroy();
    }
  }
  throw new Error(`unsupported file type: ${e || '(none)'} — supported: ${SUPPORTED.join(', ')}`);
}

/** Extract plain text from an uploaded source document. Throws on unsupported
 *  type, and on empty results (e.g. a scanned/image PDF with no text layer) so
 *  the caller never silently stores a blank file. */
export async function extractText(filename: string, buffer: Buffer): Promise<string> {
  const text = await extract(filename, buffer);
  if (!text.trim()) {
    const e = ext(filename);
    if (e === '.pdf') {
      throw new Error('không trích xuất được text từ PDF — có thể là bản scan/ảnh (cần OCR), chưa hỗ trợ');
    }
    throw new Error('file rỗng hoặc không có nội dung text để trích xuất');
  }
  return text;
}
