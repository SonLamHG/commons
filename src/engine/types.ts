// commons/src/engine/types.ts

export interface FileNode {
  path: string;            // relative path từ gốc workspace
  type: 'file' | 'dir';
}

export interface FileDiff {
  path: string;
  status: 'added' | 'modified' | 'deleted';
  diff: string;            // unified patch text
}

export type ProposalStatus = 'open' | 'submitted' | 'merged' | 'discarded';

export interface Proposal {
  id: string;
  branch: string;          // 'proposal/<id>'
  title: string;
  status: ProposalStatus;
  createdAt: string;       // ISO
}

export type MergeResult =
  | { merged: true }
  | { merged: false; conflicts: string[] };

export interface Engine {
  createWorkspace(opts: { id: string; seed?: Record<string, string> }): Promise<void>;
  readState(workspaceId: string): Promise<FileNode[]>;
  readFile(workspaceId: string, path: string): Promise<string>;
  addFile(workspaceId: string, path: string, content: string): Promise<void>;
  deleteFile(workspaceId: string, path: string): Promise<void>;
  createProposal(workspaceId: string, opts: { id: string; title: string }): Promise<void>;
  writeProposalFile(workspaceId: string, proposalId: string, path: string, content: string): Promise<void>;
  readProposalFile(workspaceId: string, proposalId: string, path: string): Promise<string>;
  submitProposal(workspaceId: string, proposalId: string, message: string): Promise<void>;
  diffProposal(workspaceId: string, proposalId: string): Promise<FileDiff[]>;
  mergeProposal(workspaceId: string, proposalId: string): Promise<MergeResult>;
  discardProposal(workspaceId: string, proposalId: string): Promise<void>;
  listProposals(workspaceId: string): Promise<Proposal[]>;
  listWorkspaces(): Promise<string[]>;
}
