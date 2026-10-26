param([ValidateRange(0,3600)][int]$RestartDelaySeconds = 60)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$entry = Join-Path $PSScriptRoot 'service-runtime.js'
$nodeBinary = (Get-Command node.exe -ErrorAction Stop).Source
for ($attempt = 0; $attempt -le 3; $attempt++) {
    $worker = Start-Process -FilePath $nodeBinary -ArgumentList @(('"' + $entry + '"'), 'start') -WorkingDirectory $projectRoot -WindowStyle Hidden -Wait -PassThru
    $worker.Refresh()
    $result = $worker.ExitCode
    $worker.Dispose()
    if ($null -eq $result) { throw 'Worker exit code unavailable; refusing to start another instance.' }
    if ($result -eq 0) { exit 0 }
    if ($attempt -eq 3) { exit $result }
    Write-Output ('Supervisor exited; retry ' + ($attempt + 1) + ' of 3 after ' + $RestartDelaySeconds + ' seconds.')
    Start-Sleep -Seconds $RestartDelaySeconds
}
