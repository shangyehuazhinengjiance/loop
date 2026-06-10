'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { loadUserIdentity, type UserIdentity } from '../lib/user-identity';
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
  approve_deploy: 'deployment',
};

const APPROVE_PENDING_LABEL: Record<string, string> = {
  approve_prd: '正在确认 PRD…',
  approve_dev: '正在提交开发验收…',
  approve_deploy: '正在确认流水线完成…',
};

interface Action {
  id: string;
  label: string;
  action: string;
}

interface Message {
  id: string;
  sender: { type: string; id: string; displayName: string };
  content: { type: string; body: string; actions?: Action[] };
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

  /** 展示审批按钮（含不可用态，避免「文案让点但按钮消失」） */
  function shouldShowAction(action: string, message: Message): boolean {
    if (action === 'approve_dev') {
      if (!message.content.actions?.some((a) => a.action === 'approve_dev')) {
        return false;
      }
      return isLatestDevApproveMessage(message);
    }
    if (!isActionAvailable(action)) return false;
    if (action === 'approve_prd') {
      return message.content.type === 'artifact';
    }
    if (action === 'approve_deploy') {
      if (message.content.type !== 'artifact') return false;
      const lastDeploy = [...messages]
        .reverse()
        .find((m) =>
          m.content.actions?.some((a) => a.action === 'approve_deploy'),
        );
      return lastDeploy?.id === message.id;
    }
    return true;
  }

  function isActionClickable(action: string): boolean {
    return isActionAvailable(action);
  }

  function actionDisabledHint(action: string): string | undefined {
    if (!isActionAvailable(action)) {
      const required = ACTION_REQUIRED_PHASE[action];
      if (required) {
        return `当前阶段为 ${phase}，需处于 ${required} 阶段。请使用顶部「回退」后再操作。`;
      }
    }
    return undefined;
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
          <button
            type="button"
            onClick={resolveBlocker}
            disabled={busy}
            style={{
              marginTop: 8,
              padding: '6px 12px',
              borderRadius: 6,
              border: '1px solid #9e6a03',
              background: '#238636',
              color: '#fff',
              fontSize: 13,
              cursor: busy ? 'not-allowed' : 'pointer',
              opacity: busy ? 0.7 : 1,
            }}
          >
            {clientPending === '正在解除阻塞…' ? '处理中…' : '已解决，解除阻塞'}
          </button>
        </div>
      )}

      <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
        {messages.map((m) => (
          <div key={m.id} style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, color: '#8b949e', marginBottom: 4 }}>
              {m.sender.displayName} · {m.phase}
              {m.content.type !== 'text' && ` · ${m.content.type}`}
            </div>
            <div
              style={{
                padding: '10px 14px',
                borderRadius: 8,
                background:
                  m.sender.type === 'human' && m.sender.id === user.userId
                    ? '#1a2332'
                    : m.sender.type === 'human'
                      ? '#161b22'
                      : '#1c2128',
                border:
                  m.sender.id === user.userId
                    ? '1px solid #388bfd66'
                    : '1px solid #30363d',
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
                      onClick={() => clickable && !busy && approve(a.action)}
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
        ))}
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
