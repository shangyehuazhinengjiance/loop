#!/usr/bin/env sh
# 统一启用 BuildKit 后执行 docker build（兼容 Docker 18.09+）
# 用法: ./scripts/docker-build.sh -f Dockerfile -t myimage:tag .
set -eu

if ! command -v docker >/dev/null 2>&1; then
  echo "docker not found" >&2
  exit 1
fi

export DOCKER_BUILDKIT=1

echo "Docker: $(docker version --format '{{.Server.Version}}' 2>/dev/null || docker version)"
echo "DOCKER_BUILDKIT=$DOCKER_BUILDKIT"
echo "docker build $*"

exec docker build "$@"
