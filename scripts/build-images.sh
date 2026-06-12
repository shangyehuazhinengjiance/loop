#!/usr/bin/env sh
# 构建 Loop v2 业务镜像（在仓库根目录执行）
# 用法:
#   ./scripts/build-images.sh
#   REGISTRY=harbor.example.com/ns TAG=20250612 ./scripts/build-images.sh
#   BUILD_V1=true ./scripts/build-images.sh   # 额外构建 v1 NestJS orchestrator（已废弃）
set -eu

REGISTRY="${REGISTRY:-}"
TAG="${TAG:-latest}"
PLATFORM="${PLATFORM:-linux/amd64}"
BUILD_V1="${BUILD_V1:-false}"

ORCH_URL="${NEXT_PUBLIC_ORCHESTRATOR_URL:-http://localhost:3000}"
WS_URL="${NEXT_PUBLIC_WS_URL:-ws://localhost:3001}"
BASE_REGISTRY="${BASE_REGISTRY:-harbor.qihoo.net/syhzqfw-sjxm-ai-native}"
BASE_TAG="${BASE_TAG:-latest}"

image_tag() {
  name="$1"
  if [ -n "$REGISTRY" ]; then
    printf '%s/loop-%s:%s' "$REGISTRY" "$name" "$TAG"
  else
    printf 'loop-%s:%s' "$name" "$TAG"
  fi
}

build_one() {
  dockerfile="$1"
  name="$2"
  shift 2
  tag="$(image_tag "$name")"
  echo "==> $tag"
  docker build --platform "$PLATFORM" \
    -f "$dockerfile" \
    "$@" \
    -t "$tag" \
    .
  echo "    OK $tag"
}

echo "TAG=$TAG REGISTRY=${REGISTRY:-<local>} PLATFORM=$PLATFORM BUILD_V1=$BUILD_V1"

build_one Dockerfile.orchestrator-v2 orchestrator-v2

build_one Dockerfile.agent-worker agent-worker \
  --build-arg "BASE_REGISTRY=$BASE_REGISTRY" \
  --build-arg "BASE_TAG=$BASE_TAG"

build_one Dockerfile.gateway gateway

build_one Dockerfile.web web \
  --build-arg "NEXT_PUBLIC_ORCHESTRATOR_URL=$ORCH_URL" \
  --build-arg "NEXT_PUBLIC_WS_URL=$WS_URL"

if [ "$BUILD_V1" = "true" ]; then
  echo "==> v1 loop-orchestrator (DEPRECATED)"
  build_one Dockerfile orchestrator \
    --build-arg "BASE_REGISTRY=$BASE_REGISTRY" \
    --build-arg "BASE_TAG=$BASE_TAG"
fi

echo "Done."
