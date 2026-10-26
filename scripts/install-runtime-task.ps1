param([switch]$Remove)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$digest = [Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($projectRoot.ToLowerInvariant()))
$taskName = 'PetShop-' + ([BitConverter]::ToString($digest).Replace('-', '').Substring(0, 16))
$runner = Join-Path $PSScriptRoot 'run-supervised.ps1'
$powershellBinary = Join-Path $PSHOME 'powershell.exe'
if (!(Test-Path -LiteralPath $powershellBinary)) { $powershellBinary = (Get-Command powershell.exe -ErrorAction Stop).Source }
$arguments = '-NoProfile -NonInteractive -WindowStyle Hidden -File "' + $runner + '"'
$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing -and ($existing.Actions.Count -ne 1 -or $existing.Actions[0].Arguments -ne $arguments)) {
    throw 'A different task already uses this name; nothing was changed.'
}
if ($Remove) {
    if ($existing) { Unregister-ScheduledTask -TaskName $taskName -Confirm:$false }
    Write-Host 'Logon task removed. Running services were not stopped.'
    exit 0
}
& (Get-Command node.exe -ErrorAction Stop).Source (Join-Path $PSScriptRoot 'service-runtime.js') validate
if ($LASTEXITCODE -ne 0) { throw 'Fix the private runtime configuration before installing the logon task.' }
$userId = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$action = New-ScheduledTaskAction -Execute $powershellBinary -Argument $arguments -WorkingDirectory $projectRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $userId
$principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$task = New-ScheduledTask -Action $action -Trigger $trigger -Principal $principal -Settings $settings
Register-ScheduledTask -TaskName $taskName -InputObject $task -Force | Out-Null
Write-Host 'Logon recovery task registered for the current user. It was not started now.'
