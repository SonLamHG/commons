export type AgentEvent =
  | { type: 'text'; text: string }
  | { type: 'tool'; name: string; input?: unknown }
  | { type: 'done'; result: string; costUsd: number; numTurns: number }
  | { type: 'error'; message: string };

export interface AgentResult {
  ok: boolean;
  costUsd: number;
  numTurns: number;
}

export interface AgentRunner {
  run(workspace: string, prompt: string, onEvent: (e: AgentEvent) => void): Promise<AgentResult>;
}
