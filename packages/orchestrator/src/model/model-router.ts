import type {
  AgentRole,
  Loop,
  ModelConfig,
  ProjectModelConfig,
  ResolvedModelConfig,
} from '@loop/shared';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

interface AgentsYaml {
  agents: Record<
    AgentRole,
    {
      provider: string;
      base_url?: string;
      model: string;
      fast_model?: string;
      api_key_env: string;
      runtime: 'client-sdk' | 'agent-sdk';
      max_tokens?: number;
      permission_mode?: string;
    }
  >;
}

function expandEnv(value: string): string {
  return value.replace(/\$\{(\w+)\}/g, (_, key: string) => process.env[key] ?? '');
}

/** 创建 Project 时占位符 `default` 表示使用 agents.yaml / 环境变量默认配置 */
function resolveConfigValue(
  override: string | undefined,
  project: string | undefined,
  yamlDefault: string | undefined,
): string {
  const raw = expandEnv(override ?? project ?? yamlDefault ?? '');
  if (!raw || raw === 'default') {
    return expandEnv(yamlDefault ?? '');
  }
  return raw;
}

export class ModelRouter {
  private defaults: AgentsYaml | null = null;

  loadDefaults(): AgentsYaml {
    if (!this.defaults) {
      const configPath = join(
        dirname(fileURLToPath(import.meta.url)),
        '../../../../config/agents.yaml',
      );
      const raw = readFileSync(configPath, 'utf-8');
      this.defaults = parseYaml(raw) as AgentsYaml;
    }
    return this.defaults;
  }

  resolve(
    projectModels: ProjectModelConfig | undefined,
    loopOverrides: Partial<ProjectModelConfig> | undefined,
    agent: AgentRole,
  ): ResolvedModelConfig {
    const defaults = this.loadDefaults().agents[agent];
    const project = projectModels?.[agent];
    const override = loopOverrides?.[agent];

    const merged: ModelConfig = {
      provider: (override?.provider ??
        project?.provider ??
        defaults.provider) as ModelConfig['provider'],
      baseUrl:
        resolveConfigValue(
          override?.baseUrl,
          project?.baseUrl,
          defaults.base_url,
        ) || undefined,
      model: resolveConfigValue(
        override?.model,
        project?.model,
        defaults.model,
      ),
      fastModel:
        resolveConfigValue(
          override?.fastModel,
          project?.fastModel,
          defaults.fast_model,
        ) || undefined,
      apiKeyRef:
        override?.apiKeyRef ?? project?.apiKeyRef ?? defaults.api_key_env,
      maxTokens:
        override?.maxTokens ?? project?.maxTokens ?? defaults.max_tokens,
    };

    const litellmUrl =
      process.env.LITELLM_PROXY_URL ??
      (merged.baseUrl?.includes('litellm') ? merged.baseUrl : undefined);

    const baseUrl = litellmUrl ?? merged.baseUrl;
    const apiKey =
      process.env[merged.apiKeyRef] ??
      process.env.LITELLM_API_KEY ??
      '';

    const runtime =
      defaults.runtime ??
      (agent === 'pm' ? 'client-sdk' : 'agent-sdk');

    const extra: Record<string, string> = {};
    if (baseUrl) extra.ANTHROPIC_BASE_URL = baseUrl;
    if (merged.model) extra.ANTHROPIC_MODEL = merged.model;
    if (merged.fastModel) extra.ANTHROPIC_DEFAULT_HAIKU_MODEL = merged.fastModel;
    if (apiKey) extra.ANTHROPIC_API_KEY = apiKey;

    return {
      provider: merged.provider,
      baseUrl,
      model: merged.model,
      fastModel: merged.fastModel,
      apiKey,
      runtime,
      extra,
      litellm: Boolean(litellmUrl),
    };
  }

  resolveForLoop(
    projectModels: ProjectModelConfig | undefined,
    loop: Pick<Loop, 'modelOverrides'>,
    agent: AgentRole,
  ): ResolvedModelConfig {
    return this.resolve(projectModels, loop.modelOverrides, agent);
  }
}
