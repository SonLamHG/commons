import { describe, it, expect } from 'vitest';
import { toPlainText } from '../src/publish/markdown.js';

describe('toPlainText', () => {
  it('strips heading markers', () => {
    expect(toPlainText('# Hello World')).toBe('Hello World');
    expect(toPlainText('### Sub heading')).toBe('Sub heading');
  });

  it('strips bold and italic markers', () => {
    expect(toPlainText('a **bold** and *italic* and `code` word')).toBe('a bold and italic and code word');
    expect(toPlainText('__also bold__ and _also italic_')).toBe('also bold and also italic');
  });

  it('keeps link text, drops url', () => {
    expect(toPlainText('see [our site](https://x.com) now')).toBe('see our site now');
  });

  it('converts bullets to a readable marker', () => {
    expect(toPlainText('- one\n- two')).toBe('• one\n• two');
    expect(toPlainText('* star\n+ plus')).toBe('• star\n• plus');
  });

  it('preserves paragraph line breaks', () => {
    expect(toPlainText('# Title\n\nBody text here.')).toBe('Title\n\nBody text here.');
  });
});
