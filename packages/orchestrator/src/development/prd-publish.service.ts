import type { LoopContext, PRDDocument, Task } from '@loop/shared';
import { Injectable } from '@nestjs/common';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { GitService } from '../git/git.service.js';
import { LoopRepository } from '../db/repositories/loop.repository.js';
import { ProjectRepository } from '../db/repositories/project.repository.js';

function formatTasks(tasks: Task[] | undefined): string {
  if (!tasks?.length) return '（暂无任务拆解）\n';
  return tasks
    .map(
      (t, i) =>
        `${i + 1}. **${t.title}** (${t.status})` +
        (t.assigneeDisplayName ? ` — @${t.assigneeUserId ?? t.assigneeDisplayName}` : '') +
        `\n   ${t.description}`,
    )
    .join('\n\n');
}

function buildHandoffMd(input: {
  loopId: string;
  loopTitle: string;
  branch: string;
  remoteUrl?: string;
  assigneeUserId: string;
  assigneeDisplayName: string;
}): string {
  return [
    '# 外部开发交接说明',
    '',
    `- Loop：\`${input.loopId}\`（${input.loopTitle}）`,
    `- 仓库：${input.remoteUrl ?? '（未配置远程）'}`,
    `- **开发分支**：\`${input.branch}\``,
    `- 负责人：@${input.assigneeUserId}（${input.assigneeDisplayName}）`,
    '',
    '## 步骤',
    '',
    '1. 拉取分支 `loop/' + input.loopId + '`',
    '2. 阅读同目录下 `PRD.md` 与 `tasks.md`',
    '3. 使用 Cursor / 本地 IDE 等完成开发并 **push 到上述分支**',
    '4. 回到 Loop 群聊，由负责人点击「开发完成，进入部署」',
    '',
    '> 本文件由 Loop Orchestrator 自动生成，请勿手动删除。',
  ].join('\n');
}

@Injectable()
export class PrdPublishService {
  constructor(
    private readonly loopRepo: LoopRepository,
    private readonly projectRepo: ProjectRepository,
    private readonly gitService: GitService,
  ) {}

  async publishForExternalDev(input: {
    loopId: string;
    assigneeUserId: string;
    assigneeDisplayName: string;
  }): Promise<{ commitSha: string; branch: string; remoteUrl?: string }> {
    const loop = await this.loopRepo.findById(input.loopId);
    if (!loop?.workspace_path) {
      throw new Error('工作区未初始化，无法发布 PRD');
    }

    const project = await this.projectRepo.findById(loop.project_id);
    const gitConfig = project?.git_config as { remoteUrl?: string } | undefined;
    const branch = loop.git_branch ?? `loop/${input.loopId}`;
    const docsDir = join(loop.workspace_path, 'docs', 'loop', input.loopId);

    await mkdir(docsDir, { recursive: true });

    const prd: PRDDocument | undefined = loop.context.prd;
    const prdBody = prd?.content?.trim()
      ? `# ${prd.title}\n\n${prd.content}`
      : '# PRD\n\n（PRD 内容为空，请回到 Loop 需求阶段补充。）';

    await writeFile(join(docsDir, 'PRD.md'), `${prdBody}\n`, 'utf-8');
    await writeFile(
      join(docsDir, 'tasks.md'),
      `# 任务拆解\n\n${formatTasks(loop.context.tasks)}`,
      'utf-8',
    );
    await writeFile(
      join(docsDir, 'HANDOFF.md'),
      buildHandoffMd({
        loopId: input.loopId,
        loopTitle: loop.title,
        branch,
        remoteUrl: gitConfig?.remoteUrl,
        assigneeUserId: input.assigneeUserId,
        assigneeDisplayName: input.assigneeDisplayName,
      }),
      'utf-8',
    );

    const { commitSha } = await this.gitService.commitWorkspace(
      input.loopId,
      `loop ${input.loopId}: publish PRD for external development`,
    );

    if (gitConfig?.remoteUrl) {
      await this.gitService.pushLoopBranch(input.loopId);
    }

    const ctx: LoopContext = {
      ...loop.context,
      gitRef: commitSha,
    };
    await this.loopRepo.updateContext(input.loopId, ctx);

    return { commitSha, branch, remoteUrl: gitConfig?.remoteUrl };
  }
}
