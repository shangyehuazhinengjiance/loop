import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { cancelRun, dispatchRun, type DispatchInput } from './dispatch.js';

dotenv.config({
  path: join(dirname(fileURLToPath(import.meta.url)), '../../../.env'),
});

const PORT = Number(process.env.AGENT_WORKER_PORT ?? 3010);
const running = new Set<string>();

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString('utf-8');
  return raw ? JSON.parse(raw) : {};
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

const server = createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    json(res, 200, { status: 'ok', running: [...running] });
    return;
  }

  if (req.method === 'POST' && req.url === '/internal/runs/start') {
    try {
      const body = (await readJson(req)) as DispatchInput;
      const key = `${body.loopId}:${body.runId}`;
      if (running.has(key)) {
        json(res, 409, { error: 'Run already executing' });
        return;
      }
      running.add(key);
      dispatchRun(body)
        .catch((err) => {
          console.error('[agent-worker] run failed', key, err);
        })
        .finally(() => running.delete(key));
      json(res, 202, { accepted: true, key });
    } catch (err) {
      json(res, 400, {
        error: err instanceof Error ? err.message : 'Invalid request',
      });
    }
    return;
  }

  if (req.method === 'POST' && req.url === '/internal/runs/cancel') {
    try {
      const body = (await readJson(req)) as { loopId: string; runId: string };
      cancelRun(body.loopId, body.runId);
      json(res, 200, { cancelled: true });
    } catch (err) {
      json(res, 400, {
        error: err instanceof Error ? err.message : 'Invalid request',
      });
    }
    return;
  }

  json(res, 404, { error: 'Not found' });
});

server.listen(PORT, () => {
  console.log(`Agent Worker listening on http://127.0.0.1:${PORT}`);
});
