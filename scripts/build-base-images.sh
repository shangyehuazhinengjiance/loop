#!/usr/bin/env sh
# 构建并推送 4 个 Loop 基础镜像（在仓库根目录执行）
set -eu

REGISTRY="${REGISTRY:-harbor.qihoo.net/ai-native}"
TAG="${TAG:-latest}"

echo "REGISTRY=$REGISTRY TAG=$TAG"

build_one() {
  file="$1"
  name="$2"
  echo "==> $name"
  docker build -f "docker/base/$file" -t "${REGISTRY}/${name}:${TAG}" .
  docker push "${REGISTRY}/${name}:${TAG}"
}

build_one Dockerfile.monorepo-builder loop-base-monorepo-builder
build_one Dockerfile.orchestrator-runner loop-base-orchestrator-runner
build_one Dockerfile.gateway-runner loop-base-gateway-runner
build_one Dockerfile.web-builder loop-base-web-builder

echo "Done. 业务镜像构建时请设置: BASE_REGISTRY=$REGISTRY BASE_TAG=$TAG"
