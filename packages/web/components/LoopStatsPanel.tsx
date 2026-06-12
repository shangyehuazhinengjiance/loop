'use client';

import { useCallback, useEffect, useState } from 'react';

const ORCHESTRATOR =
  process.env.NEXT_PUBLIC_ORCHESTRATOR_URL ?? 'http://localhost:3000';

interface LoopStats {
  reopenCount: number;
  blockedCount: number;
  ownerMix: Record<string, number>;
  parallelActive: number;
  byTemplate: Record<string, { byStatus: Record<string, number> }>;
}

export function LoopStatsPanel({ loopId }: { loopId: string }) {
  const [stats, setStats] = useState<LoopStats | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(
      `${ORCHESTRATOR}/api/loops/${loopId}/workstreams/stats/detail`,
    );
    if (res.ok) setStats(await res.json());
  }, [loopId]);

  useEffect(() => {
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [load]);

  if (!stats) return <p className="ws-loading">加载统计…</p>;

  return (
    <div className="ws-stats-panel">
      <h3>Loop 统计</h3>
      <div className="ws-stats-grid">
        <div className="ws-stat-card">
          <span className="ws-stat-label">重开次数</span>
          <span className="ws-stat-value">{stats.reopenCount}</span>
        </div>
        <div className="ws-stat-card">
          <span className="ws-stat-label">阻塞次数</span>
          <span className="ws-stat-value">{stats.blockedCount}</span>
        </div>
        <div className="ws-stat-card">
          <span className="ws-stat-label">并行 active</span>
          <span className="ws-stat-value">{stats.parallelActive}</span>
        </div>
        <div className="ws-stat-card">
          <span className="ws-stat-label">Agent Run</span>
          <span className="ws-stat-value">{stats.ownerMix.agent ?? 0}</span>
        </div>
        <div className="ws-stat-card">
          <span className="ws-stat-label">Human Run</span>
          <span className="ws-stat-value">{stats.ownerMix.human ?? 0}</span>
        </div>
      </div>
      {Object.keys(stats.byTemplate).length > 0 && (
        <details className="ws-stats-detail">
          <summary>按模板</summary>
          <ul>
            {Object.entries(stats.byTemplate).map(([tid, v]) => (
              <li key={tid}>
                {tid}: {JSON.stringify(v.byStatus)}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
