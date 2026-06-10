'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';

const ORCHESTRATOR =
  process.env.NEXT_PUBLIC_ORCHESTRATOR_URL ?? 'http://localhost:3000';

const inputStyle: CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  borderRadius: 8,
  border: '1px solid #30363d',
  background: '#161b22',
  color: '#e6edf3',
  marginBottom: 12,
};

interface LoopSummary {
  id: string;
  title: string;
  phase: string;
  status: string;
  updatedAt: string;
}

interface ProjectSummary {
  id: string;
  name: string;
  gitConfig?: { remoteUrl?: string };
  createdAt: string;
  loops: LoopSummary[];
}

export default function HomePage() {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const [title, setTitle] = useState('新功能 Loop');
  const [projectName, setProjectName] = useState('default');
  const [remoteUrl, setRemoteUrl] = useState('');
  const [defaultBranch, setDefaultBranch] = useState('main');
  const [existingProjectId, setExistingProjectId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadProjects = useCallback(async () => {
    setLoadingList(true);
    try {
      const res = await fetch(`${ORCHESTRATOR}/api/projects?withLoops=1`);
      if (res.ok) {
        setProjects(await res.json());
      }
    } catch {
      // 列表加载失败不阻塞创建
    } finally {
      setLoadingList(false);
    }
  }, []);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  async function createLoopInProject(projectId: string, loopTitle: string) {
    setLoading(true);
    setError('');
    try {
      const loopRes = await fetch(
        `${ORCHESTRATOR}/api/projects/${projectId}/loops`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: loopTitle }),
        },
      );
      if (!loopRes.ok) throw new Error(`创建 Loop 失败 ${loopRes.status}`);
      const loop = await loopRes.json();
      router.push(`/loop/${loop.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : '创建失败');
    } finally {
      setLoading(false);
    }
  }

  async function createProjectAndLoop() {
    setLoading(true);
    setError('');
    try {
      if (existingProjectId) {
        await createLoopInProject(existingProjectId, title);
        return;
      }

      const gitConfig: Record<string, string> = {};
      if (remoteUrl.trim()) {
        gitConfig.remoteUrl = remoteUrl.trim();
        gitConfig.defaultBranch = defaultBranch.trim() || 'main';
        gitConfig.credentialRef = 'GIT_SSH_KEY_PATH';
      }

      const projectBody: Record<string, unknown> = {
        name: projectName.trim() || 'default',
      };
      if (Object.keys(gitConfig).length > 0) {
        projectBody.gitConfig = gitConfig;
      }

      const projectRes = await fetch(`${ORCHESTRATOR}/api/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(projectBody),
      });
      if (!projectRes.ok) {
        throw new Error(`创建项目失败 ${projectRes.status}`);
      }
      const project = await projectRes.json();
      await createLoopInProject(project.id, title);
    } catch (e) {
      setError(e instanceof Error ? e.message : '创建失败');
      setLoading(false);
    }
  }

  return (
    <main style={{ maxWidth: 720, margin: '48px auto', padding: 24 }}>
      <h1 style={{ marginBottom: 8 }}>AI Native Loop</h1>
      <p style={{ color: '#8b949e', marginBottom: 24 }}>
        群聊协作：PM → Dev → Ops 完整迭代
      </p>

      <section style={{ marginBottom: 32 }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 12,
          }}
        >
          <h2 style={{ fontSize: 16, margin: 0 }}>已有项目</h2>
          <button
            type="button"
            onClick={() => void loadProjects()}
            style={{
              padding: '4px 10px',
              borderRadius: 6,
              border: '1px solid #30363d',
              background: 'transparent',
              color: '#8b949e',
              fontSize: 12,
            }}
          >
            刷新
          </button>
        </div>

        {loadingList ? (
          <p style={{ color: '#8b949e' }}>加载中…</p>
        ) : projects.length === 0 ? (
          <p style={{ color: '#8b949e' }}>
            暂无项目，点击下方「新建项目 / Loop」开始。
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {projects.map((project) => (
              <div
                key={project.id}
                style={{
                  border: '1px solid #30363d',
                  borderRadius: 8,
                  padding: 14,
                  background: '#161b22',
                }}
              >
                <div style={{ marginBottom: 8 }}>
                  <strong>{project.name}</strong>
                  <span style={{ color: '#8b949e', fontSize: 12, marginLeft: 8 }}>
                    {project.id.slice(0, 8)}…
                  </span>
                </div>
                {project.gitConfig?.remoteUrl && (
                  <div
                    style={{
                      color: '#8b949e',
                      fontSize: 12,
                      marginBottom: 8,
                      wordBreak: 'break-all',
                    }}
                  >
                    {project.gitConfig.remoteUrl}
                  </div>
                )}
                {project.loops.length === 0 ? (
                  <p style={{ color: '#8b949e', fontSize: 13, margin: '8px 0' }}>
                    尚无 Loop
                  </p>
                ) : (
                  <ul style={{ listStyle: 'none', padding: 0, margin: '8px 0' }}>
                    {project.loops.map((loop) => (
                      <li
                        key={loop.id}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          padding: '8px 0',
                          borderTop: '1px solid #21262d',
                        }}
                      >
                        <div>
                          <Link
                            href={`/loop/${loop.id}`}
                            style={{ color: '#58a6ff', fontWeight: 500 }}
                          >
                            {loop.title}
                          </Link>
                          <span
                            style={{
                              marginLeft: 8,
                              fontSize: 12,
                              color: '#8b949e',
                            }}
                          >
                            {loop.phase} · {loop.status}
                          </span>
                        </div>
                        <Link
                          href={`/loop/${loop.id}`}
                          style={{
                            fontSize: 12,
                            padding: '4px 10px',
                            borderRadius: 6,
                            border: '1px solid #30363d',
                            color: '#e6edf3',
                          }}
                        >
                          进入群聊
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => {
                    const t = prompt('新 Loop 标题：', '新功能 Loop');
                    if (t) void createLoopInProject(project.id, t);
                  }}
                  style={{
                    marginTop: 4,
                    padding: '6px 12px',
                    borderRadius: 6,
                    border: '1px solid #238636',
                    background: 'transparent',
                    color: '#3fb950',
                    fontSize: 13,
                  }}
                >
                  + 在此项目新建 Loop
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <button
          type="button"
          onClick={() => setShowCreate((v) => !v)}
          style={{
            width: '100%',
            padding: '10px 14px',
            borderRadius: 8,
            border: '1px solid #30363d',
            background: '#21262d',
            color: '#e6edf3',
            fontWeight: 600,
            marginBottom: showCreate ? 16 : 0,
          }}
        >
          {showCreate ? '收起' : '新建项目 / Loop'}
        </button>

        {showCreate && (
          <div
            style={{
              border: '1px solid #30363d',
              borderRadius: 8,
              padding: 16,
              background: '#161b22',
            }}
          >
            <label style={{ display: 'block', marginBottom: 8 }}>
              加入已有项目（可选）
            </label>
            <select
              value={existingProjectId}
              onChange={(e) => setExistingProjectId(e.target.value)}
              style={{ ...inputStyle, marginBottom: 16 }}
            >
              <option value="">— 创建新项目 —</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.loops.length} 个 Loop)
                </option>
              ))}
            </select>

            <label style={{ display: 'block', marginBottom: 8 }}>Loop 标题</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              style={inputStyle}
            />

            {!existingProjectId && (
              <>
                <label style={{ display: 'block', marginBottom: 8 }}>项目名称</label>
                <input
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  placeholder="default"
                  style={inputStyle}
                />

                <label style={{ display: 'block', marginBottom: 8 }}>
                  代码仓库地址（Git SSH）
                </label>
                <input
                  value={remoteUrl}
                  onChange={(e) => setRemoteUrl(e.target.value)}
                  placeholder="git@github.com:org/repo.git（留空则用服务端默认）"
                  style={inputStyle}
                />

                <label style={{ display: 'block', marginBottom: 8 }}>默认分支</label>
                <input
                  value={defaultBranch}
                  onChange={(e) => setDefaultBranch(e.target.value)}
                  placeholder="main"
                  style={inputStyle}
                />
              </>
            )}

            <button
              type="button"
              onClick={() => void createProjectAndLoop()}
              disabled={loading}
              style={{
                padding: '10px 20px',
                borderRadius: 8,
                border: 'none',
                background: '#238636',
                color: '#fff',
                fontWeight: 600,
              }}
            >
              {loading
                ? '创建中…'
                : existingProjectId
                  ? '在已有项目中创建 Loop'
                  : '创建项目并进入群聊'}
            </button>
          </div>
        )}
      </section>

      {error && <p style={{ color: '#f85149', marginTop: 12 }}>{error}</p>}
    </main>
  );
}
