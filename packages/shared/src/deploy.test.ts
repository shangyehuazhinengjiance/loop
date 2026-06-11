import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isAwaitingProdApproval,
  isAwaitingTestApproval,
  resolveOpsDeployTarget,
} from './deploy.js';

describe('deploy helpers', () => {
  it('resolveOpsDeployTarget maps steps', () => {
    assert.equal(resolveOpsDeployTarget('awaiting_test_deploy'), 'test');
    assert.equal(resolveOpsDeployTarget('awaiting_prod_deploy'), 'production');
    assert.equal(resolveOpsDeployTarget('awaiting_mr_merge'), null);
  });

  it('isAwaitingTestApproval includes legacy pipeline step', () => {
    assert.equal(isAwaitingTestApproval('awaiting_test_approval'), true);
    assert.equal(isAwaitingTestApproval('awaiting_pipeline'), true);
    assert.equal(isAwaitingTestApproval('awaiting_prod_approval'), false);
  });

  it('isAwaitingProdApproval', () => {
    assert.equal(isAwaitingProdApproval('awaiting_prod_approval'), true);
    assert.equal(isAwaitingProdApproval('awaiting_test_approval'), false);
  });
});
