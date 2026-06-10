import type { LoopMember } from '@loop/shared';
import { Injectable, NotFoundException } from '@nestjs/common';
import { LoopMemberRepository } from '../db/repositories/loop-member.repository.js';
import { LoopRepository } from '../db/repositories/loop.repository.js';

@Injectable()
export class LoopMemberService {
  constructor(
    private readonly memberRepo: LoopMemberRepository,
    private readonly loopRepo: LoopRepository,
  ) {}

  async join(input: {
    loopId: string;
    userId: string;
    displayName: string;
    bio?: string;
  }): Promise<LoopMember> {
    const loop = await this.loopRepo.findById(input.loopId);
    if (!loop) throw new NotFoundException('Loop not found');

    return this.memberRepo.upsert({
      loopId: input.loopId,
      userId: input.userId,
      displayName: input.displayName,
      bio: input.bio ?? '',
    });
  }

  async list(loopId: string): Promise<LoopMember[]> {
    return this.memberRepo.listByLoop(loopId);
  }

  async get(loopId: string, userId: string): Promise<LoopMember | null> {
    return this.memberRepo.find(loopId, userId);
  }

  async requireMember(loopId: string, userId: string): Promise<LoopMember> {
    const member = await this.memberRepo.find(loopId, userId);
    if (!member) {
      throw new NotFoundException('请先加入本 Loop 并填写成员信息');
    }
    return member;
  }
}
