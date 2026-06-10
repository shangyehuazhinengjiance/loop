import type { LoopContext, LoopMessage } from '@loop/shared';

export interface LoopRecord {
  id: string;
  phase: string;
  title: string;
  context: LoopContext;
}

export class OrchestratorApi {
  constructor(private readonly baseUrl: string) {}

  async getLoop(loopId: string): Promise<LoopRecord> {
    const res = await fetch(`${this.baseUrl}/api/loops/${loopId}`);
    if (!res.ok) throw new Error(`getLoop: ${res.status}`);
    return res.json() as Promise<LoopRecord>;
  }

  async requestHumanHelp(
    loopId: string,
    body: {
      requestedBy: 'ops-agent';
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

  async postAgentMessage(
    loopId: string,
    content: LoopMessage['content'],
    phase: string,
  ) {
    const res = await fetch(`${this.baseUrl}/api/loops/${loopId}/agent-messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId: 'ops-agent', phase, content }),
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

  async postAudit(loopId: string, action: string, detail?: Record<string, unknown>) {
    await fetch(`${this.baseUrl}/api/loops/${loopId}/audit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent: 'ops-agent', action, detail }),
    });
  }
}
