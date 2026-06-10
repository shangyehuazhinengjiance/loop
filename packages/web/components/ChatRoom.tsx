'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { loadUserIdentity, type UserIdentity } from '../lib/user-identity';
import { ChatInput } from './ChatInput';
import { MarkdownContent } from './MarkdownContent';
import { UserIdentityPrompt } from './UserIdentityPrompt';

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:3001';
const ORCHESTRATOR =
  process.env.NEXT_PUBLIC_ORCHESTRATOR_URL ?? 'http://localhost:3000';

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
  metadata?: { timestamp?: string };
}

export function ChatRoom({ loopId }: { loopId: string }) {
  const [user, setUser] = useState<UserIdentity | null>(null);
  const [identityLoaded, setIdentityLoaded] = useState(false);
  const [showRename, setShowRename] = useState(false);

  const [messages, setMessages] = useState<Message[]>([]);
  const [phase, setPhase] = useState('created');
  const [input, setInput] = useState('');
  const [connected, setConnected] = useState(false);
  const [rollbackPhase, setRollbackPhase] = useState('requirement');
  const wsRef = useRef<WebSocket | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setUser(loadUserIdentity());
    setIdentityLoaded(true);
  }, []);

  const refreshLoop = useCallback(async () => {
    const loop = await fetch(`${ORCHESTRATOR}/api/loops/${loopId}`).then((r) =>
      r.json(),
    );
    setPhase(loop.phase);
  }, [loopId]);

  const appendMessage = useCallback((msg: Message) => {
    setMessages((prev) => {
      if (prev.some((m) => m.id === msg.id)) return prev;
      return [...prev, msg];
    });
  }, []);

  useEffect(() => {
    if (!user) return;

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
        if (data.message.content?.type === 'phase_transition') {
          void refreshLoop();
        }
      }
    };

    return () => ws.close();
  }, [loopId, user, appendMessage, refreshLoop]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  function send() {
    if (!input.trim() || !wsRef.current || !user) return;
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

  async function approve(action: string) {
    if (!user) return;
    await fetch(`${ORCHESTRATOR}/api/loops/${loopId}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, approvedBy: user.userId }),
    });
    await refreshLoop();
  }

  async function rollback() {
    if (!user) return;
    const reason = prompt('回退原因：');
    if (!reason) return;
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
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
              background: '#21262d',
            }}
          >
            {phase}
          </span>
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
            style={{
              padding: '4px 10px',
              borderRadius: 6,
              border: '1px solid #f85149',
              background: 'transparent',
              color: '#f85149',
              fontSize: 12,
            }}
          >
            回退
          </button>
          <span style={{ color: connected ? '#3fb950' : '#f85149' }}>
            {connected ? '已连接' : '断开'}
          </span>
        </div>
      </header>

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
            {m.content.actions?.map((a) => (
              <button
                key={a.id}
                onClick={() => approve(a.action)}
                style={{
                  marginTop: 8,
                  marginRight: 8,
                  padding: '6px 12px',
                  borderRadius: 6,
                  border: '1px solid #238636',
                  background: 'transparent',
                  color: '#3fb950',
                }}
              >
                {a.label}
              </button>
            ))}
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
          disabled={!connected}
        />
        <button
          onClick={send}
          style={{
            padding: '10px 20px',
            borderRadius: 8,
            border: 'none',
            background: '#238636',
            color: '#fff',
          }}
        >
          发送
        </button>
      </div>
    </div>
  );
}
