import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { runOpsAgent } from './run.js';

dotenv.config({
  path: join(dirname(fileURLToPath(import.meta.url)), '../../../../.env'),
});

const loopId = process.argv[2];
if (!loopId) {
  console.error('Usage: npm run dev -w @loop/agent-ops -- <loopId>');
  process.exit(1);
}

const orchestratorUrl =
  process.env.ORCHESTRATOR_URL ?? 'http://localhost:3000';

async function main() {
  const res = await fetch(`${orchestratorUrl}/api/loops/${loopId}`);
  const loop = await res.json();
  const workspacePath =
    loop.workspace_path ??
    join(process.env.WORKSPACE_ROOT ?? './workspaces', `loop-${loopId}`);

  await runOpsAgent({
    loopId,
    orchestratorUrl,
    workspacePath,
    phase: loop.phase,
    model: {
      provider: 'anthropic',
      baseUrl: process.env.OPS_MODEL_BASE_URL,
      model: process.env.OPS_MODEL_NAME ?? 'claude-sonnet-4-20250514',
      apiKey: process.env.OPS_MODEL_API_KEY ?? '',
      runtime: 'agent-sdk',
      extra: {
        ANTHROPIC_BASE_URL: process.env.OPS_MODEL_BASE_URL ?? '',
        ANTHROPIC_MODEL: process.env.OPS_MODEL_NAME ?? '',
      },
    },
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
