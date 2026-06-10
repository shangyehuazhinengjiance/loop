import type { LoopMember } from './types.js';
import { suggestAssignee } from './members.js';

/** 失败通知时优先 @ 触发者，否则按专长匹配，最后回退万能成员 */
export function pickNotifyMember(
  members: LoopMember[],
  options?: { preferUserId?: string; skillsHint?: string },
): LoopMember | null {
  const prefer = options?.preferUserId?.trim();
  if (prefer) {
    const hit = members.find((m) => m.userId === prefer);
    if (hit) return hit;
  }
  return suggestAssignee(members, options?.skillsHint ?? '产品 PM 配置');
}

export function buildAgentFailureMessage(input: {
  agentLabel: string;
  reason: string;
  member: LoopMember | null;
  debug?: string;
  hints?: string[];
}): string {
  const lines = [`⚠️ **${input.agentLabel} 异常**`, input.reason];

  if (input.member) {
    lines.push(`请 @${input.member.userId}（${input.member.displayName}）协助排查。`);
  } else {
    lines.push('暂无已加入成员可 @，请先加入本 Loop。');
  }

  if (input.hints?.length) {
    lines.push('', '建议排查：', ...input.hints.map((h) => `- ${h}`));
  }

  if (input.debug?.trim()) {
    lines.push('', '```', input.debug.trim().slice(0, 2000), '```');
  }

  return lines.join('\n');
}

export function failureMentions(member: LoopMember | null): string[] | undefined {
  return member ? [`@${member.userId}`] : undefined;
}
