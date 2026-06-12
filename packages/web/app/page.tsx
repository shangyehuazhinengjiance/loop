import { redirect } from 'next/navigation';

/** v2 为默认入口；v1 首页见 /v1 */
export default function HomePage() {
  redirect('/v2');
}
