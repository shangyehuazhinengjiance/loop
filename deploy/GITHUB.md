# 从 GitLab 迁移到 GitHub 后，在本机更新 remote

```bash
git remote -v

# 将 origin 指向 GitHub（保留原有分支）
git remote set-url origin https://github.com/shangyehuazhinengjiance/loop.git

git fetch origin
git push -u origin master
git push -u origin test
```

## 服务器 / Jenkins 拉代码

无法访问内网 GitLab 时，在 CI 或服务器上使用 GitHub：

| 场景 | 配置 |
|------|------|
| **HTTPS** | `https://github.com/shangyehuazhinengjiance/loop.git` + Personal Access Token |
| **SSH** | `git@github.com:shangyehuazhinengjiance/loop.git` + 部署公钥 |

Jenkins：**Manage Jenkins → Credentials** 添加 GitHub PAT 或 SSH key，Job 里 Repository URL 填上述地址。

## 镜像构建与 K8s

镜像构建方式不变，仍从 GitHub checkout 后在**仓库根目录**执行：

```bash
docker build -f Dockerfile -t loop-orchestrator .
docker build -f Dockerfile.gateway -t loop-gateway .
docker build -f Dockerfile.web -t loop-web .
```

K8s 部署步骤见 [K8S.md](./K8S.md)。

## 定时同步到内网 GitLab

若 Jenkins 只能访问 GitLab，在能访问 GitHub 的机器上定时执行镜像同步：

```bash
./scripts/sync-github-to-gitlab.sh
```

配置与 cron 见 [../scripts/SYNC.md](../scripts/SYNC.md)。
