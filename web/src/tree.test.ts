import { describe, it, expect } from 'vitest';
import { buildTree, folderLabel, orderRoots } from './tree';

describe('buildTree', () => {
  it('nests files under their directories', () => {
    const tree = buildTree([
      { path: 'reference', type: 'dir' },
      { path: 'reference/a.md', type: 'file' },
      { path: 'drafts', type: 'dir' },
      { path: 'drafts/b.md', type: 'file' },
    ]);
    expect(tree.map((n) => n.name)).toEqual(['reference', 'drafts']);
    const reference = tree.find((n) => n.name === 'reference')!;
    expect(reference.type).toBe('dir');
    expect(reference.children.map((c) => c.name)).toEqual(['a.md']);
    expect(reference.children[0]).toMatchObject({ path: 'reference/a.md', type: 'file' });
  });

  it('returns an empty array for no nodes', () => {
    expect(buildTree([])).toEqual([]);
  });

  it('handles a file at the root with no directory', () => {
    const tree = buildTree([{ path: 'README.md', type: 'file' }]);
    expect(tree).toHaveLength(1);
    expect(tree[0]).toMatchObject({ name: 'README.md', path: 'README.md', type: 'file' });
  });

  it('infers intermediate directories even if no dir node is given', () => {
    const tree = buildTree([{ path: 'assets/img/logo.png', type: 'file' }]);
    const assets = tree[0];
    expect(assets).toMatchObject({ name: 'assets', type: 'dir' });
    expect(assets.children[0]).toMatchObject({ name: 'img', type: 'dir' });
    expect(assets.children[0].children[0]).toMatchObject({ name: 'logo.png', type: 'file' });
  });
});

describe('orderRoots', () => {
  it('puts the three primary folders first, then other dirs, then loose files', () => {
    const roots = buildTree([
      { path: 'README.md', type: 'file' },
      { path: 'assets', type: 'dir' },
      { path: 'published', type: 'dir' },
      { path: 'drafts', type: 'dir' },
      { path: 'reference', type: 'dir' },
    ]);
    expect(orderRoots(roots).map((n) => n.name)).toEqual([
      'drafts', 'published', 'reference', 'assets', 'README.md',
    ]);
  });
});

describe('folderLabel', () => {
  it('maps standard folders to friendly labels', () => {
    expect(folderLabel('reference')).toContain('Tài liệu nguồn');
    expect(folderLabel('drafts')).toContain('Bản thảo');
    expect(folderLabel('published')).toContain('Xuất bản');
  });
  it('falls back to the raw name for unknown folders', () => {
    expect(folderLabel('campaign-q3')).toBe('campaign-q3');
  });
});
