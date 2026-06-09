import type { ArtifactType, Phase } from '@loop/shared';
import { Injectable } from '@nestjs/common';
import { ArtifactRepository } from '../db/repositories/artifact.repository.js';
import { GitService } from '../git/git.service.js';

@Injectable()
export class ArtifactService {
  constructor(
    private readonly artifactRepo: ArtifactRepository,
    private readonly gitService: GitService,
  ) {}

  async save(input: {
    loopId: string;
    phase: Phase;
    type: ArtifactType;
    name: string;
    content: Record<string, unknown>;
    createdBy: string;
  }) {
    const row = await this.artifactRepo.create(input);
    return this.artifactRepo.toRecord(row);
  }

  async savePrd(
    loopId: string,
    phase: Phase,
    prd: { title: string; content: string; version: number },
    createdBy: string,
  ) {
    return this.save({
      loopId,
      phase,
      type: 'prd',
      name: prd.title || 'prd',
      content: prd,
      createdBy,
    });
  }

  async saveCodeDiff(
    loopId: string,
    phase: Phase,
    fromRef: string,
    toRef: string | undefined,
    createdBy: string,
  ) {
    const diff = await this.gitService.getDiff(loopId, fromRef, toRef);
    return this.save({
      loopId,
      phase,
      type: 'code_diff',
      name: `${fromRef}..${toRef ?? 'HEAD'}`,
      content: { fromRef, toRef, diff },
      createdBy,
    });
  }

  async list(loopId: string) {
    const rows = await this.artifactRepo.listByLoop(loopId);
    return rows.map((r) => this.artifactRepo.toRecord(r));
  }

  async getDiffBetweenVersions(artifactId: string, compareId: string) {
    const a = await this.artifactRepo.findById(artifactId);
    const b = await this.artifactRepo.findById(compareId);
    if (!a || !b) throw new Error('Artifact not found');

    const prevContent =
      typeof a.content.content === 'string'
        ? a.content.content
        : JSON.stringify(a.content);
    const nextContent =
      typeof b.content.content === 'string'
        ? b.content.content
        : JSON.stringify(b.content);

    return {
      from: this.artifactRepo.toRecord(a),
      to: this.artifactRepo.toRecord(b),
      diff: { prevContent, nextContent },
    };
  }
}
