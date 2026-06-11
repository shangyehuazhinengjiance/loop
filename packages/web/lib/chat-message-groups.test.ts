import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ChatMessageModel } from '../components/ChatMessageBubble.js';
import { groupChatMessages, isIntermediateMessage } from './chat-message-groups.js';

function agentMsg(body: string, id: string): ChatMessageModel {
  return {
    id,
    sender: { type: 'agent', id: 'dev-agent', displayName: 'Dev Agent' },
    content: { type: 'text', body },
    phase: 'development',
    metadata: { timestamp: `2026-06-12T01:40:${id.padStart(2, '0')}.000Z` },
  };
}

describe('chat-message-groups', () => {
  it('detects dev agent tool progress by body', () => {
    assert.equal(isIntermediateMessage(agentMsg('正在读取 foo.ts', '1')), true);
    assert.equal(
      isIntermediateMessage({
        ...agentMsg('开发完成', '2'),
        content: {
          type: 'artifact',
          body: '开发完成',
          actions: [{ id: 'a', label: '验收', action: 'approve_dev' }],
        },
      }),
      false,
    );
  });

  it('groups consecutive dev agent logs', () => {
    const items = groupChatMessages([
      agentMsg('正在读取 a.ts', '1'),
      agentMsg('修改文件 b.ts', '2'),
      agentMsg('执行：npm test', '3'),
    ]);
    assert.equal(items.length, 1);
    assert.equal(items[0]?.kind, 'process-log');
    if (items[0]?.kind === 'process-log') {
      assert.equal(items[0].messages.length, 3);
    }
  });
});
