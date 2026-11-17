$ErrorActionPreference = 'Stop'

function Test-LocalPort([int] $Port) {
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $pending = $client.BeginConnect('127.0.0.1', $Port, $null, $null)
        if (-not $pending.AsyncWaitHandle.WaitOne(2000)) { return $false }
        $client.EndConnect($pending)
        return $true
    } catch {
        return $false
    } finally {
        $client.Close()
    }
}

try {
    Write-Host 'Infinity HTTPS readiness check - READ ONLY'
    Write-Host 'No files, services or database rows are changed.'
    Write-Host ''

    $serverAddresses = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty IPAddress)
    if ($serverAddresses.Count -eq 0) {
        $serverAddresses = @([System.Net.Dns]::GetHostAddresses($env:COMPUTERNAME) | ForEach-Object { $_.IPAddressToString })
    }
    if ('192.168.140.222' -notin $serverAddresses) {
        throw 'Run this check on the production server that hosts the SQLPage_ share.'
    }
    Write-Host 'Production server: detected'

    $adapterReady = Test-LocalPort 3201
    $sqlpageReady = Test-LocalPort 4438
    Write-Host ('Adapter port 3201: ' + $(if ($adapterReady) { 'LISTENING' } else { 'NOT LISTENING' }))
    Write-Host ('SQLPage HTTP port 4438: ' + $(if ($sqlpageReady) { 'LISTENING' } else { 'NOT LISTENING' }))

    foreach ($port in @(443, 80)) {
        $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)
        $processIds = @($listeners | Select-Object -ExpandProperty OwningProcess -Unique)
        if ($processIds.Count -eq 0) {
            Write-Host ("Port ${port}: free")
        }
        foreach ($listenerProcessId in $processIds) {
            $process = Get-Process -Id $listenerProcessId -ErrorAction SilentlyContinue
            Write-Host ("Port ${port} owner: " + $process.ProcessName + ' (PID ' + $listenerProcessId + ')')
            $services = @(Get-CimInstance Win32_Service -Filter ('ProcessId = ' + $listenerProcessId) -ErrorAction SilentlyContinue)
            if ($services.Count -eq 0) {
                Write-Host '  Windows service: none found for this process'
            } else {
                foreach ($service in $services) {
                    Write-Host ('  Windows service: ' + $service.Name + ' / ' + $service.DisplayName)
                }
            }
        }
    }

    $shareRoot = Split-Path -Parent $PSScriptRoot
    $sqlpageConfigPath = Join-Path $shareRoot 'Jobcard Offical_2\sqlpage\sqlpage.json'
    if (Test-Path -LiteralPath $sqlpageConfigPath) {
        $configuration = Get-Content -LiteralPath $sqlpageConfigPath -Raw | ConvertFrom-Json
        Write-Host ('SQLPage configured HTTP port: ' + $configuration.port)
        Write-Host ('SQLPage configured HTTPS domain: ' + $configuration.https_domain)
    } else {
        Write-Host 'SQLPage configuration: expected adjacent folder not found; review its server-local path.'
    }

    Write-Host ''
    if (-not $adapterReady -or -not $sqlpageReady) {
        throw 'One of the internal listeners is missing. Do not switch the public HTTPS routing yet.'
    }
    Write-Host 'Read-only checks complete. Share this output before the HTTPS switch.'
    exit 0
} catch {
    Write-Host ('CHECK STOPPED: ' + $_.Exception.Message) -ForegroundColor Yellow
    exit 1
}
