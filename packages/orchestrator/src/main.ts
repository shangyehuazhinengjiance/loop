import 'reflect-metadata';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { AgentCoordinator } from './agent/agent-coordinator.js';
import { ChatService } from './chat/chat.service.js';

dotenv.config({
  path: join(dirname(fileURLToPath(import.meta.url)), '../../../.env'),
});

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { cors: true });
  const port = Number(process.env.ORCHESTRATOR_PORT ?? 3000);

  const coordinator = app.get(AgentCoordinator);
  const chat = app.get(ChatService);

  coordinator.on('agent:activate', (event) => {
    console.log('[agent:activate]', JSON.stringify(event));
  });

  chat.onMessage((msg) => {
    console.log('[chat:message]', msg.id, msg.sender.displayName);
  });

  await app.listen(port);
  console.log(`Orchestrator listening on http://localhost:${port}`);
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
