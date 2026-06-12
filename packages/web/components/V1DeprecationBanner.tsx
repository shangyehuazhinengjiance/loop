'use client';

import Link from 'next/link';

/** v1 UI 废弃提示条 */
export function V1DeprecationBanner() {
  return (
    <div className="v1-deprecation-banner" role="status">
      <span>
        此为 <strong>v1 旧版</strong>界面（三阶段 Phase），已停止新功能开发。
      </span>
      <Link href="/v2">前往 v2 工作流看板 →</Link>
    </div>
  );
}
