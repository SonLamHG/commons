// Minimal, safe Markdown -> HTML for the reading view.
// HTML is escaped FIRST, so raw tags in source can't inject markup.
// Supports the subset a marketer actually writes: headings, bold, italic,
// inline code, links, bullet/ordered lists, blockquotes, hr, paragraphs.

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function inline(s: string, resolveSrc?: (src: string) => string): string {
  return s
    .replace(/!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g, (_m, alt, src) => {
      const url = resolveSrc ? resolveSrc(src) : src;
      const safe = /^(https?:\/\/|\/)/i.test(url) ? url : '#';
      return `<img src="${safe}" alt="${alt}" />`;
    })
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, t, href) => {
      const safe = /^https?:\/\//i.test(href) ? href : '#';
      return `<a href="${safe}" target="_blank" rel="noopener noreferrer">${t}</a>`;
    })
    .replace(/(\*\*|__)(.+?)\1/g, '<strong>$2</strong>')
    .replace(/(\*|_)(.+?)\1/g, '<em>$2</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

export function renderMarkdown(md: string, resolveSrc?: (src: string) => string): string {
  const lines = escapeHtml(md).split('\n');
  const html: string[] = [];
  let para: string[] = [];
  let list: { type: 'ul' | 'ol'; items: string[] } | null = null;

  const flushPara = () => {
    if (para.length) { html.push(`<p>${inline(para.join(' '), resolveSrc)}</p>`); para = []; }
  };
  const flushList = () => {
    if (list) { html.push(`<${list.type}>${list.items.map((i) => `<li>${inline(i, resolveSrc)}</li>`).join('')}</${list.type}>`); list = null; }
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    const ul = /^\s*[-*+]\s+(.*)$/.exec(line);
    const ol = /^\s*\d+\.\s+(.*)$/.exec(line);
    const bq = /^>\s?(.*)$/.exec(line);

    if (line.trim() === '') { flushPara(); flushList(); continue; }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) { flushPara(); flushList(); html.push('<hr/>'); continue; }
    if (h) { flushPara(); flushList(); html.push(`<h${h[1].length}>${inline(h[2], resolveSrc)}</h${h[1].length}>`); continue; }
    if (ul) { flushPara(); if (list?.type !== 'ul') { flushList(); list = { type: 'ul', items: [] }; } list.items.push(ul[1]); continue; }
    if (ol) { flushPara(); if (list?.type !== 'ol') { flushList(); list = { type: 'ol', items: [] }; } list.items.push(ol[1]); continue; }
    if (bq) { flushList(); flushPara(); html.push(`<blockquote>${inline(bq[1], resolveSrc)}</blockquote>`); continue; }
    para.push(line);
  }
  flushPara(); flushList();
  return html.join('\n');
}

// Resolve a post-relative image src (e.g. "../assets/x.png") against the post's
// directory into a workspace-relative path, then hand it to a URL builder.
export function resolvePostImage(postPath: string, toUrl: (wsRelPath: string) => string) {
  const dir = postPath.includes('/') ? postPath.slice(0, postPath.lastIndexOf('/')) : '';
  return (src: string): string => {
    if (/^(https?:\/\/|data:)/i.test(src)) return src;
    const parts = dir ? dir.split('/') : [];
    for (const seg of src.split('/')) {
      if (seg === '..') parts.pop();
      else if (seg !== '.') parts.push(seg);
    }
    return toUrl(parts.join('/'));
  };
}
