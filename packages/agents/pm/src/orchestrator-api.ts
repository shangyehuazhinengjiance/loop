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

  async requestHumanHelp(
    loopId: string,
    body: {
      requestedBy: 'pm-agent';
      kind: string;
      reason: string;
      question?: string;
      assigneeUserId?: string;
      skillsHint?: string;
    },
  ) {
    const res = await fetch(`${this.baseUrl}/api/loops/${loopId}/agent/blocker`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestedBy: body.requestedBy,
        kind: body.kind,
        reason: body.reason,
        question: body.question,
        assigneeUserId: body.assigneeUserId,
        skillsHint: body.skillsHint,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`requestHumanHelp: ${res.status} ${text.slice(0, 300)}`);
    }
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

export function parsePrdAndTasks(text: string | null | undefined): {
  prd: PRDDocument;
  tasks: Task[];
} {
  const source = (text ?? '').trim();
  if (!source) {
    return {
      prd: {
        title: 'PRD',
        content: '',
        version: 1,
        updatedAt: new Date().toISOString(),
      },
      tasks: [],
    };
  }

  const prdMatch = source.match(/```markdown\n([\s\S]*?)```/);
  const prdContent = prdMatch?.[1]?.trim() ?? source;

  let tasks: Task[] = [];
  const tasksMatch = source.match(/```json\n([\s\S]*?)```/);
  if (tasksMatch?.[1]) {
    try {
      const parsed = JSON.parse(tasksMatch[1]) as Task[];
      tasks = parsed.map((t, i) => ({
        id: t.id ?? `task-${i + 1}`,
        title: t.title,
        description: t.description ?? '',
        status: t.status ?? 'pending',
        assigneeUserId: t.assigneeUserId,
        assigneeDisplayName: t.assigneeDisplayName,
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
