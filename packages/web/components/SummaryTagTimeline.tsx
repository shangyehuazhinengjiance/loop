'use client';

import { useCallback, useEffect, useState } from 'react';

const ORCHESTRATOR =
  process.env.NEXT_PUBLIC_ORCHESTRATOR_URL ?? 'http://localhost:3000';

interface TimelineItem {
  runId: string;
  templateName: string;
  version: number;
  status: string;
  summaryTag?: string;
  gitRef?: string;
  endedAt?: string;
}

export function SummaryTagTimeline({ loopId }: { loopId: string }) {
  const [items, setItems] = useState<TimelineItem[]>([]);

  const load = useCallback(async () => {
    const res = await fetch(`${ORCHESTRATOR}/api/loops/${loopId}/timeline`);
    if (res.ok) {
      const data = await res.json();
      setItems(data.items ?? []);
    }
  }, [loopId]);

  useEffect(() => {
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [load]);

  if (items.length === 0) {
    return (
      <div className="ws-timeline">
        <h3>Summary Tag 时间线</h3>
        <p className="ws-muted">暂无已完成的关键 Run</p>
      </div>
    );
  }

  return (
    <div className="ws-timeline">
      <h3>Summary Tag 时间线</h3>
      <ol className="ws-timeline-list">
        {items.map((item) => (
          <li key={item.runId} className="ws-timeline-item">
            <div className="ws-timeline-dot" data-status={item.status} />
            <div>
              <strong>{item.templateName}</strong> v{item.version}
              <span className="ws-timeline-status"> · {item.status}</span>
              {item.summaryTag && (
                <div className="ws-graph-tag">{item.summaryTag}</div>
              )}
              {item.gitRef && (
                <div className="ws-timeline-ref">{item.gitRef.slice(0, 8)}</div>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
