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
& $gitExe -C $siteRoot push
if ($LASTEXITCODE -ne 0) {
  Write-Host "`n推送失败。常见原因：" -ForegroundColor Red
  Write-Host "  · 还没把公钥加到 GitHub（Settings → SSH and GPG keys）"
  Write-Host "  · 仓库还没建，或仓库名不是 gevenchou.github.io"
  Write-Host "  · 网络到 GitHub 不通"
  exit 1
}

Write-Host "`n发布完成。GitHub 会自动构建，约一分钟后访问：" -ForegroundColor Green
Write-Host "  https://gevenchou.github.io" -ForegroundColor Green
Write-Host "构建状态可在仓库的 Actions 标签页查看。`n" -ForegroundColor DarkGray
