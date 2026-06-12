'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ChatInput } from './ChatInput';
import { ChatMessageBubble, type ChatMessageModel } from './ChatMessageBubble';
import { LoopSidebar } from './LoopSidebar';
import { WorkStreamBoard } from './WorkStreamBoard';

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:3001';
const ORCHESTRATOR =
  process.env.NEXT_PUBLIC_ORCHESTRATOR_URL ?? 'http://localhost:3000';

interface Message {
  id: string;
  runId?: string;
  sender: { type: string; id: string; displayName: string };
  content: {
    type: string;
    body: string;
    actions?: { id: string; label: string; action: string; runId?: string }[];
    mentions?: string[];
  };
  createdAt: string;
}

const AGENT_LABELS: Record<string, string> = {
  'pm-agent': 'PM Agent',
  'dev-agent': 'Dev Agent',
  'ops-agent': 'Ops Agent',
};

function processingLabelFromEvent(data: {
  active?: boolean;
  label?: string;
  agent?: string;
}): string | null {
  if (!data.active) return null;
  if (data.label) return data.label;
  const name = data.agent ? (AGENT_LABELS[data.agent] ?? data.agent) : 'Agent';
  return `${name} 处理中…`;
}

function toChatModel(m: Message, index: number): ChatMessageModel {
  return {
    id: m.id || `local-${index}`,
    sender: m.sender,
    content: m.content,
    phase: 'requirement',
    metadata: { timestamp: m.createdAt },
  };
}

export function LoopWorkspaceV2({ loopId }: { loopId: string }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [body, setBody] = useState('');
  const [connected, setConnected] = useState(false);
  const [loopTitle, setLoopTitle] = useState('');
  const [processingLabel, setProcessingLabel] = useState<string | null>(null);
  const [sendError, setSendError] = useState('');
  const [boardTick, setBoardTick] = useState(0);
  const [actionPending, setActionPending] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const userId = 'user-local';
  const displayName = '本地用户';

  useEffect(() => {
    fetch(`${ORCHESTRATOR}/api/loops/${loopId}`)
      .then((r) => r.json())
      .then((d) => setLoopTitle(d.title ?? loopId))
      .catch(() => setLoopTitle(loopId));

    fetch(`${ORCHESTRATOR}/api/loops/${loopId}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, displayName }),
    }).catch(() => undefined);
  }, [loopId]);

  const appendMessage = useCallback((msg: Message) => {
    setMessages((prev) => {
      if (prev.some((m) => m.id === msg.id)) return prev;
      return [...prev, msg];
    });
  }, []);

  useEffect(() => {
    const ws = new WebSocket(`${WS_URL}/ws/loops/${loopId}`);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      setSendError('');
    };
    ws.onclose = () => setConnected(false);
    ws.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data as string) as
          | { type: 'history'; messages: Message[] }
          | { type: 'message'; message: Message }
          | { type: 'processing'; active?: boolean; label?: string; agent?: string }
          | { type: 'error'; message: string };
        if (data.type === 'history') {
          setMessages(data.messages);
        }
        if (data.type === 'message') {
          appendMessage(data.message);
        }
        if (data.type === 'processing') {
          setProcessingLabel(processingLabelFromEvent(data));
        }
        if (data.type === 'error') {
          setSendError(data.message);
        }
      } catch {
        // ignore
      }
    };

    return () => ws.close();
  }, [loopId, appendMessage]);

  const send = () => {
    const text = body.trim();
    if (!text || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      if (!connected) setSendError('未连接群聊网关，请检查 WebSocket 配置');
      return;
    }
    setSendError('');
    wsRef.current.send(
      JSON.stringify({ type: 'message', body: text, userId, displayName }),
    );
    setBody('');
  };

  const postAction = async (action: string, runId?: string) => {
    const key = `${action}:${runId ?? ''}`;
    setActionPending(key);
    setSendError('');
    try {
      const res = await fetch(`${ORCHESTRATOR}/api/loops/${loopId}/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, runId, userId, displayName }),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(detail || `HTTP ${res.status}`);
      }
      setProcessingLabel(null);
      setBoardTick((t) => t + 1);
    } catch (e) {
      setSendError(e instanceof Error ? e.message : '操作失败');
    } finally {
      setActionPending(null);
    }
  };

  const chatModels = messages.map(toChatModel);

  return (
    <div className="v2-layout">
      <header className="v2-header">
        <h1>{loopTitle}</h1>
        <span className={connected ? 'v2-online' : 'v2-offline'}>
          {connected ? '已连接' : '未连接'}
        </span>
      </header>

      <div className="v2-main-grid">
        <div className="v2-main-col">
          <WorkStreamBoard loopId={loopId} refreshTick={boardTick} />
          <section className="v2-chat">
            <div className="v2-chat-header">
              <h2>群聊</h2>
              {processingLabel && (
                <div className="v2-agent-processing" role="status" aria-live="polite">
                  <span className="v2-agent-processing-spinner" aria-hidden />
                  <span>{processingLabel}</span>
                </div>
              )}
            </div>
            <div className="v2-messages chat-msg-list">
              {chatModels.map((m, i) => (
                <ChatMessageBubble
                  key={m.id}
                  message={m}
                  prevMessage={i > 0 ? chatModels[i - 1] : undefined}
                  currentUserId={userId}
                  mentionsYou={false}
                  mentionUnread={false}
                  renderActions={
                    m.content.actions?.length
                      ? () => (
                          <>
                            {m.content.actions!.map((a) => {
                              const runId = a.runId ?? messages[i]?.runId;
                              const pending =
                                actionPending === `${a.action}:${runId ?? ''}`;
                              return (
                                <button
                                  key={a.id}
                                  type="button"
                                  className="v2-action-btn"
                                  disabled={pending || Boolean(actionPending)}
                                  onClick={() => postAction(a.action, runId)}
                                >
                                  {pending ? '处理中…' : a.label}
                                </button>
                              );
                            })}
                          </>
                        )
                      : undefined
                  }
                />
              ))}
            </div>
            <div className="v2-input">
              <ChatInput
                value={body}
                onChange={setBody}
                onSend={send}
                disabled={!connected}
              />
              <button type="button" className="v2-send-btn" onClick={send} disabled={!connected}>
                发送
              </button>
            </div>
            {sendError && <p className="ws-error">{sendError}</p>}
          </section>
        </div>
        <LoopSidebar loopId={loopId} />
      </div>
    </div>
  );
}
