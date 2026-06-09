import type { LoopContext, LoopMessage, PRDDocument, Task } from '@loop/shared';

export interface LoopRecord {
  id: string;
  phase: string;
  title: string;
  context: LoopContext;
  workspace_path?: string;
}

export class OrchestratorApi {
  constructor(private readonly baseUrl: string) {}

  async getLoop(loopId: string): Promise<LoopRecord> {
    const res = await fetch(`${this.baseUrl}/api/loops/${loopId}`);
    if (!res.ok) throw new Error(`getLoop: ${res.status}`);
    return res.json() as Promise<LoopRecord>;
  }

  async getMessages(loopId: string): Promise<LoopMessage[]> {
    const res = await fetch(`${this.baseUrl}/api/loops/${loopId}/messages`);
    if (!res.ok) throw new Error(`getMessages: ${res.status}`);
    return res.json() as Promise<LoopMessage[]>;
  }

  async postAgentMessage(
    loopId: string,
    content: LoopMessage['content'],
    phase: string,
  ) {
    // 通过 orchestrator 内部扩展端点；Sprint 1 复用 messages 表写入路径
    const res = await fetch(`${this.baseUrl}/api/loops/${loopId}/agent-messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId: 'pm-agent',
        phase,
        content,
      }),
    });
    if (!res.ok) throw new Error(`postAgentMessage: ${res.status}`);
    return res.json();
  }

  async updateContext(loopId: string, context: LoopContext) {
    const res = await fetch(`${this.baseUrl}/api/loops/${loopId}/context`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ context }),
    });
    if (!res.ok) throw new Error(`updateContext: ${res.status}`);
    return res.json();
  }
}

export function parsePrdAndTasks(text: string): {
  prd: PRDDocument;
  tasks: Task[];
} {
  const prdMatch = text.match(/```markdown\n([\s\S]*?)```/);
  const prdContent = prdMatch?.[1]?.trim() ?? text;

  let tasks: Task[] = [];
  const tasksMatch = text.match(/```json\n([\s\S]*?)```/);
  if (tasksMatch?.[1]) {
    try {
      const parsed = JSON.parse(tasksMatch[1]) as Task[];
      tasks = parsed.map((t, i) => ({
        id: t.id ?? `task-${i + 1}`,
        title: t.title,
        description: t.description ?? '',
        status: t.status ?? 'pending',
      }));
    } catch {
      tasks = [];
    }
  }

  return {
    prd: {
      title: 'PRD',
      content: prdContent,
      version: 1,
      updatedAt: new Date().toISOString(),
    },
    tasks,
  };
}
