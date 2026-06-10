const REQUEST_HUMAN_HELP_INPUT_SCHEMA = {
  type: 'object' as const,
  properties: {
    assignee_user_id: {
      type: 'string' as const,
      description: '成员 userId；不确定时可省略并填 skills_hint',
    },
    skills_hint: {
      type: 'string' as const,
      description: '所需专长关键词，如 K8s、产品、MySQL（用于自动匹配成员）',
    },
    kind: {
      type: 'string' as const,
      enum: ['human_input', 'human_fix', 'human_decision', 'external'] as const,
    },
    reason: { type: 'string' as const },
    question: { type: 'string' as const },
  },
  required: ['kind', 'reason'],
};

/** OpenAI function-calling 格式的 request_human_help 工具定义 */
export const REQUEST_HUMAN_HELP_OPENAI_TOOL = {
  type: 'function' as const,
  function: {
    name: 'request_human_help',
    description:
      '请求 Loop 内已加入的某位成员协助。调用后当前 Agent 会停止，直到对方解除阻塞。',
    parameters: REQUEST_HUMAN_HELP_INPUT_SCHEMA,
  },
};

/** Anthropic tools 格式 */
export const REQUEST_HUMAN_HELP_ANTHROPIC_TOOL = {
  name: 'request_human_help',
  description: REQUEST_HUMAN_HELP_OPENAI_TOOL.function.description,
  input_schema: REQUEST_HUMAN_HELP_INPUT_SCHEMA,
};

export interface RequestHumanHelpArgs {
  assignee_user_id?: string;
  skills_hint?: string;
  kind: string;
  reason: string;
  question?: string;
}
