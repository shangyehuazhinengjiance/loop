import { Controller, Param, Sse } from '@nestjs/common';
import { Observable } from 'rxjs';
import type { LoopMessage } from '@loop/shared';
import { ChatService } from './chat.service.js';

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

      this.chatService.onMessage(handler);
      return () => this.chatService.off('message', handler);
    });
  }
}
