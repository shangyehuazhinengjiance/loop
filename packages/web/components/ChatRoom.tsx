'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { loadUserIdentity, type UserIdentity } from '../lib/user-identity';
import { messageMentionsUser, mentionTag } from '../lib/mentions';
import { ChatInput, type HumanMentionOption } from './ChatInput';
import { LoopJoinPrompt } from './LoopJoinPrompt';
import { LoopMembersPanel } from './LoopMembersPanel';
import { MarkdownContent } from './MarkdownContent';
import { ProcessingBanner } from './ProcessingBanner';
import { UserIdentityPrompt } from './UserIdentityPrompt';

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:3001';
const ORCHESTRATOR =
  process.env.NEXT_PUBLIC_ORCHESTRATOR_URL ?? 'http://localhost:3000';

const ACTION_REQUIRED_PHASE: Record<string, string> = {
  approve_prd: 'requirement',
  approve_dev: 'development',
  confirm_mr_merged: 'deployment',
  approve_test: 'deployment',
  reject_test: 'deployment',
  approve_deploy: 'deployment',
};

const APPROVE_PENDING_LABEL: Record<string, string> = {
  approve_prd: '正在确认 PRD…',
  approve_dev: '正在提交开发验收…',
  confirm_mr_merged: '正在确认 MR 合并…',
  approve_test: '正在确认测试通过…',
  reject_test: '正在回退至开发…',
  approve_deploy: '正在确认正式上线完成…',
  select_dev_mode_agent: '正在启动 Dev Agent…',
  select_dev_mode_external: '正在发布 PRD 并交接…',
  complete_external_dev: '正在提交开发完成…',
};

interface Action {
  id: string;
  label: string;
  action: string;
}

interface Message {
  id: string;
  sender: { type: string; id: string; displayName: string };
  content: { type: string; body: string; actions?: Action[]; mentions?: string[] };
  phase: string;
  metadata?: { timestamp?: string; sdkMessageType?: string };
}

interface LoopBlocker {
  kind: string;
  reason: string;
  question?: string;
  assigneeUserId: string;
  assigneeDisplayName: string;
  requestedBy: string;
}

interface LoopMember {
  userId: string;
  displayName: string;
  bio: string;
}

interface DevelopmentConfig {
  mode?: 'agent' | 'external';
  prdApprovedBy?: string;
  external?: {
    assigneeUserId: string;
    assigneeDisplayName: string;
    targetBranch?: string;
  };
}

interface DeploymentConfig {
  step?:
    | 'awaiting_mr_merge'
    | 'awaiting_pipeline'
    | 'awaiting_test_deploy'
    | 'awaiting_test_approval'
    | 'awaiting_prod_deploy'
    | 'awaiting_prod_approval';
  mergeRequest?: { url: string; number: number; headBranch?: string; baseBranch?: string };
  mergeAssigneeUserId?: string;
  testApproverUserId?: string;
  targetBranch?: string;
}

