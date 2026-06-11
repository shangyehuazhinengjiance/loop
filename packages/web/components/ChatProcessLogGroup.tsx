'use client';

import { useState } from 'react';
import type { ChatMessageModel } from './ChatMessageBubble';
import { MarkdownContent } from './MarkdownContent';
import { formatBubbleTimestamp } from '../lib/chat-time';

interface ChatProcessLogGroupProps {
  messages: ChatMessageModel[];
}

function summarizeLine(body: string): string {
  const oneLine = body.replace(/\s+/g, ' ').trim();
  if (oneLine.length <= 120) return oneLine;
  return `${oneLine.slice(0, 120)}…`;
}

export function ChatProcessLogGroup({ messages }: ChatProcessLogGroupProps) {
  const [expanded, setExpanded] = useState(false);
  if (messages.length === 0) return null;

  const latest = messages[messages.length - 1]!;
  const summary = summarizeLine(latest.content.body);
  const timeLabel = formatBubbleTimestamp(latest.metadata?.timestamp);
  const senderLabel =
    latest.sender.type === 'system'
      ? '系统'
      : latest.sender.displayName || latest.sender.id;

  return (
    <div className="chat-process-log" id={`loop-msg-${messages[0]!.id}`}>
      <button
        type="button"
        className="chat-process-log__toggle"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <span className="chat-process-log__chevron">{expanded ? '▼' : '▶'}</span>
        <span className="chat-process-log__summary">
          <strong>{senderLabel}</strong>
          <span className="chat-process-log__status">
            {expanded
              ? `共 ${messages.length} 条执行记录`
              : messages.length > 1
                ? `${messages.length} 条 · ${summary || '执行中…'}`
                : summary || '执行中…'}
          </span>
        </span>
        {timeLabel && <span className="chat-process-log__time">{timeLabel}</span>}
      </button>

      {expanded && (
        <div className="chat-process-log__body">
          {messages.map((m) => (
            <div key={m.id} className="chat-process-log__line">
              <span className="chat-process-log__line-time">
                {formatBubbleTimestamp(m.metadata?.timestamp)}
              </span>
              <div className="chat-process-log__line-content">
                <MarkdownContent content={m.content.body} variant="progress" />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
