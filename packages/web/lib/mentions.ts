/** 消息是否 @ 了指定成员（不含自己发的） */
export function messageMentionsUser(
  msg: {
    sender: { id: string };
    content: { body: string; mentions?: string[] };
  },
  userId: string,
): boolean {
  if (!userId || msg.sender.id === userId) return false;
  const tag = `@${userId}`;
  if (msg.content.mentions?.some((m) => m === tag || m === userId)) return true;
  return msg.content.body.includes(tag);
}

export function mentionTag(userId: string): string {
  return `@${userId}`;
}
