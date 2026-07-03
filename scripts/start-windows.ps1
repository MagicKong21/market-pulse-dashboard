param(
  [Parameter(Mandatory = $true)][string]$NodePath,
  [Parameter(Mandatory = $true)][string]$ProjectRoot
)

$ErrorActionPreference = "Stop"
$port = if ($env:PORT) { $env:PORT } else { "4173" }
$url = "http://127.0.0.1:$port"
$healthUrl = "$url/api/health"
$nodeMajor = [int](& $NodePath -p "process.versions.node.split('.')[0]")

if ($nodeMajor -lt 22) {
  Write-Error "Node.js 版本过旧，本项目需要 Node.js 22 或更高版本。请下载已内置运行环境的 Release 版本。"
  exit 1
}

function Test-Dashboard {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $healthUrl -TimeoutSec 1
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

if (Test-Dashboard) {
  Start-Process $url
  exit 0
}

$env:HOST = "127.0.0.1"
$process = Start-Process -FilePath $NodePath -ArgumentList "server.mjs" -WorkingDirectory $ProjectRoot -NoNewWindow -PassThru

try {
  for ($attempt = 0; $attempt -lt 80; $attempt++) {
    if (Test-Dashboard) {
      Start-Process $url
      Write-Host "股票看板正在运行：$url"
      Write-Host "关闭此窗口或按 Ctrl+C 即可停止。"
      Wait-Process -Id $process.Id
      exit $process.ExitCode
    }
    if ($process.HasExited) { break }
    Start-Sleep -Milliseconds 250
  }

  Write-Error "启动失败，请查看上方错误信息。"
  exit 1
} finally {
  if (-not $process.HasExited) {
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
  }
}
