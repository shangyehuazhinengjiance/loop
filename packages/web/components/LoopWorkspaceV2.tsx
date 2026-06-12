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
  sender: { type: string; id: string; displayName: string };
  content: {
    type: string;
    body: string;
    actions?: { id: string; label: string; action: string; runId?: string }[];
    mentions?: string[];
  };
  createdAt: string;
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
  const [processing, setProcessing] = useState(false);
  const [sendError, setSendError] = useState('');
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
          | { type: 'processing'; active?: boolean }
          | { type: 'error'; message: string };
        if (data.type === 'history') {
          setMessages(data.messages);
        }
        if (data.type === 'message') {
          appendMessage(data.message);
        }
        if (data.type === 'processing') {
          setProcessing(Boolean(data.active));
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
    await fetch(`${ORCHESTRATOR}/api/loops/${loopId}/actions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, runId, userId, displayName }),
    });
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
          <WorkStreamBoard loopId={loopId} />
          {processing && <p className="v2-processing">Agent 处理中…</p>}
          <section className="v2-chat">
            <h2>群聊</h2>
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
                            {m.content.actions!.map((a) => (
                              <button
                                key={a.id}
                                type="button"
                                className="v2-action-btn"
                                onClick={() => postAction(a.action, a.runId)}
                              >
                                {a.label}
                              </button>
                            ))}
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
