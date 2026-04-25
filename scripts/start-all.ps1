param(
  [switch]$SkipDbPush
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

function Stop-ExistingStack {
  param(
    [string]$RepoRoot
  )

  Write-Host "Stopping existing ExampleHR processes..." -ForegroundColor Yellow

  $targetPatterns = @(
    "*$RepoRoot*nest.js*start --watch*",
    "*$RepoRoot*scripts\\mock-hcm.ts*",
    "*$RepoRoot*frontend*next*dev*",
    "*$RepoRoot*dist\\src\\main*"
  )

  $processes = Get-CimInstance Win32_Process | Where-Object {
    if ($_.Name -ne "node.exe") { return $false }
    $cmd = if ($null -eq $_.CommandLine) { "" } else { $_.CommandLine.ToLower() }
    ($targetPatterns | Where-Object { $cmd -like $_.ToLower() }).Count -gt 0
  }

  foreach ($process in $processes) {
    try {
      Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop
      Write-Host "Stopped PID $($process.ProcessId)" -ForegroundColor DarkGray
    }
    catch {
      Write-Host "Could not stop PID $($process.ProcessId): $($_.Exception.Message)" -ForegroundColor DarkYellow
    }
  }

  $portsToClear = @(3000, 3001, 4001)
  foreach ($port in $portsToClear) {
    $connections = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    foreach ($connection in $connections) {
      try {
        Stop-Process -Id $connection.OwningProcess -Force -ErrorAction Stop
        Write-Host "Freed port $port (PID $($connection.OwningProcess))" -ForegroundColor DarkGray
      }
      catch {
        Write-Host "Could not free port $port (PID $($connection.OwningProcess)): $($_.Exception.Message)" -ForegroundColor DarkYellow
      }
    }
  }
}

function Start-TerminalProcess {
  param(
    [string]$Title,
    [string]$Command,
    [string]$WorkingDirectory
  )

  $escapedWorkingDirectory = $WorkingDirectory.Replace("'", "''")
  $escapedCommand = $Command.Replace("'", "''")

  $psCommand = @"
`$Host.UI.RawUI.WindowTitle = '$Title';
Set-Location '$escapedWorkingDirectory';
$escapedCommand
"@

  Start-Process powershell.exe -ArgumentList @(
    "-NoExit",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    $psCommand
  ) | Out-Null
}

Write-Host "Starting ExampleHR stack from $repoRoot" -ForegroundColor Cyan
Stop-ExistingStack -RepoRoot $repoRoot

if (-not $SkipDbPush) {
  Write-Host "Running Prisma db push..." -ForegroundColor Yellow
  npx prisma db push
}

Write-Host "Launching Mock HCM, Backend, and Frontend terminals..." -ForegroundColor Yellow

Start-TerminalProcess `
  -Title "ExampleHR Mock HCM" `
  -WorkingDirectory $repoRoot `
  -Command "npm run mock:hcm"

Start-TerminalProcess `
  -Title "ExampleHR Backend" `
  -WorkingDirectory $repoRoot `
  -Command "npm run start:dev"

Start-TerminalProcess `
  -Title "ExampleHR Frontend" `
  -WorkingDirectory (Join-Path $repoRoot "frontend") `
  -Command "npm run dev"

Write-Host ""
Write-Host "All processes started." -ForegroundColor Green
Write-Host "Frontend: http://localhost:3001"
Write-Host "Backend:  http://localhost:3000"
Write-Host "Mock HCM: http://localhost:4001"
Write-Host ""
Write-Host "Tip: Use -SkipDbPush to skip schema sync on next runs."
