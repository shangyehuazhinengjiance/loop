import { redirect } from 'next/navigation';

/** 默认入口：v2 工作流看板 */
export default function HomePage() {
  redirect('/v2');
}
