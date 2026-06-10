import type { LoopMember } from './types.js';

/**
 * 根据专长关键词匹配成员；无匹配时回退到 bio 为空的「万能」成员。
 */
export function suggestAssignee(
  members: LoopMember[],
  skillsHint?: string,
): LoopMember | null {
  if (members.length === 0) return null;

  const hint = skillsHint?.trim().toLowerCase();
  if (hint) {
    const tokens = hint.split(/[\s,，、/]+/).filter(Boolean);
    let best: { member: LoopMember; score: number } | null = null;
    for (const m of members) {
      const bio = m.bio.toLowerCase();
      if (!bio) continue;
      let score = 0;
      for (const t of tokens) {
        if (bio.includes(t)) score += 1;
      }
      if (score > 0 && (!best || score > best.score)) {
        best = { member: m, score };
      }
    }
    if (best) return best.member;
  }

  const catchAll = members.find((m) => !m.bio.trim());
  return catchAll ?? members[0] ?? null;
}

/** 格式化成员名册，供 Agent system prompt 注入 */
export function formatMemberRoster(members: LoopMember[]): string {
  if (members.length === 0) {
    return '（暂无已加入成员；需要人工协助时请说明，待有人加入后再 @）';
  }
  return members
    .map((m) => {
      const mention = `@${m.userId}`;
      const bio =
        m.bio.trim() ||
        '（未填写专长，各类问题均可联系）';
      return `- ${mention} ${m.displayName}：${bio}`;
    })
    .join('\n');
}
