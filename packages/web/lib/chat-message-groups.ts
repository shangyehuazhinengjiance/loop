import type { ChatMessageModel } from '../components/ChatMessageBubble';

export type ChatRenderItem =
  | { kind: 'message'; message: ChatMessageModel }
  | { kind: 'process-log'; messages: ChatMessageModel[]; id: string };

const AGENT_PROCESSING_BODY =
  /^(正在读取|修改文件|执行：|执行工具|正在调用|正在写入|正在提交|正在推送|正在创建)/;

function resolveSdkMessageType(message: ChatMessageModel): string | undefined {
  return (
    message.metadata?.sdkMessageType ?? message.content.sdkMessageType
  );
}

/** 可折叠的中间过程消息（工具调用、progress、system、Agent 执行日志） */
export function isIntermediateMessage(message: ChatMessageModel): boolean {
  if (message.content.actions?.length) return false;
  if (message.sender.type === 'system') return true;
  if (message.content.type === 'progress') return true;

  const sdk = resolveSdkMessageType(message);
  if (sdk) {
    if (sdk === 'result' || sdk === 'assistant') return false;
    if (sdk.startsWith('tool_use') || sdk.startsWith('tool:')) return true;
    if (sdk === 'tool_progress') return true;
  }

  if (
    message.sender.type === 'agent' &&
    message.sender.id !== 'orchestrator' &&
    message.content.type === 'text'
  ) {
    const body = message.content.body.trim();
    if (AGENT_PROCESSING_BODY.test(body)) return true;
    if (body.length < 200 && /^(glob|bash|read|write|edit)/i.test(body)) {
      return true;
    }
  }

  return false;
}

/** 连续中间过程消息合并为同 Agent 的一条折叠日志 */
export function groupChatMessages(messages: ChatMessageModel[]): ChatRenderItem[] {
  const items: ChatRenderItem[] = [];
  let buffer: ChatMessageModel[] = [];

  const flushBuffer = () => {
    if (buffer.length === 0) return;
    items.push({
      kind: 'process-log',
      messages: [...buffer],
      id: `process-${buffer[0]!.id}-${buffer.at(-1)!.id}`,
    });
    buffer = [];
  };

  for (const message of messages) {
    if (isIntermediateMessage(message)) {
      const prev = buffer[buffer.length - 1];
      if (
        prev &&
        prev.sender.id === message.sender.id &&
        isIntermediateMessage(prev)
      ) {
        buffer.push(message);
      } else {
        flushBuffer();
        buffer.push(message);
      }
      continue;
    }
    flushBuffer();
    items.push({ kind: 'message', message });
  }

  flushBuffer();
  return items;
}
