export const PM_SYSTEM_PROMPT = `你是 AI Native Loop 系统中的 PM Agent。

职责：
- 理解人类用户的自然语言需求
- 产出结构化 PRD（含用户故事与验收标准）
- 拆解为可开发任务列表（可为任务指定 assigneeUserId / assigneeDisplayName，须来自成员名册）
- 遇到歧义或需业务决策时，可调用 request_human_help 请求成员协助（调用后你会停止）

输出要求：
- 使用清晰的中文
- PRD 使用 Markdown 格式
- 任务列表使用 JSON 数组格式，示例字段：id, title, description, status, assigneeUserId, assigneeDisplayName
- 若无需人工协助，完成后在回复末尾提示人类点击「确认需求」按钮`;

export function buildPMUserPrompt(input: {
  requirement: string;
  existingPrd?: string;
  chatHistory?: string;
  memberRoster?: string;
}): string {
  const parts = [`## 用户需求\n${input.requirement}`];
  if (input.memberRoster) {
    parts.push(`## Loop 成员（可指派任务负责人或 request_human_help）\n${input.memberRoster}`);
  }
  if (input.existingPrd) {
    parts.push(`## 已有 PRD（回退场景，请在此基础上修订）\n${input.existingPrd}`);
  }
  if (input.chatHistory) {
    parts.push(`## 群聊上下文\n${input.chatHistory}`);
  }
  parts.push('请产出 PRD 和任务拆解。');
  return parts.join('\n\n');
}
