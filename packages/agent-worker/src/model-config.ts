import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import type { AgentRole, ResolvedModelConfig } from '@loop/shared';

interface AgentYamlEntry {
  provider: string;
  base_url?: string;
  model: string;
  fast_model?: string;
  api_key_env: string;
  runtime: 'client-sdk' | 'agent-sdk';
  max_tokens?: number;
  permission_mode?: string;
}

interface AgentsYaml {
  agents: Record<AgentRole, AgentYamlEntry>;
}

let cachedDefaults: AgentsYaml | null = null;

function expandEnv(value: string): string {
  return value.replace(/\$\{(\w+)\}/g, (_, key: string) => process.env[key] ?? '');
}

function configPath(): string {
  const envPath = process.env.AGENTS_YAML_PATH?.trim();
  if (envPath) return envPath;
  return join(dirname(fileURLToPath(import.meta.url)), '../../../config/agents.yaml');
}

function loadDefaults(): AgentsYaml {
  if (!cachedDefaults) {
    const raw = readFileSync(configPath(), 'utf-8');
    cachedDefaults = parseYaml(raw) as AgentsYaml;
  }
  return cachedDefaults;
}

function resolveRuntime(agent: AgentRole, defaults: AgentYamlEntry, model: string): 'client-sdk' | 'agent-sdk' {
  const envKey =
    agent === 'pm' ? 'PM_AGENT_RUNTIME' : agent === 'dev' ? 'DEV_AGENT_RUNTIME' : 'OPS_AGENT_RUNTIME';
  const envRuntime = process.env[envKey]?.trim();
  if (envRuntime === 'client-sdk' || envRuntime === 'agent-sdk') {
    return envRuntime;
  }

  let runtime = defaults.runtime ?? (agent === 'pm' ? 'client-sdk' : 'agent-sdk');

  if (agent === 'dev' && (!defaults.runtime || defaults.runtime === 'agent-sdk')) {
    runtime = 'client-sdk';
  }

  if (!model.toLowerCase().includes('claude')) {
    runtime = 'client-sdk';
  }

  return runtime;
}

function resolveAgent(agent: AgentRole): ResolvedModelConfig {
  const defaults = loadDefaults().agents[agent];
  const baseUrlRaw = expandEnv(defaults.base_url ?? '');
  const model = expandEnv(defaults.model) || 'claude-sonnet-4-20250514';
  const fastModel = defaults.fast_model ? expandEnv(defaults.fast_model) : undefined;

  const litellmUrl =
    process.env.LITELLM_PROXY_URL?.trim() ||
    (baseUrlRaw.includes('litellm') ? baseUrlRaw : undefined);

  const baseUrl = litellmUrl || baseUrlRaw || undefined;
  const apiKey =
    process.env[defaults.api_key_env] ?? process.env.LITELLM_API_KEY ?? '';

  const runtime = resolveRuntime(agent, defaults, model);

  const extra: Record<string, string> = {};
  if (baseUrl) extra.ANTHROPIC_BASE_URL = baseUrl;
  if (model) extra.ANTHROPIC_MODEL = model;
  if (fastModel) extra.ANTHROPIC_DEFAULT_HAIKU_MODEL = fastModel;
  if (apiKey) extra.ANTHROPIC_API_KEY = apiKey;

  return {
    provider: defaults.provider,
    baseUrl,
    model,
    fastModel,
    apiKey,
    runtime,
    extra,
    litellm: Boolean(litellmUrl),
  };
}

export function resolvePmModel(): ResolvedModelConfig {
  return resolveAgent('pm');
}

export function resolveDevModel(): ResolvedModelConfig {
  return resolveAgent('dev');
}

export function resolveOpsModel(): ResolvedModelConfig {
  return resolveAgent('ops');
}
