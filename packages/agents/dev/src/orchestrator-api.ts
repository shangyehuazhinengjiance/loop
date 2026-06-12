import type { LoopContext, LoopMessage } from '@loop/shared';

export interface LoopRecord {
  id: string;
  phase: string;
  title: string;
  context: LoopContext;
  workspace_path?: string;
  activeTemplateId?: string;
  activeRunId?: string;
}

export class OrchestratorApi {
  constructor(
    private readonly baseUrl: string,
    private readonly runId?: string,
  ) {}

  async getLoop(loopId: string): Promise<LoopRecord> {
    const res = await fetch(`${this.baseUrl}/api/loops/${loopId}`);
    if (!res.ok) throw new Error(`getLoop: ${res.status}`);
    return res.json() as Promise<LoopRecord>;
  }

  async reportProgress(
    loopId: string,
    phase: string,
    input: {
      label: string;
      detail?: string;
      updateBanner?: boolean;
      active?: boolean;
    },
  ): Promise<void> {
    const res = await fetch(`${this.baseUrl}/api/loops/${loopId}/progress`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId: 'dev-agent',
        phase,
        ...input,
        runId: this.runId,
      }),
    });
    if (!res.ok) {
      console.warn(`reportProgress failed: ${res.status}`);
    }
  }

  async commitDevWorkspace(loopId: string): Promise<{
    commitSha: string;
    hadChanges: boolean;
    pushed?: boolean;
    branch?: string;
  }> {
    const res = await fetch(`${this.baseUrl}/api/loops/${loopId}/workspace/commit-dev`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`commitDevWorkspace: ${res.status} ${text.slice(0, 300)}`);
    }
    return res.json() as Promise<{
      commitSha: string;
      hadChanges: boolean;
      pushed?: boolean;
      branch?: string;
    }>;
  }

  async postAgentMessage(
    loopId: string,
    content: LoopMessage['content'],
    phase: string,
    sdkMessageType?: string,
  ) {
    const res = await fetch(`${this.baseUrl}/api/loops/${loopId}/agent-messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId: 'dev-agent',
        phase,
        content,
        sdkMessageType,
        runId: this.runId,
      }),
    });
    if (!res.ok) throw new Error(`postAgentMessage: ${res.status}`);
    return res.json();
  }

  async postAudit(
    loopId: string,
    body: { agent?: string; action: string; detail?: Record<string, unknown> },
  ) {
    await fetch(`${this.baseUrl}/api/loops/${loopId}/audit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  async requestHumanHelp(
    loopId: string,
    body: {
      requestedBy: 'dev-agent';
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
