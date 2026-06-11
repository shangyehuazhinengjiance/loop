'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { loadUserIdentity, type UserIdentity } from '../lib/user-identity';
import { messageMentionsUser, mentionTag } from '../lib/mentions';
import { ChatInput, type HumanMentionOption } from './ChatInput';
import { LoopJoinPrompt } from './LoopJoinPrompt';
import { LoopMembersPanel } from './LoopMembersPanel';
import { ChatMessageBubble } from './ChatMessageBubble';
import { ChatProcessLogGroup } from './ChatProcessLogGroup';
import { ProcessingBanner } from './ProcessingBanner';
import { formatLoopCreatedAt } from '../lib/chat-time';
import { groupChatMessages } from '../lib/chat-message-groups';
import { UserIdentityPrompt } from './UserIdentityPrompt';

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:3001';
const ORCHESTRATOR =
  process.env.NEXT_PUBLIC_ORCHESTRATOR_URL ?? 'http://localhost:3000';

const ACTION_REQUIRED_PHASE: Record<string, string> = {
  approve_prd: 'requirement',
  approve_dev: 'development',
  confirm_mr_merged: 'deployment',
  confirm_master_mr_merged: 'deployment',
  approve_test: 'deployment',
  reject_test: 'deployment',
  approve_deploy: 'deployment',
};

