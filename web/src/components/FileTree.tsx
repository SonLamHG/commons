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

export function FileTree({ nodes, selected, onSelect, published, depth = 0 }: Props) {
  return (
    <>
      {nodes.map((node) =>
        node.type === 'dir' ? (
          <Dir key={node.path} node={node} selected={selected} onSelect={onSelect}
               published={published} depth={depth} />
        ) : (
          <button key={node.path}
                  className={node.path === selected ? 'prop active' : 'prop'}
                  style={{ paddingLeft: 12 + depth * 16 }}
                  onClick={() => onSelect(node.path)}>
            <span className="title" style={{ fontFamily: 'monospace', fontWeight: 400 }}>{node.name}</span>
            {published[node.path] && <span className="badge merged">published</span>}
          </button>
        ),
      )}
    </>
  );
}

function Dir({ node, selected, onSelect, published, depth }: {
  node: TreeNode; selected: string | null; onSelect: (p: string) => void;
  published: Record<string, { publishedAt: string }>; depth: number;
}) {
  const [open, setOpen] = useState(depth === 0 ? STANDARD_FOLDERS.includes(node.name) : false);
  return (
    <>
      <button className="prop" style={{ paddingLeft: 12 + depth * 16, fontWeight: 600 }}
              onClick={() => setOpen((o) => !o)}>
        <span className="title">{open ? '▾' : '▸'} {depth === 0 ? folderLabel(node.name) : node.name}</span>
      </button>
      {open && (
        <FileTree nodes={node.children} selected={selected} onSelect={onSelect}
                  published={published} depth={depth + 1} />
      )}
    </>
  );
}
