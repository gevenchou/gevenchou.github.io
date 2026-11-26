# 一键发布：构建 → 提交 → 推送
# 用法：
#   .\publish.ps1                  （自动生成提交说明）
#   .\publish.ps1 "新文章：第一场雪"

$ErrorActionPreference = 'Stop'

$siteRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$gitExe = Join-Path $siteRoot ".tools\git\cmd\git.exe"
$gitHome = Join-Path $siteRoot ".tools\home"

if (-not (Test-Path $gitExe)) {
  Write-Host "找不到便携版 git：$gitExe" -ForegroundColor Red
  Write-Host "请确认 .tools 目录还在（它不在仓库里，换电脑要重新下载）。" -ForegroundColor Yellow
  exit 1
}

$env:HOME = $gitHome

$message = if ($args.Count -gt 0) { $args -join " " } else { "更新内容 " + (Get-Date -Format "yyyy-MM-dd HH:mm") }

Write-Host "`n[1/3] 构建站点..." -ForegroundColor Cyan
& node (Join-Path $siteRoot "build.mjs")
if ($LASTEXITCODE -ne 0) { Write-Host "构建失败，已中止。" -ForegroundColor Red; exit 1 }

Write-Host "`n[2/3] 提交改动..." -ForegroundColor Cyan
& $gitExe -C $siteRoot add -A
$pending = & $gitExe -C $siteRoot status --porcelain
if (-not $pending) {
  Write-Host "没有需要提交的改动。" -ForegroundColor Yellow
} else {
  & $gitExe -C $siteRoot commit -m $message | Out-Host
}

Write-Host "`n[3/3] 推送到 GitHub..." -ForegroundColor Cyan

# 国内到 GitHub 的 SSH 有时会抽风，22 和 443 轮流试一遍
$sshExe  = "C:/Windows/System32/OpenSSH/ssh.exe"
$keyPath = (Join-Path $gitHome ".ssh\id_ed25519") -replace '\\', '/'
$khPath  = (Join-Path $gitHome ".ssh\known_hosts") -replace '\\', '/'
$sshBase = "$sshExe -i $keyPath -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=$khPath"

function Try-Push([string]$label, [string]$sshCommand) {
  Write-Host "  尝试 $label ..." -ForegroundColor DarkGray
  if ($sshCommand) {
    & $gitExe -C $siteRoot -c "core.sshCommand=$sshCommand" push 2>&1 | Out-Host
  } else {
    & $gitExe -C $siteRoot push 2>&1 | Out-Host
  }
  return ($LASTEXITCODE -eq 0)
}

$pushed = (Try-Push "默认端口 22" $null) -or
          (Try-Push "备用端口 443" "$sshBase -p 443 -o HostName=ssh.github.com")

if (-not $pushed) {
  Write-Host "`n推送失败。可能是：①网络到 GitHub 不通（等一下再试）②公钥没加到 GitHub ③仓库名不对。" -ForegroundColor Red
  Write-Host "改动已经提交在本地，网络恢复后再跑一次这个脚本就行。" -ForegroundColor Yellow
  exit 1
}

Write-Host "`n发布完成。GitHub 会自动构建，约一分钟后访问：" -ForegroundColor Green
Write-Host "  https://gevenchou.github.io" -ForegroundColor Green
Write-Host "构建状态可在仓库的 Actions 标签页查看。`n" -ForegroundColor DarkGray
