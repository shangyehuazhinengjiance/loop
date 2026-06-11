import type { ChatMessageModel } from '../components/ChatMessageBubble';

export type ChatRenderItem =
  | { kind: 'message'; message: ChatMessageModel }
  | { kind: 'process-log'; messages: ChatMessageModel[]; id: string };

/** 可折叠的中间过程消息（工具调用、progress、system） */
export function isIntermediateMessage(message: ChatMessageModel): boolean {
  if (message.content.actions?.length) return false;
  if (message.sender.type === 'system') return true;
  if (message.content.type === 'progress') return true;

  const sdk = message.metadata?.sdkMessageType;
  if (!sdk) return false;
  if (sdk === 'result' || sdk === 'assistant') return false;
  if (sdk.startsWith('tool_use')) return true;
  if (sdk === 'tool_progress') return true;
  return false;
}

export function groupChatMessages(messages: ChatMessageModel[]): ChatRenderItem[] {
  const items: ChatRenderItem[] = [];
  let buffer: ChatMessageModel[] = [];

  const flushBuffer = () => {
    if (buffer.length === 0) return;
    if (buffer.length === 1) {
      items.push({ kind: 'message', message: buffer[0]! });
    } else {
      items.push({
        kind: 'process-log',
        messages: [...buffer],
        id: `process-${buffer[0]!.id}-${buffer.at(-1)!.id}`,
      });
    }
    buffer = [];
  };

  for (const message of messages) {
    if (isIntermediateMessage(message)) {
      buffer.push(message);
      continue;
    }
    flushBuffer();
    items.push({ kind: 'message', message });
  }

  flushBuffer();
  return items;
}
