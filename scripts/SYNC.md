# GitHub → GitLab 定时镜像同步

服务器无法直接访问 GitHub 时，可在**能访问 GitHub 的机器**上定时拉取，再推到内网 GitLab，供 Jenkins / K8s 使用。

```
GitHub (公网)  ──fetch──►  同步机 (本脚本)  ──push──►  GitLab (内网)
```

## 1. 准备 Token

| 平台 | Token 类型 | 权限 |
|------|------------|------|
| **GitHub** | Personal Access Token | `repo`（读私有库） |
| **GitLab** | PAT 或 Deploy Token | `write_repository` |

## 2. 配置文件

```bash
cd scripts
cp sync.env.example sync.env
chmod 600 sync.env   # Linux：限制权限
```

编辑 `sync.env`：

```bash
GITHUB_REPO_URL=https://github.com/shangyehuazhinengjiance/loop.git
GITHUB_TOKEN=ghp_xxxx

GITLAB_REPO_URL=https://code.geelib.qihoo.net:12443/ai-native/loop.git
GITLAB_TOKEN=glpat-xxxx

SYNC_WORK_DIR=/var/lib/loop-mirror
SYNC_BRANCHES="master test"
SYNC_TAGS=true
SYNC_LOG_DIR=/var/log/loop-sync
```

`sync.env` 已加入 `.gitignore`，勿提交。

## 3. 手动执行一次

**Linux：**

```bash
chmod +x scripts/sync-github-to-gitlab.sh
./scripts/sync-github-to-gitlab.sh
```

**Windows：**

```powershell
.\scripts\sync-github-to-gitlab.ps1
```

## 4. 配置定时任务

### Linux (cron)

```bash
sudo mkdir -p /var/log/loop-sync
sudo crontab -e
```

添加（每 10 分钟同步一次）：

```cron
*/10 * * * * /path/to/loop/scripts/sync-github-to-gitlab.sh >> /var/log/loop-sync/cron.log 2>&1
```

### Windows (计划任务)

```powershell
$action = New-ScheduledTaskAction -Execute "powershell.exe" `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File D:\loop\scripts\sync-github-to-gitlab.ps1"
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 10) -RepetitionDuration ([TimeSpan]::MaxValue)
Register-ScheduledTask -TaskName "Loop-GitHub-To-GitLab-Sync" -Action $action -Trigger $trigger -RunLevel Highest
```

## 5. Jenkins 侧

Jenkins Job 的 Git 源改为 **GitLab 内网地址**即可，无需改构建命令：

```
https://code.geelib.qihoo.net:12443/ai-native/loop.git
```

可配置 **Poll SCM** 或 **定时构建**，在同步脚本跑完之后触发。

## 6. 说明

- 使用 `git clone --mirror` + `git push --force-with-lease`，适合镜像同步。
- `SYNC_BRANCHES` 留空则推送所有分支；建议显式列出 `master test` 等常用分支。
- 首次运行会在 `SYNC_WORK_DIR` 创建裸仓库镜像。
- 日志按天写入 `SYNC_LOG_DIR/sync-YYYYMMDD.log`。

## 7. 故障排查

| 现象 | 处理 |
|------|------|
| GitHub 认证失败 | 检查 `GITHUB_TOKEN` 是否过期、是否有 repo 读权限 |
| GitLab 推送拒绝 | 检查 `GITLAB_TOKEN` 是否有 write 权限 |
| 分支不存在 | 确认 GitHub 上已有该分支，或调整 `SYNC_BRANCHES` |
| SSL 证书问题 | 内网 GitLab 自签证书时可临时 `git config http.sslVerify false`（仅同步机） |
