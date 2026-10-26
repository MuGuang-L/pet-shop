$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$entry = Join-Path $PSScriptRoot 'service-runtime.js'
$nodeBinary = (Get-Command node.exe -ErrorAction Stop).Source
$worker = Start-Process -FilePath $nodeBinary -ArgumentList @(('"' + $entry + '"'), 'start') -WorkingDirectory $projectRoot -WindowStyle Hidden -Wait -PassThru
exit $worker.ExitCode
