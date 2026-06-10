#!/usr/bin/env bash
# GitHub → GitLab 定时镜像同步
#
# 用法:
#   ./sync-github-to-gitlab.sh              # 使用同目录 sync.env
#   ./sync-github-to-gitlab.sh /path/sync.env
#
# 定时任务 (cron 每 10 分钟):
#   */10 * * * * /opt/loop/scripts/sync-github-to-gitlab.sh >> /var/log/loop-sync/cron.log 2>&1

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${1:-$SCRIPT_DIR/sync.env}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "错误: 找不到配置文件 $ENV_FILE"
  echo "请执行: cp $SCRIPT_DIR/sync.env.example $SCRIPT_DIR/sync.env"
  exit 1
fi

# shellcheck source=/dev/null
source "$ENV_FILE"

: "${GITHUB_REPO_URL:?GITHUB_REPO_URL 未设置}"
: "${GITLAB_REPO_URL:?GITLAB_REPO_URL 未设置}"
: "${SYNC_WORK_DIR:=/var/lib/loop-mirror}"
: "${SYNC_LOG_DIR:=/var/log/loop-sync}"
: "${SYNC_TAGS:=true}"

mkdir -p "$SYNC_LOG_DIR"
LOG_FILE="$SYNC_LOG_DIR/sync-$(date +%Y%m%d).log"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"
}

# 在 URL 中注入 Token（HTTPS）
url_with_token() {
  local url="$1"
  local token="$2"
  if [[ -z "$token" ]]; then
    echo "$url"
    return
  fi
  # https://host/path → https://oauth2:TOKEN@host/path
  echo "$url" | sed -E "s#^(https?://)#\1oauth2:${token}@#"
}

GITHUB_URL="$(url_with_token "$GITHUB_REPO_URL" "${GITHUB_TOKEN:-}")"
GITLAB_URL="$(url_with_token "$GITLAB_REPO_URL" "${GITLAB_TOKEN:-}")"

log "开始同步 GitHub → GitLab"
log "工作目录: $SYNC_WORK_DIR"

mkdir -p "$(dirname "$SYNC_WORK_DIR")"

if [[ ! -d "$SYNC_WORK_DIR/.git" ]]; then
  log "首次克隆 GitHub 仓库..."
  git clone --mirror "$GITHUB_URL" "$SYNC_WORK_DIR"
  cd "$SYNC_WORK_DIR"
  git remote add gitlab "$GITLAB_URL" 2>/dev/null || git remote set-url gitlab "$GITLAB_URL"
else
  cd "$SYNC_WORK_DIR"
  git remote set-url origin "$GITHUB_URL"
  git remote set-url gitlab "$GITLAB_URL" 2>/dev/null || git remote add gitlab "$GITLAB_URL"
  log "从 GitHub fetch..."
  git fetch origin --prune
fi

# 同步分支（mirror 裸仓库中分支位于 refs/heads/）
sync_branch() {
  local branch="$1"
  log "推送分支: $branch"
  git push gitlab "refs/heads/$branch:refs/heads/$branch" --force-with-lease \
    || log "警告: 分支 $branch 推送失败"
}

if [[ -n "${SYNC_BRANCHES:-}" ]]; then
  for branch in $SYNC_BRANCHES; do
    if git show-ref --verify --quiet "refs/heads/$branch"; then
      sync_branch "$branch"
    else
      log "跳过不存在的分支: $branch"
    fi
  done
else
  log "推送所有分支..."
  git push gitlab --all --force-with-lease \
    || log "警告: 部分分支推送失败"
fi

# 同步 tags
if [[ "$SYNC_TAGS" == "true" ]]; then
  log "推送 tags..."
  git push gitlab --tags --force-with-lease || log "警告: tags 推送失败"
fi

log "同步完成"
log "----------------------------------------"
