import { createServer, type IncomingMessage } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { WebSocketServer, type WebSocket } from 'ws';
import type { LoopMessage } from '@loop/shared';
import { OrchestratorClient } from './orchestrator-client.js';

dotenv.config({
  path: join(dirname(fileURLToPath(import.meta.url)), '../../../.env'),
});

const ORCHESTRATOR_URL =
  process.env.ORCHESTRATOR_URL ?? 'http://localhost:3000';
const WS_PORT = Number(process.env.WS_PORT ?? 3001);

const client = new OrchestratorClient(ORCHESTRATOR_URL);

/** loopId → 连接的 WebSocket 客户端 */
const rooms = new Map<string, Set<WebSocket>>();

function parseLoopId(url: string | undefined): string | null {
  if (!url) return null;
  const match = url.match(/^\/ws\/loops\/([^/?]+)/);
  return match?.[1] ?? null;
}

function broadcast(loopId: string, payload: unknown) {
  const clients = rooms.get(loopId);
  if (!clients) return;
  const data = JSON.stringify(payload);
  for (const ws of clients) {
    if (ws.readyState === ws.OPEN) {
      ws.send(data);
    }
  }
}

const server = createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server });

wss.on('connection', async (ws, req: IncomingMessage) => {
  const loopId = parseLoopId(req.url);
  if (!loopId) {
    ws.close(4000, 'Invalid path. Use /ws/loops/:loopId');
    return;
  }

  if (!rooms.has(loopId)) {
    rooms.set(loopId, new Set());
  }
  rooms.get(loopId)!.add(ws);

  const subscribeOrchestratorEvents = () => {
    const es = new EventSource(
      `${ORCHESTRATOR_URL}/api/loops/${loopId}/events`,
    );
    es.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as { type: string; message?: LoopMessage };
        if (payload.type === 'message' && payload.message) {
          broadcast(loopId, payload);
        }
      } catch {
        // ignore malformed events
      }
    };
    es.onerror = () => es.close();
    ws.on('close', () => es.close());
  };

  try {
    const history = await client.getMessages(loopId);
    ws.send(JSON.stringify({ type: 'history', messages: history }));
    subscribeOrchestratorEvents();
  } catch (err) {
    ws.send(
      JSON.stringify({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to load history',
      }),
    );
  }

  ws.on('message', async (raw) => {
    try {
      const parsed = JSON.parse(raw.toString()) as {
        type: string;
        body?: string;
        userId?: string;
        displayName?: string;
        mentions?: string[];
      };

      if (parsed.type === 'message' && parsed.body) {
        await client.sendMessage(
          loopId,
          parsed.body,
          parsed.userId,
          parsed.displayName,
          parsed.mentions,
        );
        // 广播由 Orchestrator SSE → subscribeOrchestratorEvents 转发
      }
    } catch (err) {
      ws.send(
        JSON.stringify({
          type: 'error',
          message: err instanceof Error ? err.message : 'Invalid message',
        }),
      );
    }
  });

  ws.on('close', () => {
    rooms.get(loopId)?.delete(ws);
    if (rooms.get(loopId)?.size === 0) {
      rooms.delete(loopId);
    }
  });
});

server.listen(WS_PORT, () => {
  console.log(`Gateway WebSocket on ws://localhost:${WS_PORT}/ws/loops/:loopId`);
});
