#!/usr/bin/env bash
# Loop 单机部署脚本
# 用法：
#   ./install.sh              # 首次初始化
#   ./deploy.sh build         # 仅构建镜像
#   ./deploy.sh migrate       # 执行数据库迁移
#   ./deploy.sh up            # 启动服务
#   ./deploy.sh down          # 停止服务
#   ./deploy.sh restart       # 重启
#   ./deploy.sh logs [svc]    # 查看日志
#   ./deploy.sh all           # build + migrate + up
#   ./deploy.sh all --local-db   # 含内置 MySQL
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

COMPOSE_FILE="docker-compose.yml"
COMPOSE_ARGS=(-f "$COMPOSE_FILE")
LOCAL_DB=false

for arg in "$@"; do
  if [[ "$arg" == "--local-db" ]]; then
    LOCAL_DB=true
    COMPOSE_ARGS+=(--profile local-db)
  fi
done

# 去掉 --local-db 后的子命令
ARGS=()
for arg in "$@"; do
  [[ "$arg" == "--local-db" ]] || ARGS+=("$arg")
done
CMD="${ARGS[0]:-help}"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

dc() {
  docker compose "${COMPOSE_ARGS[@]}" "$@"
}

require_env() {
  if [[ ! -f .env ]]; then
    echo "请先运行 ./install.sh 并配置 .env" >&2
    exit 1
  fi
}

wait_mysql() {
  if [[ "$LOCAL_DB" != true ]]; then
    return 0
  fi
  echo "==> 等待 MySQL 就绪…"
  for _ in $(seq 1 60); do
    if dc exec -T mysql mysqladmin ping -h 127.0.0.1 --silent 2>/dev/null; then
      echo "MySQL 已就绪"
      return 0
    fi
    sleep 2
  done
  echo "MySQL 启动超时" >&2
  exit 1
}

do_build() {
  require_env
  echo "==> 构建镜像（NEXT_PUBLIC_ORCHESTRATOR_URL=${NEXT_PUBLIC_ORCHESTRATOR_URL:-未设置}）"
  dc build --pull
}

do_migrate() {
  require_env
  wait_mysql
  echo "==> 执行数据库迁移"
  dc run --rm --no-deps orchestrator node dist/db/migrate.js
}

do_up() {
  require_env
  if [[ "$LOCAL_DB" == true ]]; then
    dc up -d mysql
    wait_mysql
  fi
  echo "==> 启动 Loop 服务"
  dc up -d orchestrator gateway web
  echo ""
  echo "服务已启动："
  echo "  Web UI:        http://127.0.0.1:${WEB_PUBLISH_PORT:-3002}"
  echo "  Orchestrator:  http://127.0.0.1:${ORCHESTRATOR_PUBLISH_PORT:-3000}"
  echo "  Gateway WS:    ws://127.0.0.1:${GATEWAY_PUBLISH_PORT:-3001}"
}

do_down() {
  dc down
}

do_restart() {
  dc restart orchestrator gateway web
}

do_logs() {
  local svc="${ARGS[1]:-}"
  if [[ -n "$svc" ]]; then
    dc logs -f --tail=200 "$svc"
  else
    dc logs -f --tail=100 orchestrator gateway web
  fi
}

do_all() {
  do_build
  if [[ "$LOCAL_DB" == true ]]; then
    dc up -d mysql
    wait_mysql
  fi
  do_migrate
  do_up
}

do_help() {
  cat <<'EOF'
Loop 单机部署

  ./install.sh                 首次初始化（创建 .env 与 data 目录）
  ./deploy.sh build            构建 Docker 镜像
  ./deploy.sh migrate          运行数据库迁移
  ./deploy.sh up               启动服务
  ./deploy.sh up --local-db    先启动内置 MySQL 再启动应用
  ./deploy.sh all              构建 + 迁移 + 启动
  ./deploy.sh all --local-db   使用内置 MySQL 的一键部署
  ./deploy.sh down             停止并移除容器
  ./deploy.sh restart          重启三个服务
  ./deploy.sh logs [服务名]    查看日志（orchestrator/gateway/web）

配置：编辑 deploy/server/.env
文档：deploy/SERVER.md
EOF
}

case "$CMD" in
  build) do_build ;;
  migrate) do_migrate ;;
  up) do_up ;;
  down) do_down ;;
  restart) do_restart ;;
  logs) do_logs ;;
  all) do_all ;;
  help|-h|--help|*) do_help ;;
esac
