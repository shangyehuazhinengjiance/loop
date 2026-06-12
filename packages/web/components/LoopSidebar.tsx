'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { LoopStatsPanel } from './LoopStatsPanel';
import { SummaryTagTimeline } from './SummaryTagTimeline';
import { WorkStreamGraph } from './WorkStreamGraph';

const ORCHESTRATOR =
  process.env.NEXT_PUBLIC_ORCHESTRATOR_URL ?? 'http://localhost:3000';

export function LoopSidebar({ loopId }: { loopId: string }) {
  const [tab, setTab] = useState<'graph' | 'timeline' | 'stats' | 'audit'>('graph');

  return (
    <aside className="v2-sidebar">
      <div className="v2-sidebar-tabs">
        {(
          [
            ['graph', '依赖'],
            ['timeline', 'Tag'],
            ['stats', '统计'],
            ['audit', '审计'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={tab === id ? 'active' : ''}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
        <Link href={`/v2/loop/${loopId}/replay`} className="v2-replay-link">
          回放
        </Link>
      </div>
      {tab === 'graph' && <WorkStreamGraph loopId={loopId} />}
      {tab === 'timeline' && <SummaryTagTimeline loopId={loopId} />}
      {tab === 'stats' && <LoopStatsPanel loopId={loopId} />}
      {tab === 'audit' && <AuditPanel loopId={loopId} />}
    </aside>
  );
}

function AuditPanel({ loopId }: { loopId: string }) {
  const [rows, setRows] = useState<
    { actor: string; action: string; createdAt: string }[]
  >([]);

  const load = useCallback(async () => {
    const res = await fetch(`${ORCHESTRATOR}/api/loops/${loopId}/audit`);
    if (res.ok) setRows(await res.json());
  }, [loopId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="ws-audit">
      <h3>审计日志</h3>
      <ul>
        {rows.slice(0, 30).map((r, i) => (
          <li key={`${r.createdAt}-${r.action}-${i}`}>
            <span className="ws-audit-time">
              {new Date(r.createdAt).toLocaleString()}
            </span>
            {r.actor}: {r.action}
          </li>
        ))}
      </ul>
    </div>
  );
}
