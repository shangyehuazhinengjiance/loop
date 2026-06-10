export interface UserIdentity {
  userId: string;
  displayName: string;
}

const ID_KEY = 'loop_user_id';
const NAME_KEY = 'loop_user_name';

export function loadUserIdentity(): UserIdentity | null {
  if (typeof window === 'undefined') return null;
  const userId = localStorage.getItem(ID_KEY);
  const displayName = localStorage.getItem(NAME_KEY);
  if (!userId || !displayName?.trim()) return null;
  return { userId, displayName: displayName.trim() };
}

/** 首次设置或更新昵称；userId 只在首次生成，之后保持不变 */
export function saveUserIdentity(displayName: string): UserIdentity {
  const trimmed = displayName.trim();
  if (!trimmed) {
    throw new Error('昵称不能为空');
  }

  let userId = localStorage.getItem(ID_KEY);
  if (!userId) {
    userId = `human-${crypto.randomUUID().slice(0, 8)}`;
    localStorage.setItem(ID_KEY, userId);
  }
  localStorage.setItem(NAME_KEY, trimmed);
  return { userId, displayName: trimmed };
}
