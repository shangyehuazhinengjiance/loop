import { loopRequirementUnderstandingRelPath } from '@loop/shared';
import { Injectable } from '@nestjs/common';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { LoopProgressService } from '../chat/loop-progress.service.js';
import { GitService } from '../git/git.service.js';
import { LoopRepository } from '../db/repositories/loop.repository.js';
import { ProjectRepository } from '../db/repositories/project.repository.js';

@Injectable()
export class PmUnderstandingService {
  constructor(
    private readonly loopRepo: LoopRepository,
    private readonly projectRepo: ProjectRepository,
    private readonly gitService: GitService,
    private readonly progress: LoopProgressService,
  ) {}

  /** PM 首轮理解纪要：写入工作区并 commit / push */
  async saveUnderstanding(loopId: string, content: string): Promise<string> {
    const loop = await this.loopRepo.findById(loopId);
    if (!loop?.workspace_path) {
      throw new Error('工作区未初始化');
    }

    const gitPath = loopRequirementUnderstandingRelPath(loopId);
    const absPath = join(loop.workspace_path, gitPath);
    const branch = loop.git_branch ?? `loop/${loopId}`;

    await this.progress.publish({
      loopId,
      phase: loop.phase,
      agentId: 'pm-agent',
      label: '正在写入需求理解纪要到代码仓库…',
      detail: `路径：\`${gitPath}\``,
    });

    await mkdir(join(loop.workspace_path, 'docs', 'loop', loopId), {
      recursive: true,
    });
    const header = [
      '<!-- PM Agent 首轮需求理解纪要，供团队评审与后续 PRD 对齐 -->',
      `<!-- loop: ${loopId} -->`,
      `<!-- savedAt: ${new Date().toISOString()} -->`,
      '',
      `# 需求理解纪要`,
      '',
    ].join('\n');
    await writeFile(absPath, `${header}${content.trim()}\n`, 'utf-8');

    const project = await this.projectRepo.findById(loop.project_id);
    const gitConfig = project?.git_config as { remoteUrl?: string } | undefined;

    await this.progress.publish({
      loopId,
      phase: loop.phase,
      agentId: 'pm-agent',
      label: '正在提交到 Git…',
      detail: `分支：\`${branch}\``,
    });

    const { commitSha } = await this.gitService.commitWorkspace(
      loopId,
      `loop ${loopId}: PM requirement understanding`,
    );

    if (gitConfig?.remoteUrl) {
      await this.progress.publish({
        loopId,
        phase: loop.phase,
        agentId: 'pm-agent',
        label: '正在推送到远端…',
        detail: `分支 \`${branch}\``,
      });
      await this.gitService.pushLoopBranch(loopId);
      await this.progress.publish({
        loopId,
        phase: loop.phase,
        agentId: 'pm-agent',
        label: '已推送到远端',
        detail: [
          `- 路径：\`${gitPath}\``,
          commitSha ? `- commit：\`${commitSha.slice(0, 7)}\`` : '',
        ]
          .filter(Boolean)
          .join('\n'),
        updateBanner: false,
      });
    } else {
      await this.progress.publish({
        loopId,
        phase: loop.phase,
        agentId: 'pm-agent',
        label: '已保存到本地工作区',
        detail: '未配置远程仓库，未推送。',
        updateBanner: false,
      });
    }

    return gitPath;
  }
}
