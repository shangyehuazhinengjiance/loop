'use client';

import type { ReactNode } from 'react';
import { Avatar } from './Avatar';
import { MarkdownContent } from './MarkdownContent';
import {
  formatBubbleTimestamp,
  formatChatTimestamp,
  shouldShowTimeDivider,
} from '../lib/chat-time';

interface Action {
  id: string;
  label: string;
  action: string;
}

export interface ChatMessageModel {
  id: string;
  sender: { type: string; id: string; displayName: string };
  content: {
    type: string;
    body: string;
    actions?: Action[];
    mentions?: string[];
  };
  phase: string;
  metadata?: { timestamp?: string; sdkMessageType?: string };
}

interface ChatMessageBubbleProps {
  message: ChatMessageModel;
  prevMessage?: ChatMessageModel;
  currentUserId?: string;
  mentionsYou: boolean;
  mentionUnread: boolean;
  renderActions?: (message: ChatMessageModel) => ReactNode;
}

export function ChatMessageBubble({
  message: m,
  prevMessage,
  currentUserId,
  mentionsYou,
  mentionUnread,
  renderActions,
}: ChatMessageBubbleProps) {
  const isProgress = m.content.type === 'progress';
  const isSelf =
    m.sender.type === 'human' && Boolean(currentUserId && m.sender.id === currentUserId);
  const showTime = shouldShowTimeDivider(
    prevMessage?.metadata?.timestamp,
    m.metadata?.timestamp,
  );
  const timeLabel = formatChatTimestamp(m.metadata?.timestamp);
  const bubbleTime = formatBubbleTimestamp(m.metadata?.timestamp);

  const isSameSenderAsPrev =
    prevMessage &&
    prevMessage.sender.id === m.sender.id &&
    prevMessage.sender.type !== 'system' &&
    m.sender.type !== 'system' &&
    !showTime;

  if (isProgress) {
    return (
      <div id={`loop-msg-${m.id}`} className="chat-msg chat-msg--progress">
        {showTime && timeLabel && (
          <div className="chat-time-divider">{timeLabel}</div>
        )}
        <div className="chat-progress-card">
          <MarkdownContent content={m.content.body} variant="progress" />
        </div>
      </div>
    );
  }

  const markdownVariant = isSelf ? 'bubble-self' : 'bubble-other';

  return (
    <div
      id={`loop-msg-${m.id}`}
      className={`chat-msg ${isSelf ? 'chat-msg--self' : 'chat-msg--other'}`}
      style={{
        marginTop: isSameSenderAsPrev ? 4 : 12,
        scrollMarginTop: 80,
      }}
    >
      {showTime && timeLabel && (
        <div className="chat-time-divider">{timeLabel}</div>
      )}

      <div className={`chat-row ${isSelf ? 'chat-row--self' : 'chat-row--other'}`}>
        {!isSelf && (
          <Avatar
            displayName={m.sender.displayName}
            senderId={m.sender.id}
            senderType={m.sender.type}
          />
        )}

        <div className={`chat-col ${isSelf ? 'chat-col--self' : 'chat-col--other'}`}>
          {!isSelf && !isSameSenderAsPrev && (
            <div className="chat-sender-name">
              <span>{m.sender.displayName}</span>
              {mentionsYou && <span className="mention-you-pill">提及你</span>}
            </div>
          )}

          <div
            className={[
              'chat-bubble',
              isSelf ? 'chat-bubble--self' : 'chat-bubble--other',
              mentionsYou ? 'chat-bubble--mention' : '',
              mentionUnread ? 'chat-bubble--unread' : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            <MarkdownContent content={m.content.body} variant={markdownVariant} />
            {bubbleTime && (
              <div className="chat-bubble__time" aria-label={`发送于 ${bubbleTime}`}>
                {bubbleTime}
              </div>
            )}
          </div>

          {renderActions?.(m)}
        </div>

        {isSelf && (
          <Avatar
            displayName={m.sender.displayName}
            senderId={m.sender.id}
            senderType={m.sender.type}
          />
        )}
      </div>
    </div>
  );
}
