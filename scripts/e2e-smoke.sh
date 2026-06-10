#!/usr/bin/env bash
set -euo pipefail

ORCHESTRATOR="${ORCHESTRATOR_URL:-http://localhost:3000}"

echo "==> 创建项目"
PROJECT=$(curl -sf -X POST "$ORCHESTRATOR/api/projects" \
  -H "Content-Type: application/json" \
  -d '{"name":"e2e"}')
PROJECT_ID=$(echo "$PROJECT" | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(0)).id)")

echo "==> 创建 Loop"
LOOP=$(curl -sf -X POST "$ORCHESTRATOR/api/projects/$PROJECT_ID/loops" \
  -H "Content-Type: application/json" \
  -d '{"title":"E2E 登录功能"}')
LOOP_ID=$(echo "$LOOP" | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(0)).id)")
echo "Loop ID: $LOOP_ID"

echo "==> 发送需求消息"
curl -sf -X POST "$ORCHESTRATOR/api/loops/$LOOP_ID/messages" \
  -H "Content-Type: application/json" \
  -d '{"body":"实现用户登录 API","userId":"e2e","displayName":"E2E"}' > /dev/null

echo "==> 查询 Loop 状态"
PHASE=$(curl -sf "$ORCHESTRATOR/api/loops/$LOOP_ID" | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(0)).phase)")
echo "Phase: $PHASE"

echo "E2E smoke done."
