# GitHub → GitLab 定时镜像同步 (Windows / PowerShell)
#
# 用法:
#   .\sync-github-to-gitlab.ps1
#   .\sync-github-to-gitlab.ps1 -EnvFile D:\loop\scripts\sync.env
#
# 计划任务: 每 10 分钟运行一次此脚本

param(
    [string]$EnvFile = (Join-Path $PSScriptRoot "sync.env")
)

$ErrorActionPreference = "Stop"

function Write-Log($msg) {
    $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $msg"
    Write-Host $line
    if ($script:LogFile) {
        Add-Content -Path $script:LogFile -Value $line
    }
}

function Get-UrlWithToken([string]$Url, [string]$Token) {
    if ([string]::IsNullOrWhiteSpace($Token)) { return $Url }
    if ($Url -match '^(https?://)(.+)$') {
        return "$($Matches[1])oauth2:$Token@$($Matches[2])"
    }
    return $Url
}

if (-not (Test-Path $EnvFile)) {
    Write-Error "找不到配置文件: $EnvFile`n请复制 sync.env.example 为 sync.env 并填写"
    exit 1
}

Get-Content $EnvFile | ForEach-Object {
    if ($_ -match '^\s*#' -or $_ -match '^\s*$') { return }
    if ($_ -match '^\s*([^=]+)=(.*)$') {
        $name = $Matches[1].Trim()
        $value = $Matches[2].Trim().Trim('"')
        Set-Item -Path "env:$name" -Value $value
    }
}

$GithubUrl = Get-UrlWithToken $env:GITHUB_REPO_URL $env:GITHUB_TOKEN
$GitlabUrl = Get-UrlWithToken $env:GITLAB_REPO_URL $env:GITLAB_TOKEN
$WorkDir = if ($env:SYNC_WORK_DIR) { $env:SYNC_WORK_DIR } else { "C:\loop-mirror" }
$LogDir = if ($env:SYNC_LOG_DIR) { $env:SYNC_LOG_DIR } else { "C:\loop-mirror\logs" }
$SyncTags = if ($env:SYNC_TAGS -eq "false") { $false } else { $true }
$Branches = if ($env:SYNC_BRANCHES) { $env:SYNC_BRANCHES -split '\s+' } else { @() }

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$script:LogFile = Join-Path $LogDir ("sync-{0:yyyyMMdd}.log" -f (Get-Date))

Write-Log "开始同步 GitHub → GitLab"
Write-Log "工作目录: $WorkDir"

if (-not (Test-Path (Join-Path $WorkDir ".git"))) {
    Write-Log "首次克隆 GitHub 仓库 (mirror)..."
    New-Item -ItemType Directory -Force -Path (Split-Path $WorkDir) | Out-Null
    git clone --mirror $GithubUrl $WorkDir
    Set-Location $WorkDir
    git remote add gitlab $GitlabUrl 2>$null
    if ($LASTEXITCODE -ne 0) { git remote set-url gitlab $GitlabUrl }
}
else {
    Set-Location $WorkDir
    git remote set-url origin $GithubUrl
    git remote set-url gitlab $GitlabUrl 2>$null
    if ($LASTEXITCODE -ne 0) { git remote add gitlab $GitlabUrl }
    Write-Log "从 GitHub fetch..."
    git fetch origin --prune
}

function Push-Branch([string]$Branch) {
    Write-Log "推送分支: $Branch"
    git push gitlab "refs/heads/${Branch}:refs/heads/${Branch}" --force-with-lease
    if ($LASTEXITCODE -ne 0) { Write-Log "警告: 分支 $Branch 推送失败" }
}

if ($Branches.Count -gt 0) {
    foreach ($b in $Branches) {
        $exists = git show-ref --verify --quiet "refs/heads/$b" 2>$null
        if ($LASTEXITCODE -eq 0) {
            Push-Branch $b
        }
        else {
            Write-Log "跳过不存在的分支: $b"
        }
    }
}
else {
    Write-Log "推送所有分支..."
    git push gitlab --all --force-with-lease
}

if ($SyncTags) {
    Write-Log "推送 tags..."
    git push gitlab --tags --force-with-lease
    if ($LASTEXITCODE -ne 0) { Write-Log "警告: tags 推送失败" }
}

Write-Log "同步完成"
Write-Log "----------------------------------------"
