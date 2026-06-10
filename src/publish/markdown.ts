/**
 * Convert Markdown to a plain-text rendition suitable for social posts
 * (LinkedIn, Facebook) where Markdown syntax is not rendered. Intentionally
 * minimal: it strips the common inline/block markers a knowledge-work draft
 * uses, and leaves everything else (including paragraph breaks) untouched.
 */
export function toPlainText(md: string): string {
  return md
    .split('\n')
    .map((line) => {
      let l = line.replace(/^\s{0,3}#{1,6}\s+/, ''); // headings
      l = l.replace(/^\s*[-*+]\s+/, '• '); // bullets
      l = l.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1'); // links -> text
      l = l.replace(/(\*\*|__)(.+?)\1/g, '$2'); // bold
      l = l.replace(/(\*|_)(.+?)\1/g, '$2'); // italic
      l = l.replace(/`([^`]+)`/g, '$1'); // inline code
      return l;
    })
    .join('\n');
}
