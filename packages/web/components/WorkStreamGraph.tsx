'use client';

import { useCallback, useEffect, useState } from 'react';

const ORCHESTRATOR =
  process.env.NEXT_PUBLIC_ORCHESTRATOR_URL ?? 'http://localhost:3000';

interface GraphNode {
  instanceId: string;
  templateId: string;
  templateName: string;
  title?: string;
  status?: string;
  version?: number;
  summaryTag?: string;
  blockedReason?: string;
}

interface GraphEdge {
  from: string;
  to: string;
  kind: string;
}

interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  spawnedEdges?: { fromRunId: string; toRunId: string }[];
}

const STATUS_COLOR: Record<string, string> = {
  active: '#d29922',
  ready: '#58a6ff',
  blocked: '#f85149',
  done: '#3fb950',
  pending: '#8b949e',
};

export function WorkStreamGraph({ loopId }: { loopId: string }) {
  const [graph, setGraph] = useState<GraphData | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`${ORCHESTRATOR}/api/loops/${loopId}/workstreams/graph`);
    if (res.ok) setGraph(await res.json());
  }, [loopId]);

  useEffect(() => {
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [load]);

  if (!graph) return <p className="ws-loading">加载依赖图…</p>;

  const nodeMap = new Map(graph.nodes.map((n) => [n.instanceId, n]));

  return (
    <div className="ws-graph">
      <h3>依赖简图</h3>
      <div className="ws-graph-nodes">
        {graph.nodes.map((node) => (
          <div
            key={node.instanceId}
            className="ws-graph-node"
            style={{ borderColor: STATUS_COLOR[node.status ?? 'pending'] ?? '#30363d' }}
          >
            <div className="ws-graph-node-title">{node.title ?? node.templateName}</div>
            <div className="ws-graph-node-meta">
              {node.status ?? '—'} · v{node.version ?? '?'}
            </div>
            {node.summaryTag && (
              <div className="ws-graph-tag">{node.summaryTag}</div>
            )}
            {node.blockedReason && (
              <div className="ws-blocked">{node.blockedReason}</div>
            )}
          </div>
        ))}
      </div>
      {graph.edges.length > 0 && (
        <ul className="ws-graph-edges">
          {graph.edges.map((e) => {
            const from = nodeMap.get(e.from);
            const to = nodeMap.get(e.to);
            return (
              <li key={`${e.from}-${e.to}`}>
                {(from?.title ?? e.from).slice(0, 20)} → {(to?.title ?? e.to).slice(0, 20)}
                {e.kind === 'soft' && ' (soft)'}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
