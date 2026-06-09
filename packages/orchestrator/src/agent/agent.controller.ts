import { Controller, Get, Param, Post } from '@nestjs/common';
import type { AgentRole } from '@loop/shared';
import { AgentCoordinator } from './agent-coordinator.js';

@Controller('api/loops/:loopId/agents')
export class AgentController {
  constructor(private readonly coordinator: AgentCoordinator) {}

  @Post(':agent/activate')
  async activate(
    @Param('loopId') loopId: string,
    @Param('agent') agent: AgentRole,
  ) {
    await this.coordinator.activate(loopId, agent, { reason: 'manual' });
    return { status: 'activated', agent };
  }

  @Post(':agent/cancel')
  async cancel(
    @Param('loopId') loopId: string,
    @Param('agent') agent: AgentRole,
  ) {
    await this.coordinator.cancel(loopId, agent);
    return { status: 'cancelled', agent };
  }

  @Get(':agent/status')
  status(
    @Param('loopId') loopId: string,
    @Param('agent') agent: AgentRole,
  ) {
    return {
      agent,
      status: this.coordinator.getStatus(loopId, agent),
    };
  }
}
