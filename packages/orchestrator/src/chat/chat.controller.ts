import { Controller, Param, Sse } from '@nestjs/common';
import { Observable } from 'rxjs';
import type { LoopMessage } from '@loop/shared';
import { ChatService, type LoopProcessingEvent } from './chat.service.js';

@Controller('api/loops/:loopId')
export class ChatSseController {
  constructor(private readonly chatService: ChatService) {}

  @Sse('events')
  stream(@Param('loopId') loopId: string): Observable<{ data: string }> {
    return new Observable((subscriber) => {
      const handler = (msg: LoopMessage) => {
        if (msg.loopId === loopId) {
          subscriber.next({
            data: JSON.stringify({ type: 'message', message: msg }),
          });
        }
      };

      const processingHandler = (event: LoopProcessingEvent) => {
        if (event.loopId === loopId) {
          subscriber.next({
            data: JSON.stringify({ type: 'processing', ...event }),
          });
        }
      };

      this.chatService.onMessage(handler);
      this.chatService.onProcessing(processingHandler);
      return () => {
        this.chatService.off('message', handler);
        this.chatService.off('processing', processingHandler);
      };
    });
  }
}
