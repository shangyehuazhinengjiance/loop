import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseLoopDotLlmOutput } from './loop-dot-loop-llm.js';

describe('parseLoopDotLlmOutput', () => {
  it('parses delimiter sections', () => {
    const text = `---LOOP_README---
# 项目
---LOOP_DESIGN---
# 架构
---LOOP_HISTORY---
# 历史
---LOOP_MEMORY---
# 记忆`;
    const parsed = parseLoopDotLlmOutput(text);
    assert.equal(parsed.readme, '# 项目');
    assert.equal(parsed.design, '# 架构');
    assert.equal(parsed.history, '# 历史');
    assert.equal(parsed.memory, '# 记忆');
  });
});
