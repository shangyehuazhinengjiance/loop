import type { LoopMessage, Phase, ReplayResult } from '@loop/shared';
import { Injectable } from '@nestjs/common';
import { ArtifactRepository } from '../db/repositories/artifact.repository.js';
import { MessageRepository } from '../db/repositories/message.repository.js';
import { PhaseTransitionRepository } from '../db/repositories/phase-transition.repository.js';
import { toIso8601Utc } from '../db/datetime.js';
import { SnapshotRepository } from '../db/repositories/snapshot.repository.js';

@Injectable()
export class ReplayService {
  constructor(
    private readonly messageRepo: MessageRepository,
    private readonly snapshotRepo: SnapshotRepository,
    private readonly transitionRepo: PhaseTransitionRepository,
    private readonly artifactRepo: ArtifactRepository,
  ) {}

  async replay(input: {
    loopId: string;
    targetPhase?: Phase;
    snapshotId?: string;
  }): Promise<ReplayResult> {
    let watermark: string | undefined;
    let targetPhase = input.targetPhase ?? 'requirement';

    if (input.snapshotId) {
      const snap = await this.snapshotRepo.findById(input.snapshotId);
      if (snap) {
        watermark = snap.message_watermark ?? undefined;
        targetPhase = snap.phase;
      }
    } else if (input.targetPhase) {
      const snap = await this.snapshotRepo.findLatestByPhase(
        input.loopId,
        input.targetPhase,
      );
      watermark = snap?.message_watermark ?? undefined;
    }

    const allMessages = await this.messageRepo.listByLoop(input.loopId, 10_000);
    const messages = watermark
      ? this.filterUpToWatermark(allMessages, watermark)
      : allMessages.filter((m) => this.phaseOrder(m.phase) <= this.phaseOrder(targetPhase));

    const artifacts = (await this.artifactRepo.listByLoop(input.loopId))
      .filter((a) => this.phaseOrder(a.phase) <= this.phaseOrder(targetPhase))
      .map((r) => this.artifactRepo.toRecord(r));

    const transitions = await this.transitionRepo.listByLoop(input.loopId);

    return {
      loopId: input.loopId,
      targetPhase,
      snapshotId: input.snapshotId,
      messages: messages.map((row) =>
        this.messageRepo.toLoopMessage(row, row.sender_id),
      ),
      artifacts,
      phaseHistory: transitions.map((t) => ({
        id: t.id,
        loopId: t.loop_id,
        fromPhase: t.from_phase,
        toPhase: t.to_phase,
        trigger: t.trigger,
        snapshotId: t.snapshot_id ?? undefined,
        createdAt: toIso8601Utc(t.created_at),
      })),
    };
  }

  private filterUpToWatermark(
    messages: Awaited<ReturnType<MessageRepository['listByLoop']>>,
    watermark: string,
  ) {
    const idx = messages.findIndex((m) => m.id === watermark);
    if (idx === -1) return messages;
    return messages.slice(0, idx + 1);
  }

  private phaseOrder(phase: Phase): number {
    const order: Phase[] = [
      'created',
      'requirement',
      'development',
      'deployment',
      'done',
    ];
    return order.indexOf(phase);
  }
}
