import type { AgentRole, LoopMessage } from '@loop/shared';
import { Injectable } from '@nestjs/common';
import { EventEmitter } from 'node:events';
import { MessageRepository } from '../db/repositories/message.repository.js';

export interface LoopProcessingEvent {
  loopId: string;
  active: boolean;
  agent?: AgentRole;
  label?: string;
}

const DISPLAY_NAMES: Record<string, string> = {
  'pm-agent': 'PM Agent',
  'dev-agent': 'Dev Agent',
  'ops-agent': 'Ops Agent',
  orchestrator: '系统',
};

@Injectable()
export class ChatService extends EventEmitter {
  constructor(private readonly messageRepo: MessageRepository) {
    super();
  }

  async listMessages(
    loopId: string,
    limit?: number,
    before?: string,
  ): Promise<LoopMessage[]> {
    const rows = await this.messageRepo.listByLoop(loopId, limit, before);
    return rows.map((row) =>
      this.messageRepo.toLoopMessage(
        row,
        DISPLAY_NAMES[row.sender_id] ?? row.sender_id,
      ),
    );
  }

  async publishHumanMessage(input: {
    loopId: string;
    phase: LoopMessage['phase'];
    userId: string;
    displayName: string;
    body: string;
    mentions?: string[];
  }): Promise<LoopMessage> {
    const row = await this.messageRepo.create({
      loopId: input.loopId,
      phase: input.phase,
      senderType: 'human',
      senderId: input.userId,
      content: {
        type: 'text',
        body: input.body,
        mentions: input.mentions,
      },
    });

    const message = this.messageRepo.toLoopMessage(row, input.displayName);
    this.emit('message', message);
    return message;
  }

  async publishAgentMessage(input: {
    loopId: string;
    phase: LoopMessage['phase'];
    agentId: string;
    content: LoopMessage['content'];
    sdkMessageType?: string;
  }): Promise<LoopMessage> {
    const content: LoopMessage['content'] = {
      ...input.content,
      ...(input.sdkMessageType
        ? { sdkMessageType: input.sdkMessageType }
        : input.content.sdkMessageType
          ? { sdkMessageType: input.content.sdkMessageType }
          : {}),
    };
    const row = await this.messageRepo.create({
      loopId: input.loopId,
      phase: input.phase,
      senderType: 'agent',
      senderId: input.agentId,
      content,
    });

    const message = this.messageRepo.toLoopMessage(
      row,
      DISPLAY_NAMES[input.agentId] ?? input.agentId,
    );
    this.emit('message', message);
    return message;
  }

  onMessage(handler: (msg: LoopMessage) => void): void {
    this.on('message', handler);
  }

  emitProcessing(event: LoopProcessingEvent): void {
    this.emit('processing', event);
  }

  onProcessing(handler: (event: LoopProcessingEvent) => void): void {
    this.on('processing', handler);
  }

  async latestMessageId(loopId: string): Promise<string | null> {
    return this.messageRepo.latestId(loopId);
  }
}
