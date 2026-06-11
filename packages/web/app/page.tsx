'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { ProcessingBanner } from '../components/ProcessingBanner';

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
  gitConfig?: { remoteUrl?: string; deploymentExecution?: 'manual' | 'agent' };
  createdAt: string;
  loops: LoopSummary[];
}

const CREATE_LOOP_PENDING =
  '正在创建 Loop（若已配置 Git 仓库，初始化可能需要 1–2 分钟）…';

export default function HomePage() {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const [title, setTitle] = useState('新功能 Loop');
  const [projectName, setProjectName] = useState('default');
  const [remoteUrl, setRemoteUrl] = useState('');
  const [defaultBranch, setDefaultBranch] = useState('main');
  const [deploymentExecution, setDeploymentExecution] = useState<'manual' | 'agent'>(
    'manual',
  );
  const [existingProjectId, setExistingProjectId] = useState('');
  const [loading, setLoading] = useState(false);
  const [creatingProjectId, setCreatingProjectId] = useState<string | null>(null);
  const [pendingMessage, setPendingMessage] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [inputRequirements, setInputRequirements] = useState('');
  const [quickCreate, setQuickCreate] = useState<{
    projectId: string;
    title: string;
    inputRequirements: string;
  } | null>(null);

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

  async function createLoopInProject(
    projectId: string,
    loopTitle: string,
    opts?: { fromForm?: boolean; inputRequirements?: string },
  ) {
    setLoading(true);
    if (!opts?.fromForm) setCreatingProjectId(projectId);
    setPendingMessage(CREATE_LOOP_PENDING);
    setError('');
    try {
      const loopRes = await fetch(
        `${ORCHESTRATOR}/api/projects/${projectId}/loops`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: loopTitle,
            ...(opts?.inputRequirements?.trim()
              ? { inputRequirements: opts.inputRequirements.trim() }
              : {}),
          }),
        },
      );
      if (!loopRes.ok) throw new Error(`创建 Loop 失败 ${loopRes.status}`);
      const loop = await loopRes.json();
      setPendingMessage('创建成功，正在进入群聊…');
      router.push(`/loop/${loop.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : '创建失败');
      setPendingMessage(null);
      setCreatingProjectId(null);
    } finally {
      setLoading(false);
    }
  }

  async function createProjectAndLoop() {
    setLoading(true);
    setPendingMessage(
      existingProjectId
        ? CREATE_LOOP_PENDING
        : '正在创建项目与 Loop（初始化可能需要 1–2 分钟）…',
    );
    setError('');
    try {
      if (existingProjectId) {
        await createLoopInProject(existingProjectId, title, {
          fromForm: true,
          inputRequirements,
        });
        return;
      }

      const gitConfig: Record<string, string> = {};
      if (remoteUrl.trim()) {
        gitConfig.remoteUrl = remoteUrl.trim();
        gitConfig.defaultBranch = defaultBranch.trim() || 'main';
        gitConfig.credentialRef = 'GIT_SSH_KEY_PATH';
        gitConfig.deploymentExecution = deploymentExecution;
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
      await createLoopInProject(project.id, title, {
        fromForm: true,
        inputRequirements,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : '创建失败');
      setPendingMessage(null);
    } finally {
      setLoading(false);
    }
  }

  const busy = loading || Boolean(pendingMessage);

  return (
    <>
      {pendingMessage && (
        <div
          role="dialog"
          aria-modal="true"
          aria-busy="true"
          aria-label={pendingMessage}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1000,
            background: 'rgba(1, 4, 9, 0.72)',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <ProcessingBanner label={pendingMessage} />
          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 24,
            }}
          >
            <div
              style={{
                maxWidth: 420,
                padding: '28px 32px',
                borderRadius: 12,
                border: '1px solid #30363d',
                background: '#161b22',
                textAlign: 'center',
                lineHeight: 1.6,
              }}
            >
              <p style={{ margin: '0 0 8px', fontSize: 16 }}>{pendingMessage}</p>
              <p style={{ margin: 0, fontSize: 13, color: '#8b949e' }}>
                请稍候，请勿关闭页面
              </p>
            </div>
          </div>
        </div>
      )}

      <main
        style={{
          maxWidth: 720,
          margin: '48px auto',
          padding: 24,
          opacity: busy ? 0.6 : 1,
          pointerEvents: busy ? 'none' : 'auto',
        }}
      >
      <h1 style={{ marginBottom: 8 }}>Loop</h1>
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
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button
                            type="button"
                            onClick={async () => {
                              if (!confirm('确定要删除该 Loop 吗？删除后不可恢复。')) return;
                              try {
                                const res = await fetch(`${ORCHESTRATOR}/api/loops/${loop.id}`, {
                                  method: 'DELETE',
                                });
                                if (!res.ok) throw new Error('删除失败');
                                alert('删除成功');
                                void loadProjects();
                              } catch (e) {
                                alert(e instanceof Error ? e.message : '删除失败');
                              }
                            }}
                            style={{
                              fontSize: 12,
                              padding: '4px 10px',
                              borderRadius: 6,
                              border: '1px solid #da3633',
                              color: '#da3633',
                              background: 'transparent',
                              cursor: 'pointer',
                            }}
                          >
                            删除
                          </button>
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
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    setQuickCreate({
                      projectId: project.id,
                      title: '新功能 Loop',
                      inputRequirements: '',
                    })
                  }
                  style={{
                    marginTop: 4,
                    padding: '6px 12px',
                    borderRadius: 6,
                    border: `1px solid ${creatingProjectId === project.id ? '#388bfd' : '#238636'}`,
                    background:
                      creatingProjectId === project.id ? '#132339' : 'transparent',
                    color: busy && creatingProjectId !== project.id ? '#8b949e' : '#3fb950',
                    fontSize: 13,
                    cursor: busy ? 'not-allowed' : 'pointer',
                    opacity: busy && creatingProjectId !== project.id ? 0.6 : 1,
                  }}
                >
                  {creatingProjectId === project.id
                    ? '创建中…'
                    : '+ 在此项目新建 Loop'}
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

            <label style={{ display: 'block', marginBottom: 8 }}>
              产品需求文档（可选，Markdown）
            </label>
            <p style={{ margin: '0 0 8px', fontSize: 12, color: '#8b949e' }}>
              若需求已在其他工具写好，可在此粘贴。创建后将保存到代码仓库，PM Agent
              进入 Loop 时会先阅读并说明理解。
            </p>
            <textarea
              value={inputRequirements}
              onChange={(e) => setInputRequirements(e.target.value)}
              placeholder="粘贴 PRD、需求说明、用户故事等…"
              rows={8}
              style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
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

                <label style={{ display: 'block', marginBottom: 8 }}>部署方式</label>
                <select
                  value={deploymentExecution}
                  onChange={(e) =>
                    setDeploymentExecution(e.target.value as 'manual' | 'agent')
                  }
                  style={{ ...inputStyle, marginBottom: 8 }}
                >
                  <option value="manual">人工部署（推荐：创建 MR + 通知，人合并/部署/验证）</option>
                  <option value="agent">Ops Agent 自动部署（需配置 K8s/流水线等）</option>
                </select>
                <p style={{ margin: '0 0 12px', fontSize: 12, color: '#8b949e' }}>
                  人工部署模式下 Ops Agent 只协助创建 MR，不会自动执行 kubectl 等部署操作。
                </p>
              </>
            )}

            <button
              type="button"
              onClick={() => void createProjectAndLoop()}
              disabled={busy}
              style={{
                padding: '10px 20px',
                borderRadius: 8,
                border: 'none',
                background: '#238636',
                color: '#fff',
                fontWeight: 600,
                opacity: busy ? 0.7 : 1,
                cursor: busy ? 'not-allowed' : 'pointer',
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

      {quickCreate && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="在此项目新建 Loop"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1001,
            background: 'rgba(1, 4, 9, 0.72)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
          }}
          onClick={() => !busy && setQuickCreate(null)}
        >
          <div
            style={{
              width: '100%',
              maxWidth: 520,
              padding: 20,
              borderRadius: 12,
              border: '1px solid #30363d',
              background: '#161b22',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: '0 0 16px', fontSize: 16 }}>在此项目新建 Loop</h3>
            <label style={{ display: 'block', marginBottom: 8 }}>Loop 标题</label>
            <input
              value={quickCreate.title}
              onChange={(e) =>
                setQuickCreate((q) => (q ? { ...q, title: e.target.value } : q))
              }
              style={inputStyle}
            />
            <label style={{ display: 'block', marginBottom: 8 }}>
              产品需求文档（可选）
            </label>
            <textarea
              value={quickCreate.inputRequirements}
              onChange={(e) =>
                setQuickCreate((q) =>
                  q ? { ...q, inputRequirements: e.target.value } : q,
                )
              }
              placeholder="粘贴外部需求文档…"
              rows={6}
              style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
            />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                type="button"
                disabled={busy}
                onClick={() => setQuickCreate(null)}
                style={{
                  padding: '8px 14px',
                  borderRadius: 8,
                  border: '1px solid #30363d',
                  background: 'transparent',
                  color: '#e6edf3',
                  cursor: busy ? 'not-allowed' : 'pointer',
                }}
              >
                取消
              </button>
              <button
                type="button"
                disabled={busy || !quickCreate.title.trim()}
                onClick={() => {
                  const { projectId, title: t, inputRequirements: req } = quickCreate;
                  setQuickCreate(null);
                  void createLoopInProject(projectId, t.trim(), {
                    inputRequirements: req,
                  });
                }}
                style={{
                  padding: '8px 14px',
                  borderRadius: 8,
                  border: 'none',
                  background: '#238636',
                  color: '#fff',
                  fontWeight: 600,
                  cursor: busy ? 'not-allowed' : 'pointer',
                  opacity: busy || !quickCreate.title.trim() ? 0.7 : 1,
                }}
              >
                创建并进入
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