export function ChatRoom({ loopId }: { loopId: string }) {
  const [user, setUser] = useState<UserIdentity | null>(null);
  const [identityLoaded, setIdentityLoaded] = useState(false);
  const [showRename, setShowRename] = useState(false);

  const [messages, setMessages] = useState<Message[]>([]);
  const [phase, setPhase] = useState('created');
  const [loopStatus, setLoopStatus] = useState('active');
  const [blocker, setBlocker] = useState<LoopBlocker | null>(null);
  const [members, setMembers] = useState<LoopMember[]>([]);
  const [memberChecked, setMemberChecked] = useState(false);
  const [joined, setJoined] = useState(false);
  const [input, setInput] = useState('');
  const [connected, setConnected] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const [rollbackPhase, setRollbackPhase] = useState('requirement');
  const [clientPending, setClientPending] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [agentProcessing, setAgentProcessing] = useState<string | null>(null);
  const [devConfig, setDevConfig] = useState<DevelopmentConfig | null>(null);
  const [deployConfig, setDeployConfig] = useState<DeploymentConfig | null>(null);
  const [pendingMentionIds, setPendingMentionIds] = useState<string[]>([]);
  const messageListRef = useRef<HTMLDivElement>(null);
  const [externalAssigneeId, setExternalAssigneeId] = useState('');
  const wsRef = useRef<WebSocket | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const busy = Boolean(clientPending || sending || agentProcessing);
  const statusLabel =
    clientPending ?? (sending ? '正在发送消息…' : null) ?? agentProcessing;

  useEffect(() => {
    setUser(loadUserIdentity());
    setIdentityLoaded(true);
  }, []);

  const refreshLoop = useCallback(async () => {
    const loop = await fetch(`${ORCHESTRATOR}/api/loops/${loopId}`).then((r) =>
      r.json(),
    );
    setPhase(loop.phase);
    setLoopStatus(loop.status ?? 'active');
    setBlocker(loop.blocker ?? null);
    setAgentProcessing(
      loop.processing?.active && loop.processing.label ? loop.processing.label : null,
    );
    setDevConfig(loop.context?.development ?? null);
    setDeployConfig(loop.context?.deployment ?? null);
  }, [loopId]);

  const loadMembers = useCallback(async () => {
    const list = (await fetch(`${ORCHESTRATOR}/api/loops/${loopId}/members`).then(
      (r) => r.json(),
    )) as LoopMember[];
    setMembers(list);
    return list;
  }, [loopId]);

  const checkMembership = useCallback(async () => {
    if (!user) return;
    const list = await loadMembers();
    setJoined(list.some((m) => m.userId === user.userId));
    setMemberChecked(true);
  }, [user, loadMembers]);

  const appendMessage = useCallback((msg: Message) => {
    setMessages((prev) => {
      if (prev.some((m) => m.id === msg.id)) return prev;
      return [...prev, msg];
    });
  }, []);

  useEffect(() => {
    if (!user) return;
    void checkMembership();
  }, [user, checkMembership]);

  useEffect(() => {
    if (!externalAssigneeId && members.length > 0) {
      const hinted =
        members.find((m) => /开发|前端|后端|全栈|编程/i.test(m.bio)) ?? members[0];
      setExternalAssigneeId(hinted.userId);
    }
  }, [members, externalAssigneeId]);

  useEffect(() => {
    if (!user || !joined) return;

    refreshLoop();

    const ws = new WebSocket(`${WS_URL}/ws/loops/${loopId}`);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onmessage = (ev) => {
      const data = JSON.parse(ev.data);
      if (data.type === 'history' && Array.isArray(data.messages)) {
        setMessages(data.messages);
      }
      if (data.type === 'message' && data.message) {
        appendMessage(data.message);
        if (
          user &&
          messageMentionsUser(data.message, user.userId)
        ) {
          setPendingMentionIds((prev) =>
            prev.includes(data.message.id) ? prev : [...prev, data.message.id],
          );
        }
        void refreshLoop();
      }
      if (data.type === 'processing') {
        setAgentProcessing(data.active ? (data.label ?? '处理中…') : null);
      }
      if (data.type === 'ack') {
        setSending(false);
      }
      if (data.type === 'error') {
        setSending(false);
        setAgentProcessing(null);
        alert(data.message ?? '操作失败');
      }
    };

    return () => ws.close();
  }, [loopId, user, joined, appendMessage, refreshLoop]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  function send() {
    if (!input.trim() || !wsRef.current || !user || busy) return;
    setSending(true);
    wsRef.current.send(
      JSON.stringify({
        type: 'message',
        body: input,
        userId: user.userId,
        displayName: user.displayName,
      }),
    );
    setInput('');
  }

  function isActionAvailable(action: string): boolean {
    const required = ACTION_REQUIRED_PHASE[action];
    return required !== undefined && phase === required;
  }

  function isLatestDevApproveMessage(message: Message): boolean {
    const lastDevResult = [...messages]
      .reverse()
      .find(
        (m) =>
          m.sender.id === 'dev-agent' &&
          m.content.actions?.some((a) => a.action === 'approve_dev'),
      );
    return lastDevResult?.id === message.id;
  }

  function isLatestModeSelectionMessage(message: Message): boolean {
    const last = [...messages]
      .reverse()
      .find((m) =>
        m.content.actions?.some((a) => a.action.startsWith('select_dev_mode_')),
      );
    return last?.id === message.id;
  }

  function isLatestExternalHandoffMessage(message: Message): boolean {
    const last = [...messages]
      .reverse()
      .find((m) =>
        m.content.actions?.some((a) => a.action === 'complete_external_dev'),
      );
    return last?.id === message.id;
  }

  function canSelectDevMode(): boolean {
    return Boolean(user && devConfig?.prdApprovedBy === user.userId && !devConfig?.mode);
  }

  function canCompleteExternalDev(): boolean {
    return Boolean(
      user &&
        devConfig?.mode === 'external' &&
        devConfig.external?.assigneeUserId === user.userId,
    );
  }

  function isMrMergePending(): boolean {
    return phase === 'deployment' && deployConfig?.step === 'awaiting_mr_merge';
  }

  function canConfirmMrMerged(): boolean {
    if (!user || !isMrMergePending()) return false;
    if (deployConfig?.mergeAssigneeUserId) {
      return deployConfig.mergeAssigneeUserId === user.userId;
    }
    return true;
  }

  function canResolveBlocker(): boolean {
    if (!user || !blocker) return false;
    return blocker.assigneeUserId === user.userId;
  }

  function scrollToMention(messageId: string) {
    const el = document.getElementById(`loop-msg-${messageId}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setPendingMentionIds((prev) => prev.filter((id) => id !== messageId));
  }

  function dismissAllMentions() {
    setPendingMentionIds([]);
  }

  function shouldOfferRecover(): boolean {
    if (loopStatus === 'blocked') return true;
    const step = deployConfig?.step;
    if (
      phase === 'deployment' &&
      (step === 'awaiting_test_deploy' || step === 'awaiting_prod_deploy')
    ) {
      return true;
    }
    if (phase === 'deployment' && !step && !deployConfig?.mergeRequest) {
      return true;
    }
    return false;
  }

  function canApproveTest(): boolean {
    if (!user || !isAwaitingTestApproval()) return false;
    if (deployConfig?.testApproverUserId) {
      return deployConfig.testApproverUserId === user.userId;
    }
    return true;
  }

  function isLatestMrMergeMessage(message: Message): boolean {
    const last = [...messages]
      .reverse()
      .find((m) =>
        m.content.actions?.some((a) => a.action === 'confirm_mr_merged'),
      );
    return last?.id === message.id;
  }

  function isLatestTestApprovalMessage(message: Message): boolean {
    const last = [...messages]
      .reverse()
      .find((m) =>
        m.content.actions?.some(
          (a) => a.action === 'approve_test' || a.action === 'reject_test',
        ),
      );
    return last?.id === message.id;
  }

  function isLatestProdApprovalMessage(message: Message): boolean {
    const last = [...messages]
      .reverse()
      .find((m) =>
        m.content.actions?.some((a) => a.action === 'approve_deploy'),
      );
    return last?.id === message.id;
  }

  function isAwaitingTestApproval(): boolean {
    return (
      deployConfig?.step === 'awaiting_test_approval' ||
      deployConfig?.step === 'awaiting_pipeline'
    );
  }

  function isAwaitingProdApproval(): boolean {
    return deployConfig?.step === 'awaiting_prod_approval';
  }

  /** 展示审批按钮（含不可用态，避免「文案让点但按钮消失」） */
  function shouldShowAction(action: string, message: Message): boolean {
    if (action === 'select_dev_mode_agent' || action === 'select_dev_mode_external') {
      if (!devConfig || devConfig.mode) return false;
      return isLatestModeSelectionMessage(message);
    }
    if (action === 'complete_external_dev') {
      if (devConfig?.mode !== 'external' || phase !== 'development') return false;
      return isLatestExternalHandoffMessage(message);
    }
    if (action === 'approve_dev') {
      if (devConfig?.mode === 'external') return false;
      if (!message.content.actions?.some((a) => a.action === 'approve_dev')) {
        return false;
      }
      return isLatestDevApproveMessage(message);
    }
    if (action === 'confirm_mr_merged') {
      if (deployConfig?.step !== 'awaiting_mr_merge') return false;
      return isLatestMrMergeMessage(message);
    }
    if (action === 'approve_test' || action === 'reject_test') {
      if (!isAwaitingTestApproval()) return false;
      return isLatestTestApprovalMessage(message);
    }
    if (!isActionAvailable(action)) return false;
    if (action === 'approve_prd') {
      return message.content.type === 'artifact';
    }
    if (action === 'approve_deploy') {
      if (!isAwaitingTestApproval() && !isAwaitingProdApproval()) return false;
      if (deployConfig?.step === 'awaiting_pipeline' || isAwaitingProdApproval()) {
        if (message.content.type !== 'artifact') return false;
        return isLatestProdApprovalMessage(message);
      }
      return false;
    }
    return true;
  }

  function isActionClickable(action: string): boolean {
    if (action === 'select_dev_mode_agent' || action === 'select_dev_mode_external') {
      return canSelectDevMode();
    }
    if (action === 'complete_external_dev') {
      return canCompleteExternalDev();
    }
    if (action === 'confirm_mr_merged') {
      return canConfirmMrMerged();
    }
    if (action === 'approve_test' || action === 'reject_test') {
      return canApproveTest();
    }
    if (action === 'approve_deploy') {
      return isAwaitingProdApproval() || deployConfig?.step === 'awaiting_pipeline';
    }
    return isActionAvailable(action);
  }

  function actionDisabledHint(action: string): string | undefined {
    if (action === 'select_dev_mode_agent' || action === 'select_dev_mode_external') {
      if (!canSelectDevMode()) {
        return devConfig?.mode
          ? '开发模式已选择'
          : '仅 PRD 确认人可选择开发方式';
      }
      return undefined;
    }
    if (action === 'complete_external_dev') {
      if (!canCompleteExternalDev()) {
        return '仅被指派的开发负责人可确认完成';
      }
      return undefined;
    }
    if (action === 'confirm_mr_merged') {
      if (!canConfirmMrMerged()) {
        return '仅被指派的合并负责人可确认 MR 已合并';
      }
      return undefined;
    }
    if (action === 'approve_test' || action === 'reject_test') {
      if (!canApproveTest()) {
        return deployConfig?.testApproverUserId
          ? '仅被指派的测试审批人可操作'
          : '请等待测试环境部署完成';
      }
      return undefined;
    }
    if (action === 'approve_deploy' && !isAwaitingProdApproval() && deployConfig?.step !== 'awaiting_pipeline') {
      return '请先完成测试审批与生产部署';
    }
    if (!isActionAvailable(action)) {
      const required = ACTION_REQUIRED_PHASE[action];
      if (required) {
        return `当前阶段为 ${phase}，需处于 ${required} 阶段。请使用顶部「回退」后再操作。`;
      }
    }
    return undefined;
  }

  async function selectDevMode(mode: 'agent' | 'external') {
    if (!user || !canSelectDevMode()) return;
    setClientPending(
      mode === 'agent'
        ? APPROVE_PENDING_LABEL.select_dev_mode_agent
        : APPROVE_PENDING_LABEL.select_dev_mode_external,
    );
    try {
      const res = await fetch(`${ORCHESTRATOR}/api/loops/${loopId}/development/mode`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode,
          userId: user.userId,
          assigneeUserId: mode === 'external' ? externalAssigneeId || undefined : undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.message ?? `选择开发模式失败 (${res.status})`);
        return;
      }
      await refreshLoop();
    } finally {
      setClientPending(null);
    }
  }

  async function completeExternalDev() {
    if (!user || !canCompleteExternalDev()) return;
    setClientPending(APPROVE_PENDING_LABEL.complete_external_dev);
    try {
      const res = await fetch(`${ORCHESTRATOR}/api/loops/${loopId}/development/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.userId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.message ?? `确认失败 (${res.status})`);
        return;
      }
      await refreshLoop();
    } finally {
      setClientPending(null);
    }
  }

  async function handleAction(action: string) {
    if (action === 'select_dev_mode_agent') {
      await selectDevMode('agent');
      return;
    }
    if (action === 'select_dev_mode_external') {
      await selectDevMode('external');
      return;
    }
    if (action === 'complete_external_dev') {
      await completeExternalDev();
      return;
    }
    await approve(action);
  }

  async function approve(action: string) {
    if (!user || busy) return;
    if (!isActionAvailable(action)) {
      alert(`当前阶段为 ${phase}，无法执行 ${action}`);
      return;
    }
    setClientPending(APPROVE_PENDING_LABEL[action] ?? '正在处理…');
    try {
      const res = await fetch(`${ORCHESTRATOR}/api/loops/${loopId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, approvedBy: user.userId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.message ?? `审批失败 (${res.status})`);
        return;
      }
      await refreshLoop();
    } finally {
      setClientPending(null);
    }
  }

  async function recoverLoop() {
    if (!user || busy) return;
    setClientPending('正在恢复流程…');
    try {
      const res = await fetch(`${ORCHESTRATOR}/api/loops/${loopId}/recover`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.userId }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        message?: string;
        actions?: string[];
        hints?: string[];
      };
      if (!res.ok) {
        alert(data.message ?? `恢复失败 (${res.status})`);
        return;
      }
      if (data.hints?.length) {
        alert(['已执行：', ...(data.actions ?? []), '', '提示：', ...data.hints].join('\n'));
      }
      await refreshLoop();
    } finally {
      setClientPending(null);
    }
  }

  async function resolveBlocker() {
    if (!user || busy) return;
    const note = prompt('处理说明（可选）：') ?? undefined;
    setClientPending('正在解除阻塞…');
    try {
      const res = await fetch(`${ORCHESTRATOR}/api/loops/${loopId}/blocker/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.userId, note: note || undefined }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.message ?? '解除阻塞失败');
        return;
      }
      await refreshLoop();
    } finally {
      setClientPending(null);
    }
  }

  async function rollback() {
    if (!user || busy) return;
    const reason = prompt('回退原因：');
    if (!reason) return;
    setClientPending('正在回退阶段…');
    try {
      await fetch(`${ORCHESTRATOR}/api/loops/${loopId}/rollback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetPhase: rollbackPhase,
          reason,
          userId: user.userId,
        }),
      });
      await refreshLoop();
    } finally {
      setClientPending(null);
    }
  }

  if (!identityLoaded) {
    return (
      <div style={{ padding: 48, textAlign: 'center', color: '#8b949e' }}>加载中…</div>
    );
  }

  if (!user) {
    return (
      <UserIdentityPrompt
        onComplete={(identity) => {
          setUser(identity);
        }}
      />
    );
  }

  if (!memberChecked) {
    return (
      <div style={{ padding: 48, textAlign: 'center', color: '#8b949e' }}>检查成员身份…</div>
    );
  }

  if (!joined) {
    return (
      <LoopJoinPrompt
        loopId={loopId}
        user={user}
        orchestratorUrl={ORCHESTRATOR}
        onJoined={() => {
          setJoined(true);
          void loadMembers();
        }}
      />
    );
  }

  const humanMentions: HumanMentionOption[] = members.map((m) => ({
    mention: `@${m.userId}`,
    label: m.displayName,
    desc: m.bio.trim() || '各类问题均可',
  }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <LoopMembersPanel
        loopId={loopId}
        user={user}
        orchestratorUrl={ORCHESTRATOR}
        open={showMembers}
        onClose={() => setShowMembers(false)}
        onUpdated={() => void loadMembers()}
      />

      {showRename && (
        <UserIdentityPrompt
          title="修改昵称"
          initialName={user.displayName}
          onCancel={() => setShowRename(false)}
          onComplete={(identity) => {
            setUser(identity);
            setShowRename(false);
          }}
        />
      )}

      <header
        style={{
          padding: '12px 20px',
          borderBottom: '1px solid #30363d',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 8,
        }}
      >
        <div>
          <Link href="/" style={{ color: '#8b949e', fontSize: 13, marginRight: 12 }}>
            ← 首页
          </Link>
          <strong>Loop</strong>{' '}
          <span style={{ color: '#8b949e', fontSize: 13 }}>{loopId.slice(0, 8)}…</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
          <button
            type="button"
            onClick={() => setShowRename(true)}
            title={`ID: ${user.userId}`}
            style={{
              padding: '2px 8px',
              borderRadius: 12,
              border: '1px solid #30363d',
              background: '#21262d',
              color: '#58a6ff',
              cursor: 'pointer',
            }}
          >
            {user.displayName}
          </button>
          <span
            style={{
              padding: '2px 8px',
              borderRadius: 12,
              background: loopStatus === 'blocked' ? '#3d2a00' : '#21262d',
              color: loopStatus === 'blocked' ? '#d29922' : undefined,
            }}
          >
            {phase}
            {devConfig?.mode === 'agent' ? ' · Dev Agent' : ''}
            {devConfig?.mode === 'external' ? ' · 外部工具' : ''}
            {deployConfig?.step === 'awaiting_mr_merge' ? ' · 待合并 MR' : ''}
            {deployConfig?.step === 'awaiting_test_deploy' ? ' · 测试环境部署中' : ''}
            {deployConfig?.step === 'awaiting_test_approval' ? ' · 待测试审批' : ''}
            {deployConfig?.step === 'awaiting_prod_deploy' ? ' · 生产部署中' : ''}
            {deployConfig?.step === 'awaiting_prod_approval' ? ' · 待确认上线' : ''}
            {deployConfig?.step === 'awaiting_pipeline' ? ' · 待跑流水线' : ''}
            {loopStatus === 'blocked' ? ' · 阻塞中' : ''}
          </span>
          <button
            type="button"
            onClick={() => setShowMembers(true)}
            style={{
              padding: '2px 8px',
              borderRadius: 6,
              border: '1px solid #30363d',
              background: '#21262d',
              color: '#e6edf3',
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            成员 ({members.length})
          </button>
          <Link href={`/loop/${loopId}/replay`} style={{ fontSize: 13 }}>
            回放
          </Link>
          <select
            value={rollbackPhase}
            onChange={(e) => setRollbackPhase(e.target.value)}
            style={{
              background: '#21262d',
              color: '#e6edf3',
              border: '1px solid #30363d',
              borderRadius: 6,
              padding: '2px 6px',
            }}
          >
            <option value="requirement">requirement</option>
            <option value="development">development</option>
          </select>
          {shouldOfferRecover() && (
            <button
              type="button"
              onClick={() => void recoverLoop()}
              disabled={busy}
              title="解除阻塞并重新激活 Agent / 重试卡住的部署步骤"
              style={{
                padding: '4px 10px',
                borderRadius: 6,
                border: '1px solid #d29922',
                background: '#3d2a00',
                color: busy ? '#8b949e' : '#d29922',
                fontSize: 12,
                fontWeight: 600,
                cursor: busy ? 'not-allowed' : 'pointer',
                opacity: busy ? 0.6 : 1,
              }}
            >
              恢复流程
            </button>
          )}
          <button
            onClick={rollback}
            disabled={busy}
            style={{
              padding: '4px 10px',
              borderRadius: 6,
              border: '1px solid #f85149',
              background: 'transparent',
              color: busy ? '#8b949e' : '#f85149',
              fontSize: 12,
              cursor: busy ? 'not-allowed' : 'pointer',
              opacity: busy ? 0.6 : 1,
            }}
          >
            回退
          </button>
          <span style={{ color: connected ? '#3fb950' : '#f85149' }}>
            {connected ? '已连接' : '断开'}
          </span>
        </div>
      </header>

      {statusLabel && <ProcessingBanner label={statusLabel} />}

      {phase === 'development' && !devConfig?.mode && devConfig?.prdApprovedBy && (
        <div
          style={{
            padding: '12px 20px',
            background: '#132339',
            borderBottom: '1px solid #388bfd66',
            fontSize: 14,
            lineHeight: 1.5,
          }}
        >
          <strong>请选择开发方式</strong>
          <span style={{ color: '#8b949e', marginLeft: 8, fontSize: 13 }}>
            {canSelectDevMode()
              ? '（您是 PRD 确认人）'
              : `（等待 PRD 确认人操作）`}
          </span>
          {canSelectDevMode() && (
            <div
              style={{
                marginTop: 10,
                display: 'flex',
                flexWrap: 'wrap',
                gap: 8,
                alignItems: 'center',
              }}
            >
              <button
                type="button"
                disabled={busy}
                onClick={() => void selectDevMode('agent')}
                style={{
                  padding: '6px 12px',
                  borderRadius: 6,
                  border: '1px solid #238636',
                  background: 'transparent',
                  color: '#3fb950',
                  cursor: busy ? 'not-allowed' : 'pointer',
                }}
              >
                Loop 内 Dev Agent
              </button>
              <select
                value={externalAssigneeId}
                onChange={(e) => setExternalAssigneeId(e.target.value)}
                disabled={busy}
                style={{
                  padding: '6px 8px',
                  borderRadius: 6,
                  border: '1px solid #30363d',
                  background: '#21262d',
                  color: '#e6edf3',
                  fontSize: 13,
                }}
              >
                {members.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.displayName} ({m.userId})
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={busy || !externalAssigneeId}
                onClick={() => void selectDevMode('external')}
                style={{
                  padding: '6px 12px',
                  borderRadius: 6,
                  border: '1px solid #388bfd',
                  background: 'transparent',
                  color: '#58a6ff',
                  cursor: busy ? 'not-allowed' : 'pointer',
                }}
              >
                外部工具开发
              </button>
            </div>
          )}
        </div>
      )}

      {user && pendingMentionIds.length > 0 && (
        <div
          style={{
            padding: '10px 20px',
            background: '#132339',
            borderBottom: '1px solid #388bfd',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ fontSize: 14, color: '#e6edf3' }}>
            <span className="mention-you-pill" style={{ marginRight: 8 }}>
              {mentionTag(user.userId)}
            </span>
            有 <strong>{pendingMentionIds.length}</strong> 条新消息提及你
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={() => scrollToMention(pendingMentionIds[0]!)}
              style={{
                padding: '6px 12px',
                borderRadius: 6,
                border: 'none',
                background: '#388bfd',
                color: '#fff',
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              查看提及
            </button>
            <button
              type="button"
              onClick={dismissAllMentions}
              style={{
                padding: '6px 12px',
                borderRadius: 6,
                border: '1px solid #30363d',
                background: 'transparent',
                color: '#8b949e',
                fontSize: 13,
              }}
            >
              知道了
            </button>
          </div>
        </div>
      )}

      {blocker && loopStatus === 'blocked' && (
        <div
          style={{
            padding: '12px 20px',
            background: '#3d2a00',
            borderBottom: '1px solid #9e6a03',
            fontSize: 14,
            lineHeight: 1.5,
          }}
        >
          <strong style={{ color: '#d29922' }}>等待 @{blocker.assigneeDisplayName}</strong>
          <span style={{ color: '#e6edf3' }}> — {blocker.reason}</span>
          {blocker.question && (
            <div style={{ color: '#8b949e', marginTop: 4 }}>{blocker.question}</div>
          )}
          {blocker.kind === 'external' ? (
            <div style={{ color: '#8b949e', marginTop: 8, fontSize: 13 }}>
              请在下方交接消息中由开发负责人点击「开发完成，进入部署」。
              {devConfig?.external?.targetBranch && (
                <span> 分支：{devConfig.external.targetBranch}</span>
              )}
            </div>
          ) : isMrMergePending() ? (
            <div style={{ color: '#8b949e', marginTop: 8, fontSize: 13 }}>
              请在 Git 平台合并 MR 后，点击下方「部署操作」栏中的「MR 已合并」。
            </div>
          ) : (
            <div style={{ marginTop: 8 }}>
              <div style={{ color: '#8b949e', fontSize: 13, marginBottom: 8 }}>
                {blocker.requestedBy === 'ops-agent'
                  ? '处理完成后点击「已解决」解除阻塞，再 @ops-agent 继续部署。'
                  : blocker.requestedBy === 'dev-agent'
                    ? '处理完成后点击「已解决」解除阻塞，再 @dev-agent 继续。'
                    : blocker.requestedBy === 'pm-agent'
                      ? '处理完成后点击「已解决」解除阻塞，再 @pm-agent 继续。'
                      : '处理完成后点击「已解决」解除阻塞。'}
              </div>
              <button
                type="button"
                onClick={resolveBlocker}
                disabled={busy || !canResolveBlocker()}
                title={
                  canResolveBlocker()
                    ? undefined
                    : `仅 @${blocker.assigneeDisplayName} 可解除阻塞`
                }
                style={{
                  padding: '6px 12px',
                  borderRadius: 6,
                  border: '1px solid #9e6a03',
                  background: '#238636',
                  color: '#fff',
                  fontSize: 13,
                  cursor: busy || !canResolveBlocker() ? 'not-allowed' : 'pointer',
                  opacity: busy || !canResolveBlocker() ? 0.7 : 1,
                }}
              >
                {clientPending === '正在解除阻塞…' ? '处理中…' : '已解决，解除阻塞'}
              </button>
            </div>
          )}
        </div>
      )}

      {(isMrMergePending() ||
        isAwaitingTestApproval() ||
        isAwaitingProdApproval()) && (
        <div
          style={{
            padding: '12px 20px',
            borderBottom: '1px solid #30363d',
            background: '#161b22',
          }}
        >
          <div style={{ fontSize: 13, color: '#8b949e', marginBottom: 10 }}>部署操作</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            {isMrMergePending() && deployConfig?.mergeRequest?.url && (
              <a
                href={deployConfig.mergeRequest.url}
                target="_blank"
                rel="noreferrer"
                style={{ color: '#58a6ff', fontSize: 13 }}
              >
                打开 MR #{deployConfig.mergeRequest.number}
              </a>
            )}
            {isMrMergePending() && (
              <button
                type="button"
                onClick={() => canConfirmMrMerged() && !busy && void handleAction('confirm_mr_merged')}
                disabled={!canConfirmMrMerged() || busy}
                title={actionDisabledHint('confirm_mr_merged')}
                style={{
                  padding: '6px 14px',
                  borderRadius: 6,
                  border: `1px solid ${canConfirmMrMerged() && !busy ? '#238636' : '#484f58'}`,
                  background: canConfirmMrMerged() && !busy ? '#238636' : 'transparent',
                  color: canConfirmMrMerged() && !busy ? '#fff' : '#8b949e',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: canConfirmMrMerged() && !busy ? 'pointer' : 'not-allowed',
                }}
              >
                {clientPending === APPROVE_PENDING_LABEL.confirm_mr_merged
                  ? '处理中…'
                  : 'MR 已合并'}
              </button>
            )}
            {isAwaitingTestApproval() && (
              <>
                <button
                  type="button"
                  onClick={() => canApproveTest() && !busy && void handleAction('approve_test')}
                  disabled={!canApproveTest() || busy}
                  title={actionDisabledHint('approve_test')}
                  style={{
                    padding: '6px 14px',
                    borderRadius: 6,
                    border: '1px solid #238636',
                    background: canApproveTest() && !busy ? '#238636' : 'transparent',
                    color: canApproveTest() && !busy ? '#fff' : '#8b949e',
                    fontSize: 13,
                    cursor: canApproveTest() && !busy ? 'pointer' : 'not-allowed',
                  }}
                >
                  测试通过，进入上线
                </button>
                <button
                  type="button"
                  onClick={() => canApproveTest() && !busy && void handleAction('reject_test')}
                  disabled={!canApproveTest() || busy}
                  title={actionDisabledHint('reject_test')}
                  style={{
                    padding: '6px 14px',
                    borderRadius: 6,
                    border: '1px solid #f85149',
                    background: 'transparent',
                    color: canApproveTest() && !busy ? '#f85149' : '#8b949e',
                    fontSize: 13,
                    cursor: canApproveTest() && !busy ? 'pointer' : 'not-allowed',
                  }}
                >
                  测试不通过，回退开发
                </button>
              </>
            )}
            {isAwaitingProdApproval() && (
              <button
                type="button"
                onClick={() =>
                  isActionClickable('approve_deploy') &&
                  !busy &&
                  void handleAction('approve_deploy')
                }
                disabled={!isActionClickable('approve_deploy') || busy}
                title={actionDisabledHint('approve_deploy')}
                style={{
                  padding: '6px 14px',
                  borderRadius: 6,
                  border: '1px solid #238636',
                  background:
                    isActionClickable('approve_deploy') && !busy ? '#238636' : 'transparent',
                  color: isActionClickable('approve_deploy') && !busy ? '#fff' : '#8b949e',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor:
                    isActionClickable('approve_deploy') && !busy ? 'pointer' : 'not-allowed',
                }}
              >
                确认正式上线完成
              </button>
            )}
          </div>
        </div>
      )}

      <div ref={messageListRef} style={{ flex: 1, overflow: 'auto', padding: 20 }}>
        {messages.map((m) => {
          const mentionsYou = Boolean(user && messageMentionsUser(m, user.userId));
          const mentionUnread = pendingMentionIds.includes(m.id);
          return (
          <div
            key={m.id}
            id={`loop-msg-${m.id}`}
            style={{
              marginBottom: 16,
              scrollMarginTop: 80,
            }}
          >
            <div style={{ fontSize: 12, color: '#8b949e', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>
                {m.sender.displayName} · {m.phase}
                {m.content.type !== 'text' && ` · ${m.content.type}`}
              </span>
              {mentionsYou && (
                <span
                  className="mention-you-pill"
                  style={{ fontSize: 11, padding: '1px 6px' }}
                >
                  提及你
                </span>
              )}
            </div>
            <div
              style={{
                padding: '10px 14px',
                borderRadius: 8,
                background: mentionsYou
                  ? '#132339'
                  : m.sender.type === 'human' && m.sender.id === user?.userId
                    ? '#1a2332'
                    : m.sender.type === 'human'
                      ? '#161b22'
                      : '#1c2128',
                border: mentionUnread
                  ? '1px solid #388bfd'
                  : mentionsYou
                    ? '1px solid #388bfd66'
                    : m.sender.id === user?.userId
                      ? '1px solid #388bfd66'
                      : '1px solid #30363d',
                boxShadow: mentionUnread ? '0 0 0 1px #388bfd44' : undefined,
              }}
            >
              <MarkdownContent content={m.content.body} />
            </div>
            {m.content.actions
              ?.filter((a) => shouldShowAction(a.action, m))
              .map((a) => {
                const clickable = isActionClickable(a.action);
                const hint = actionDisabledHint(a.action);
                return (
                  <div key={a.id} style={{ marginTop: 8 }}>
                    <button
                      type="button"
                      onClick={() => clickable && !busy && void handleAction(a.action)}
                      disabled={!clickable || busy}
                      title={hint}
                      style={{
                        marginRight: 8,
                        padding: '6px 12px',
                        borderRadius: 6,
                        border: `1px solid ${clickable && !busy ? '#238636' : '#484f58'}`,
                        background: 'transparent',
                        color: clickable && !busy ? '#3fb950' : '#8b949e',
                        cursor: clickable && !busy ? 'pointer' : 'not-allowed',
                      }}
                    >
                      {clientPending && APPROVE_PENDING_LABEL[a.action] === clientPending
                        ? '处理中…'
                        : a.label}
                    </button>
                    {hint && (
                      <div style={{ fontSize: 12, color: '#8b949e', marginTop: 4 }}>
                        {hint}
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <div
        style={{
          padding: 16,
          borderTop: '1px solid #30363d',
          display: 'flex',
          gap: 8,
        }}
      >
        <ChatInput
          value={input}
          onChange={setInput}
          onSend={send}
          disabled={!connected || busy}
          humanMentions={humanMentions}
        />
        <button
          onClick={send}
          disabled={!connected || busy || !input.trim()}
          style={{
            padding: '10px 20px',
            borderRadius: 8,
            border: 'none',
            background: '#238636',
            color: '#fff',
            opacity: !connected || busy || !input.trim() ? 0.6 : 1,
            cursor: !connected || busy || !input.trim() ? 'not-allowed' : 'pointer',
          }}
        >
          {sending ? '发送中…' : '发送'}
        </button>
      </div>
    </div>
  );
}
