import type { FileNode } from './api';

export interface TreeNode {
  name: string;             // last path segment
  path: string;             // full path from workspace root
  type: 'file' | 'dir';
  children: TreeNode[];     // empty for files
}

/** Build a nested tree from the flat path list returned by readState.
 *  Intermediate directories are inferred from file paths, so a missing
 *  `dir` node never drops a file. Order: directories and files appear in
 *  first-seen order within each level. */
export function buildTree(nodes: FileNode[]): TreeNode[] {
  const roots: TreeNode[] = [];
  const dirIndex = new Map<string, TreeNode>(); // path -> dir node

  const ensureDir = (path: string): TreeNode => {
    const existing = dirIndex.get(path);
    if (existing) return existing;
    const segments = path.split('/');
    const name = segments[segments.length - 1];
    const node: TreeNode = { name, path, type: 'dir', children: [] };
    dirIndex.set(path, node);
    if (segments.length === 1) roots.push(node);
    else ensureDir(segments.slice(0, -1).join('/')).children.push(node);
    return node;
  };

  for (const n of nodes) {
    if (n.type === 'dir') { ensureDir(n.path); continue; }
    const segments = n.path.split('/');
    const name = segments[segments.length - 1];
    const fileNode: TreeNode = { name, path: n.path, type: 'file', children: [] };
    if (segments.length === 1) roots.push(fileNode);
    else ensureDir(segments.slice(0, -1).join('/')).children.push(fileNode);
  }

  return roots;
}

const LABELS: Record<string, string> = {
  reference: 'Tài liệu nguồn',
  drafts: 'Bản thảo',
  published: 'Xuất bản',
};

/** Friendly label for a directory name; raw name if not a standard folder. */
export function folderLabel(name: string): string {
  return LABELS[name] ?? name;
}

/** The three primary folders — styled as sections and expanded by default.
 *  Order here drives both the rail order and orderRoots: drafts first (the
 *  active work), then published, then reference. */
export const STANDARD_FOLDERS = ['drafts', 'published', 'reference'];

/** Order the top level for reading: the three primary folders first (canonical
 *  order), then any other folders, then loose root files. Nested children keep
 *  their first-seen order. */
export function orderRoots(nodes: TreeNode[]): TreeNode[] {
  const rank = (n: TreeNode): number => {
    if (n.type !== 'dir') return 200;              // loose files last
    const i = STANDARD_FOLDERS.indexOf(n.name);
    return i === -1 ? 100 : i;                       // primary folders first, others between
  };
  return [...nodes].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}
