import Link from 'next/link';
import { V1DeprecationBanner } from '@/components/V1DeprecationBanner';

/** v1 旧版首页（三阶段 Phase）；默认入口已迁至 /v2 */
export default function V1HomePage() {
  return (
    <main
      style={{
        maxWidth: 720,
        margin: '48px auto',
        padding: 24,
      }}
    >
      <V1DeprecationBanner />
      <h1 style={{ marginBottom: 8 }}>Loop v1（已废弃）</h1>
      <p style={{ color: '#8b949e', marginBottom: 24 }}>
        v1 使用固定三阶段（requirement → development → deployment），需 NestJS
        orchestrator 与 <code>loop</code> 数据库。新迭代请使用 v2 子任务流看板。
      </p>
      <p>
        <Link href="/v2" style={{ color: '#58a6ff', fontWeight: 600 }}>
          前往 v2 工作流看板 →
        </Link>
      </p>
      <p style={{ marginTop: 24, fontSize: 13, color: '#8b949e' }}>
        若你仍有 v1 Loop 链接（<code>/loop/:id</code>），在 v1 orchestrator
        运行时仍可打开；该路径将在 Phase C 移除。
      </p>
    </main>
  );
}
