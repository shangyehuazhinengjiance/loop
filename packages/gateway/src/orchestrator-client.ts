import type { LoopMessage } from '@loop/shared';

export class OrchestratorClient {
  constructor(private readonly baseUrl: string) {}

  async getMessages(loopId: string): Promise<LoopMessage[]> {
    const res = await fetch(`${this.baseUrl}/api/loops/${loopId}/messages`);
    if (!res.ok) throw new Error(`getMessages failed: ${res.status}`);
    return res.json() as Promise<LoopMessage[]>;
  }

  async sendMessage(
    loopId: string,
    body: string,
    userId = 'human',
    displayName = 'Human',
    mentions?: string[],
  ) {
    const res = await fetch(`${this.baseUrl}/api/loops/${loopId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body, userId, displayName, mentions }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(
        `sendMessage failed: ${res.status}${detail ? ` — ${detail}` : ''}`,
      );
    }
    return res.json();
  }

  async getLoop(loopId: string) {
    const res = await fetch(`${this.baseUrl}/api/loops/${loopId}`);
    if (!res.ok) throw new Error(`getLoop failed: ${res.status}`);
    return res.json();
  }
}
