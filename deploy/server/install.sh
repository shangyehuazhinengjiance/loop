#!/usr/bin/env bash
# 首次在服务器上初始化部署目录
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "==> Loop 单机部署初始化"

if ! command -v docker >/dev/null 2>&1; then
  echo "错误：未找到 docker，请先安装 Docker Engine。" >&2
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "错误：未找到 docker compose（v2），请安装 docker-compose-plugin。" >&2
  exit 1
fi

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "已创建 .env，请编辑 DATABASE_URL、API Key、NEXT_PUBLIC_* 等配置。"
else
  echo ".env 已存在，跳过复制。"
fi

mkdir -p data/workspaces data/git-secrets data/mysql

if [[ ! -f data/git-secrets/id_ed25519 ]] && [[ ! -f data/git-secrets/id_rsa ]]; then
  echo ""
  echo "提示：将 Git Deploy Key 放到 data/git-secrets/id_ed25519"
  echo "      chmod 600 data/git-secrets/id_ed25519"
fi

chmod +x deploy.sh 2>/dev/null || true

echo ""
echo "完成。下一步："
echo "  1. 编辑 deploy/server/.env"
echo "  2. ./deploy.sh all          # 构建并启动（使用外部 MySQL）"
echo "  或"
echo "     ./deploy.sh all --local-db   # 使用 compose 内置 MySQL"
