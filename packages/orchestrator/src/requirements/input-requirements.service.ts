import {
  loopInputRequirementsRelPath,
  type InputRequirementsDocument,
  type LoopContext,
} from '@loop/shared';
import { Injectable } from '@nestjs/common';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { GitService } from '../git/git.service.js';
import { LoopRepository } from '../db/repositories/loop.repository.js';
import { ProjectRepository } from '../db/repositories/project.repository.js';
import { ChatService } from '../chat/chat.service.js';

@Injectable()
export class InputRequirementsService {
  constructor(
    private readonly loopRepo: LoopRepository,
    private readonly projectRepo: ProjectRepository,
    private readonly gitService: GitService,
    private readonly chatService: ChatService,
  ) {}

  /**
   * 创建 Loop 时：将用户粘贴的需求写入工作区并提交到 loop 分支。
   */
  async ingestOnCreate(input: {
    loopId: string;
    loopTitle: string;
    content: string;
    requirementsTitle?: string;
  }): Promise<InputRequirementsDocument | null> {
    const trimmed = input.content.trim();
    if (!trimmed) return null;

    const loop = await this.loopRepo.findById(input.loopId);
    if (!loop?.workspace_path) return null;

    const gitPath = loopInputRequirementsRelPath(input.loopId);
    const docTitle = input.requirementsTitle?.trim() || input.loopTitle;
    const absPath = join(loop.workspace_path, gitPath);

    const header = [
      '<!-- 由创建 Loop 时导入的外部需求文档，PM Agent 首轮将基于此熟悉需求 -->',
      `<!-- loop: ${input.loopId} -->`,
      `<!-- importedAt: ${new Date().toISOString()} -->`,
      '',
      `# ${docTitle}`,
      '',
    ].join('\n');

    await mkdir(join(loop.workspace_path, 'docs', 'loop', input.loopId), {
      recursive: true,
    });
    await writeFile(absPath, `${header}${trimmed}\n`, 'utf-8');

    let commitSha: string | undefined;
    const project = await this.projectRepo.findById(loop.project_id);
    const gitConfig = project?.git_config as { remoteUrl?: string } | undefined;

    try {
      const { commitSha: sha } = await this.gitService.commitWorkspace(
        input.loopId,
        `loop ${input.loopId}: import input requirements`,
      );
      commitSha = sha;
      if (gitConfig?.remoteUrl) {
        await this.gitService.pushLoopBranch(input.loopId);
      }
    } catch (err) {
      console.warn(`[input-requirements] git commit failed for ${input.loopId}:`, err);
    }

    const saved: InputRequirementsDocument = {
      title: docTitle,
      content: trimmed,
      source: 'create_form',
      savedAt: new Date().toISOString(),
      gitPath,
      commitSha,
    };

    const ctx: LoopContext = {
      ...loop.context,
      inputRequirements: saved,
    };
    await this.loopRepo.updateContext(input.loopId, ctx);

    const pushNote = gitConfig?.remoteUrl
      ? `已提交并推送到分支 \`${loop.git_branch ?? `loop/${input.loopId}`}\`。`
      : '已写入本地工作区（未配置远程仓库，未推送）。';

    await this.chatService.publishAgentMessage({
      loopId: input.loopId,
      phase: loop.phase,
      agentId: 'orchestrator',
      content: {
        type: 'text',
        body: [
          '## 外部需求文档已导入',
          '',
          `- 路径：\`${gitPath}\``,
          `- ${pushNote}`,
          '',
          'PM Agent 进入后将先阅读该文档并说明理解，再与您一起整理正式 PRD。',
        ].join('\n'),
      },
    });

    return saved;
  }
}