const APPROVE_PENDING_LABEL: Record<string, string> = {
  approve_prd: '正在确认 PRD…',
  approve_dev: '正在提交开发验收…',
  confirm_mr_merged: '正在确认 MR 合并…',
  confirm_master_mr_merged: '正在确认上线 MR 合并…',
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
  content: {
    type: string;
    body: string;
    actions?: Action[];
    mentions?: string[];
    sdkMessageType?: string;
  };
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
  executionMode?: 'manual' | 'agent';
  step?:
    | 'awaiting_mr_merge'
    | 'awaiting_pipeline'
    | 'awaiting_test_deploy'
    | 'awaiting_test_approval'
    | 'awaiting_manual_test_deploy'
    | 'awaiting_master_mr_merge'
    | 'awaiting_manual_prod_verify'
    | 'awaiting_prod_deploy'
    | 'awaiting_prod_approval';
  mergeRequest?: { url: string; number: number; headBranch?: string; baseBranch?: string };
  masterMergeRequest?: { url: string; number: number; headBranch?: string; baseBranch?: string };
  mergeAssigneeUserId?: string;
  masterMergeAssigneeUserId?: string;
  testApproverUserId?: string;
  targetBranch?: string;
  productionBranch?: string;
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
  const [phaseSwitchTargets, setPhaseSwitchTargets] = useState<
    { phase: string; label: string }[]
  >([]);
  const [switchTargetPhase, setSwitchTargetPhase] = useState('');
  const [clientPending, setClientPending] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [agentProcessing, setAgentProcessing] = useState<string | null>(null);
  const [devConfig, setDevConfig] = useState<DevelopmentConfig | null>(null);
  const [deployConfig, setDeployConfig] = useState<DeploymentConfig | null>(null);
  const [pendingMentionIds, setPendingMentionIds] = useState<string[]>([]);
  const [loopTitle, setLoopTitle] = useState('');
  const [loopCreatedAt, setLoopCreatedAt] = useState<string | undefined>();
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
    setLoopTitle(loop.title ?? '');
    const created =
      loop.created_at ?? loop.createdAt ?? loop.updated_at ?? loop.updatedAt;
    setLoopCreatedAt(
      typeof created === 'string' ? created : created?.toISOString?.(),
    );
    setLoopStatus(loop.status ?? 'active');
    setBlocker(loop.blocker ?? null);
    setAgentProcessing(
      loop.processing?.active && loop.processing.label ? loop.processing.label : null,
    );
    setDevConfig(loop.context?.development ?? null);
    setDeployConfig(loop.context?.deployment ?? null);

    try {
      const opts = await fetch(
        `${ORCHESTRATOR}/api/loops/${loopId}/phase/switch-options`,
      ).then((r) => (r.ok ? r.json() : null));
      if (opts?.switchTargets) {
        setPhaseSwitchTargets(opts.switchTargets);
        setSwitchTargetPhase((prev) => {
          const phases = opts.switchTargets.map((t: { phase: string }) => t.phase);
          if (prev && phases.includes(prev)) return prev;
          return phases[0] ?? '';
        });
      } else {
        setPhaseSwitchTargets([]);
        setSwitchTargetPhase('');
      }
    } catch {
      setPhaseSwitchTargets([]);
      setSwitchTargetPhase('');
    }
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

  function isMasterMrMergePending(): boolean {
    return phase === 'deployment' && deployConfig?.step === 'awaiting_master_mr_merge';
  }

  function canConfirmMrMerged(): boolean {
    if (!user || !isMrMergePending()) return false;
    if (deployConfig?.mergeAssigneeUserId) {
      return deployConfig.mergeAssigneeUserId === user.userId;
    }
    return true;
  }

  function canConfirmMasterMrMerged(): boolean {
    if (!user || !isMasterMrMergePending()) return false;
    if (deployConfig?.masterMergeAssigneeUserId) {
      return deployConfig.masterMergeAssigneeUserId === user.userId;
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
    const isAgentDeploy =
      deployConfig?.executionMode !== 'manual' &&
      (step === 'awaiting_test_deploy' || step === 'awaiting_prod_deploy');
    if (phase === 'deployment' && isAgentDeploy) {
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

  function isLatestMasterMrMergeMessage(message: Message): boolean {
    const last = [...messages]
      .reverse()
      .find((m) =>
        m.content.actions?.some((a) => a.action === 'confirm_master_mr_merged'),
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
      phase === 'deployment' &&
      (deployConfig?.step === 'awaiting_test_approval' ||
        deployConfig?.step === 'awaiting_pipeline' ||
        deployConfig?.step === 'awaiting_manual_test_deploy')
    );
  }

  function isAwaitingProdApproval(): boolean {
    return (
      phase === 'deployment' &&
      (deployConfig?.step === 'awaiting_prod_approval' ||
        deployConfig?.step === 'awaiting_manual_prod_verify')
    );
  }

  function isManualDeployMode(): boolean {
    return deployConfig?.executionMode !== 'agent';
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
    if (action === 'confirm_master_mr_merged') {
      if (deployConfig?.step !== 'awaiting_master_mr_merge') return false;
      return isLatestMasterMrMergeMessage(message);
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
    if (action === 'confirm_master_mr_merged') {
      return canConfirmMasterMrMerged();
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
    if (action === 'confirm_master_mr_merged') {
      if (!canConfirmMasterMrMerged()) {
        return '仅被指派的合并负责人可确认上线 MR 已合并';
      }
      return undefined;
    }
    if (action === 'approve_test' || action === 'reject_test') {
      if (!canApproveTest()) {
        return deployConfig?.testApproverUserId
          ? '仅被指派的测试审批人可操作'
          : isManualDeployMode()
            ? '请先完成测试环境部署与验证'
            : '请等待测试环境部署完成';
      }
      return undefined;
    }
    if (action === 'approve_deploy' && !isAwaitingProdApproval() && deployConfig?.step !== 'awaiting_pipeline') {
      return isManualDeployMode()
        ? '请先完成测试验证、上线 MR 合并与生产验证'
        : '请先完成测试审批与生产部署';
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
    if (
      action === 'approve_deploy' &&
      phase === 'done' &&
      (deployConfig?.step === 'awaiting_prod_approval' ||
        deployConfig?.step === 'awaiting_manual_prod_verify')
    ) {
      setClientPending(APPROVE_PENDING_LABEL.approve_deploy);
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
      return;
    }
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
      const data = (await res.json()) as {
        duplicate?: boolean;
        retried?: boolean;
        event?: { toPhase?: string };
      };
      if (data.duplicate && !data.retried && !data.event) {
        alert(
          '该阶段此前已审批过，流程未前进。若刚从后期回退，请部署最新 orchestrator 后重试，或再次执行回退以清除审批记录。',
        );
      }
      await refreshLoop();
    } finally {
      setClientPending(null);
    }
  }

  async function retryLoopContextSync() {
    if (!user || busy || phase !== 'done') return;
    setClientPending('正在重试 .loop 知识库同步…');
    try {
      const res = await fetch(`${ORCHESTRATOR}/api/loops/${loopId}/loop-context/retry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.userId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.message ?? `重试失败 (${res.status})`);
        return;
      }
      const data = (await res.json()) as { started?: boolean; message?: string };
      if (data.started === false) {
        alert(data.message ?? '同步正在进行中');
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

  async function switchPhase() {
    if (!user || busy || !switchTargetPhase) return;
    const target = phaseSwitchTargets.find((t) => t.phase === switchTargetPhase);
    const label = target?.label ?? switchTargetPhase;
    const reason = prompt(`切换到「${label}」阶段的原因（必填）：`);
    if (!reason?.trim()) return;
    setClientPending('正在切换阶段…');
    try {
      const res = await fetch(`${ORCHESTRATOR}/api/loops/${loopId}/rollback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetPhase: switchTargetPhase,
          reason: reason.trim(),
          userId: user.userId,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.message ?? `切换阶段失败 (${res.status})`);
        return;
      }
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
        <div className="chat-loop-header">
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
            <Link href="/" style={{ color: '#8b949e', fontSize: 13, flexShrink: 0 }}>
              ← 首页
            </Link>
            <strong className="chat-loop-header__title" title={loopTitle || loopId}>
              {loopTitle || `Loop ${loopId.slice(0, 8)}…`}
            </strong>
          </div>
          <div className="chat-loop-header__meta">
            {loopCreatedAt ? (
              <span>创建于 {formatLoopCreatedAt(loopCreatedAt)}（UTC+8）</span>
            ) : (
              <span style={{ color: '#6e7681' }}>{loopId.slice(0, 8)}…</span>
            )}
          </div>
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
            {deployConfig?.executionMode === 'manual' ? ' · 人工部署' : ''}
            {phase === 'deployment' && deployConfig?.step === 'awaiting_mr_merge'
              ? ' · 待合并 MR'
              : ''}
            {phase === 'deployment' &&
            deployConfig?.step === 'awaiting_manual_test_deploy'
              ? ' · 待部署测试'
              : ''}
            {phase === 'deployment' && deployConfig?.step === 'awaiting_test_deploy'
              ? ' · 测试环境部署中'
              : ''}
            {phase === 'deployment' && deployConfig?.step === 'awaiting_test_approval'
              ? ' · 待测试审批'
              : ''}
            {phase === 'deployment' &&
            deployConfig?.step === 'awaiting_master_mr_merge'
              ? ' · 待合并上线 MR'
              : ''}
            {phase === 'deployment' &&
            deployConfig?.step === 'awaiting_manual_prod_verify'
              ? ' · 待验证生产'
              : ''}
            {phase === 'deployment' && deployConfig?.step === 'awaiting_prod_deploy'
              ? ' · 生产部署中'
              : ''}
            {phase === 'deployment' && deployConfig?.step === 'awaiting_prod_approval'
              ? ' · 待确认上线'
              : ''}
            {phase === 'deployment' && deployConfig?.step === 'awaiting_pipeline'
              ? ' · 待跑流水线'
              : ''}
            {phase === 'done' ? ' · 已完成' : ''}
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
          {phaseSwitchTargets.length > 0 && (
            <select
              value={switchTargetPhase}
              onChange={(e) => setSwitchTargetPhase(e.target.value)}
              title="仅可选择本 Loop 曾到达过的更早阶段"
              style={{
                background: '#21262d',
                color: '#e6edf3',
                border: '1px solid #30363d',
                borderRadius: 6,
                padding: '2px 6px',
                maxWidth: 140,
              }}
            >
              {phaseSwitchTargets.map((t) => (
                <option key={t.phase} value={t.phase}>
                  {t.label}（{t.phase}）
                </option>
              ))}
            </select>
          )}
          {phase === 'done' && (
            <button
              type="button"
              onClick={() => void retryLoopContextSync()}
              disabled={busy}
              title="重新调用大模型更新 .loop/ 四个文件并创建合并 MR"
              style={{
                padding: '4px 10px',
                borderRadius: 6,
                border: '1px solid #388bfd',
                background: '#0d2847',
                color: busy ? '#8b949e' : '#58a6ff',
                fontSize: 12,
                fontWeight: 600,
                cursor: busy ? 'not-allowed' : 'pointer',
                opacity: busy ? 0.6 : 1,
              }}
            >
              重试 .loop 同步
            </button>
          )}
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
          {phaseSwitchTargets.length > 0 && (
            <button
              type="button"
              onClick={() => void switchPhase()}
              disabled={busy || !switchTargetPhase}
              title="回退到已完成的更早阶段（不可向前跳转）"
              style={{
                padding: '4px 10px',
                borderRadius: 6,
                border: '1px solid #f85149',
                background: 'transparent',
                color: busy || !switchTargetPhase ? '#8b949e' : '#f85149',
                fontSize: 12,
                cursor: busy || !switchTargetPhase ? 'not-allowed' : 'pointer',
                opacity: busy ? 0.6 : 1,
              }}
            >
              确认切换阶段
            </button>
          )}
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
          ) : isMasterMrMergePending() ? (
            <div style={{ color: '#8b949e', marginTop: 8, fontSize: 13 }}>
              请在 Git 平台合并上线 MR 后，点击下方「部署操作」栏中的「上线 MR 已合并」。
            </div>
          ) : (
            <div style={{ marginTop: 8 }}>
              <div style={{ color: '#8b949e', fontSize: 13, marginBottom: 8 }}>
                {blocker.requestedBy === 'ops-agent' && isManualDeployMode()
                  ? '本 Loop 为人工部署模式，无需 Ops Agent 部署。点击「已解决」后请使用顶部「部署操作」继续。'
                  : blocker.requestedBy === 'ops-agent'
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
        isMasterMrMergePending() ||
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
            {isMasterMrMergePending() && deployConfig?.masterMergeRequest?.url && (
              <a
                href={deployConfig.masterMergeRequest.url}
                target="_blank"
                rel="noreferrer"
                style={{ color: '#58a6ff', fontSize: 13 }}
              >
                打开上线 MR #{deployConfig.masterMergeRequest.number}
              </a>
            )}
            {isMasterMrMergePending() && (
              <button
                type="button"
                onClick={() =>
                  canConfirmMasterMrMerged() && !busy && void handleAction('confirm_master_mr_merged')
                }
                disabled={!canConfirmMasterMrMerged() || busy}
                title={actionDisabledHint('confirm_master_mr_merged')}
                style={{
                  padding: '6px 14px',
                  borderRadius: 6,
                  border: `1px solid ${canConfirmMasterMrMerged() && !busy ? '#238636' : '#484f58'}`,
                  background: canConfirmMasterMrMerged() && !busy ? '#238636' : 'transparent',
                  color: canConfirmMasterMrMerged() && !busy ? '#fff' : '#8b949e',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: canConfirmMasterMrMerged() && !busy ? 'pointer' : 'not-allowed',
                }}
              >
                {clientPending === APPROVE_PENDING_LABEL.confirm_master_mr_merged
                  ? '处理中…'
                  : '上线 MR 已合并'}
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
                  {isManualDeployMode() ? '测试环境验证通过' : '测试通过，进入上线'}
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
                {deployConfig?.step === 'awaiting_manual_prod_verify'
                  ? '生产环境验证通过，完成 Loop'
                  : '确认正式上线完成'}
              </button>
            )}
          </div>
          {isManualDeployMode() && deployConfig?.step === 'awaiting_manual_test_deploy' && (
            <div style={{ marginTop: 8, fontSize: 12, color: '#8b949e' }}>
              请手动触发流水线部署测试环境，验证无误后再点击「测试环境验证通过」。
            </div>
          )}
        </div>
      )}

      <div ref={messageListRef} className="chat-msg-list">
        {groupChatMessages(messages).map((item, index, items) => {
          const prevItem = index > 0 ? items[index - 1] : undefined;
          const prevMessage =
            prevItem?.kind === 'message'
              ? prevItem.message
              : prevItem?.kind === 'process-log'
                ? prevItem.messages[prevItem.messages.length - 1]
                : undefined;

          if (item.kind === 'process-log') {
            return <ChatProcessLogGroup key={item.id} messages={item.messages} />;
          }

          const m = item.message;
          const mentionsYou = Boolean(user && messageMentionsUser(m, user.userId));
          const mentionUnread = pendingMentionIds.includes(m.id);

          return (
            <ChatMessageBubble
              key={m.id}
              message={m}
              prevMessage={prevMessage}
              currentUserId={user?.userId}
              mentionsYou={mentionsYou}
              mentionUnread={mentionUnread}
              renderActions={(msg) =>
                msg.content.actions
                  ?.filter((a) => shouldShowAction(a.action, msg as Message))
                  .map((a) => {
                    const clickable = isActionClickable(a.action);
                    const hint = actionDisabledHint(a.action);
                    return (
                      <div key={a.id} className="chat-action-row">
                        <button
                          type="button"
                          onClick={() => clickable && !busy && void handleAction(a.action)}
                          disabled={!clickable || busy}
                          title={hint}
                          style={{
                            padding: '6px 12px',
                            borderRadius: 6,
                            border: `1px solid ${clickable && !busy ? '#238636' : '#484f58'}`,
                            background: clickable && !busy ? '#238636' : 'transparent',
                            color: clickable && !busy ? '#fff' : '#8b949e',
                            cursor: clickable && !busy ? 'pointer' : 'not-allowed',
                            fontSize: 13,
                          }}
                        >
                          {clientPending && APPROVE_PENDING_LABEL[a.action] === clientPending
                            ? '处理中…'
                            : a.label}
                        </button>
                        {hint && (
                          <div style={{ fontSize: 12, color: '#8b949e', width: '100%' }}>
                            {hint}
                          </div>
                        )}
                      </div>
                    );
                  })
              }
            />
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
