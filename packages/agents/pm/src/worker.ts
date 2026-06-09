import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { runPmAgent } from './run.js';

dotenv.config({
  path: join(dirname(fileURLToPath(import.meta.url)), '../../../../.env'),
});

const loopId = process.argv[2];
if (!loopId) {
  console.error('Usage: npm run dev -w @loop/agent-pm -- <loopId>');
  process.exit(1);
}

const orchestratorUrl =
  process.env.ORCHESTRATOR_URL ?? 'http://localhost:3000';

runPmAgent({
  loopId,
  orchestratorUrl,
  model: {
    provider: 'anthropic',
    baseUrl: process.env.PM_MODEL_BASE_URL,
    model: process.env.PM_MODEL_NAME ?? 'claude-sonnet-4-20250514',
    apiKey: process.env.PM_MODEL_API_KEY ?? '',
    runtime: 'client-sdk',
  },
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
