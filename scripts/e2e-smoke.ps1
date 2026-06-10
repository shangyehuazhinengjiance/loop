# AI Native Loop E2E 冒烟测试
$Orchestrator = $env:ORCHESTRATOR_URL
if (-not $Orchestrator) { $Orchestrator = "http://localhost:3000" }

Write-Host "==> 创建项目"
$project = Invoke-RestMethod -Uri "$Orchestrator/api/projects" -Method Post `
  -ContentType "application/json" -Body '{"name":"e2e"}'

Write-Host "==> 创建 Loop"
$loop = Invoke-RestMethod -Uri "$Orchestrator/api/projects/$($project.id)/loops" -Method Post `
  -ContentType "application/json" -Body '{"title":"E2E 登录功能"}'

$loopId = $loop.id
Write-Host "Loop ID: $loopId"

Write-Host "==> 发送需求消息"
Invoke-RestMethod -Uri "$Orchestrator/api/loops/$loopId/messages" -Method Post `
  -ContentType "application/json" `
  -Body '{"body":"实现用户登录 API","userId":"e2e","displayName":"E2E"}'

Write-Host "==> 查询 Loop 状态"
$state = Invoke-RestMethod -Uri "$Orchestrator/api/loops/$loopId"
Write-Host "Phase: $($state.phase)"

Write-Host "==> 查询消息"
$messages = Invoke-RestMethod -Uri "$Orchestrator/api/loops/$loopId/messages"
Write-Host "Messages: $($messages.Count)"

Write-Host "==> 查询快照"
$snapshots = Invoke-RestMethod -Uri "$Orchestrator/api/loops/$loopId/snapshots"
Write-Host "Snapshots: $($snapshots.Count)"

Write-Host "E2E smoke done."
