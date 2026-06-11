const LOOP_ENTRY_INPUT_MAX_CHARS = parseInt(
  process.env.PM_LOOP_ENTRY_INPUT_MAX_CHARS ?? '12000',
  10,
);

function truncateForLoopEntry(text: string, gitPath?: string): string {
  if (text.length <= LOOP_ENTRY_INPUT_MAX_CHARS) return text;
  const head = text.slice(0, LOOP_ENTRY_INPUT_MAX_CHARS);
  const pathHint = gitPath ? `完整内容见仓库 \`${gitPath}\`。` : '完整内容见仓库路径。';
  return `${head}\n\n…（下文已截断，${pathHint}）`;
}

export const PM_SYSTEM_PROMPT = `你是 AI Native Loop 系统中的 PM Agent。

进入 Loop 时，编排器会从仓库 \`.loop/\` 目录加载项目知识库（README、DESIGN、HISTORY、MEMORY）供你阅读；勿重复生成长篇项目总结。

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
  loopDotLoopContext?: string;
  isLoopEntry?: boolean;
  inputRequirements?: {
    title: string;
    content: string;
    gitPath: string;
  };
}): string {
  const parts: string[] = [];

  if (input.loopDotLoopContext) {
    const ctx =
      input.isLoopEntry
        ? truncateForLoopEntry(input.loopDotLoopContext)
        : input.loopDotLoopContext;
    parts.push(
      `## 项目知识库（仓库 \`.loop/\` 目录，请先阅读并理解）\n${ctx}`,
    );
  } else {
    parts.push(
      '## 项目知识库（`.loop/`）\n（尚无 README / DESIGN / HISTORY / MEMORY，这是本项目的首个或早期 Loop。）',
    );
  }

  if (input.isLoopEntry) {
    if (input.inputRequirements) {
      parts.push(
        [
          '## 本回合导入的需求文档（创建 Loop 时由产品粘贴，已写入代码仓库）',
          `- 标题：${input.inputRequirements.title}`,
          `- 仓库路径：\`${input.inputRequirements.gitPath}\``,
          '',
          truncateForLoopEntry(
            input.inputRequirements.content,
            input.inputRequirements.gitPath,
          ),
        ].join('\n'),
      );
      parts.push(
        [
          '## 本回合任务（进入 Loop · 熟悉导入需求）',
          '',
          '成员刚进入本 Loop，且创建时已导入外部需求文档。你已阅读上方 **.loop 项目知识库** 全文，请：',
          '1. 说明导入文档已保存在上述 Git 路径（可引用路径，勿重复粘贴全文）',
          '2. 用 3–5 句话简要欢迎，**勿复述** .loop 文件中的项目介绍/架构/历史',
          '3. 若有与导入需求相关的待澄清问题，简要列出',
          '4. 邀请成员在群聊中补充、纠正或确认',
          '',
          '**勿**生成长篇理解纪要或项目总结；**暂不要**输出完整 PRD 或任务列表，也不要提示点击「确认需求」。',
        ].join('\n'),
      );
    } else {
      parts.push(
        [
          '## 本回合任务（进入 Loop）',
          '',
          '你正在欢迎成员进入本 Loop。你已阅读上方 **.loop 项目知识库** 全文，请：',
          '1. 用 3–5 句话简短欢迎，**勿复述** README / DESIGN / HISTORY / MEMORY 的原文',
          '2. 简要说明本 Loop 当前处于需求收集阶段',
          '3. 邀请用户在群聊中描述**本 Loop 要做的事**',
          '',
          '**勿**生成长篇理解纪要或项目总结；**暂不要**输出完整 PRD 或任务列表，也不要提示点击「确认需求」。',
        ].join('\n'),
      );
    }
    return parts.join('\n\n');
  }

  if (input.inputRequirements) {
    parts.push(
      [
        '## 创建时导入的需求文档（整理 PRD 时请作为首要依据）',
        `- 仓库路径：\`${input.inputRequirements.gitPath}\``,
        '',
        input.inputRequirements.content,
      ].join('\n'),
    );
  }

  parts.push(`## 用户需求\n${input.requirement}`);
  if (input.memberRoster) {
    parts.push(`## Loop 成员（可指派任务负责人或 request_human_help）\n${input.memberRoster}`);
  }
  if (input.existingPrd) {
    parts.push(`## 已有 PRD（回退场景，请在此基础上修订）\n${input.existingPrd}`);
  }
  if (input.chatHistory) {
    parts.push(`## 群聊上下文\n${input.chatHistory}`);
  }
  parts.push(
    input.inputRequirements
      ? '请结合 **.loop 项目知识库**、**导入需求文档**与群聊中的用户补充，产出 PRD 和任务拆解。'
      : '请结合 **.loop 项目知识库**与用户需求，产出 PRD 和任务拆解。',
  );
  return parts.join('\n\n');
}
