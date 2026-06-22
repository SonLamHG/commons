import React, { useState } from 'react';
import type { TreeNode } from '../tree';
import { folderLabel, STANDARD_FOLDERS } from '../tree';

interface Props {
  nodes: TreeNode[];
  selected: string | null;
  onSelect: (path: string) => void;
  published: Record<string, { publishedAt: string }>;
  depth?: number;
}

/** Total number of file leaves under a node (folders show this as a tally). */
function countFiles(node: TreeNode): number {
  if (node.type === 'file') return 1;
  return node.children.reduce((sum, child) => sum + countFiles(child), 0);
}

export function FileTree({ nodes, selected, onSelect, published, depth = 0 }: Props) {
  return (
    <div className={depth === 0 ? 'tree' : 'tree-children'}>
      {nodes.map((node) =>
        node.type === 'dir' ? (
          <Folder key={node.path} node={node} selected={selected} onSelect={onSelect}
                  published={published} depth={depth} />
        ) : (
          <FileRow key={node.path} node={node} selected={selected}
                   onSelect={onSelect} published={published} />
        ),
      )}
    </div>
  );
}

function Folder({ node, selected, onSelect, published, depth }: {
  node: TreeNode; selected: string | null; onSelect: (p: string) => void;
  published: Record<string, { publishedAt: string }>; depth: number;
}) {
  const top = depth === 0 && STANDARD_FOLDERS.includes(node.name);
  const [open, setOpen] = useState(top);
  const count = countFiles(node);

  return (
    <div className={`tree-group${top ? ' tree-group--top' : ''}`} data-accent={top ? node.name : undefined}>
      <button
        className={`tree-folder${top ? ' tree-folder--top' : ''}${open ? ' is-open' : ''}`}
        data-accent={top ? node.name : undefined}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="tree-folder__chevron" aria-hidden>▸</span>
        <span className="tree-folder__name">{top ? folderLabel(node.name) : node.name}</span>
        <span className="tree-folder__count">{count}</span>
      </button>
      {open && (
        node.children.length > 0 ? (
          <FileTree nodes={node.children} selected={selected} onSelect={onSelect}
                    published={published} depth={depth + 1} />
        ) : (
          <div className="tree-children"><p className="tree-empty">— trống —</p></div>
        )
      )}
    </div>
  );
}

/** Split a filename into stem + extension so the extension can be set in a
 *  fainter, mono type — a table-of-contents touch. Dotfiles keep their name. */
function splitExt(name: string): [string, string] {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
}

function FileRow({ node, selected, onSelect, published }: {
  node: TreeNode; selected: string | null; onSelect: (p: string) => void;
  published: Record<string, { publishedAt: string }>;
}) {
  const active = node.path === selected;
  const [stem, ext] = splitExt(node.name);
  return (
    <button
      className={`tree-file${active ? ' is-active' : ''}`}
      onClick={() => onSelect(node.path)}
    >
      <span className="tree-file__name">{stem}<span className="tree-file__ext">{ext}</span></span>
      <span className="tree-file__leader" aria-hidden />
      {published[node.path] && (
        <span className="tree-file__pub"><span className="tree-file__dot" aria-hidden />pub</span>
      )}
    </button>
  );
}
