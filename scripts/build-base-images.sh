#!/usr/bin/env sh
# 构建并推送 4 个 Loop 基础镜像（在仓库根目录执行）
set -eu

REGISTRY="${REGISTRY:-harbor.qihoo.net/syhzqfw-sjxm-ai-native}"
TAG="${TAG:-latest}"
PLATFORM="${PLATFORM:-linux/amd64}"

echo "REGISTRY=$REGISTRY TAG=$TAG PLATFORM=$PLATFORM"

build_one() {
  dockerfile="$1"
  name="$2"
  echo "==> $name"
  docker build --platform "$PLATFORM" \
    -f "$dockerfile" \
    -t "${REGISTRY}/${name}:${TAG}" .
  docker push "${REGISTRY}/${name}:${TAG}"
}

build_one Dockerfile.base-monorepo-builder loop-base-monorepo-builder
build_one Dockerfile.base-orchestrator-runner loop-base-orchestrator-runner
build_one Dockerfile.base-gateway-runner loop-base-gateway-runner
build_one Dockerfile.base-web-builder loop-base-web-builder

echo "Done. 业务镜像构建时请设置: BASE_REGISTRY=$REGISTRY BASE_TAG=$TAG"
