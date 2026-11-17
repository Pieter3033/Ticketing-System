$ErrorActionPreference = 'Stop'

try {
    Write-Host 'Existing Caddy inspection - no running configuration changes'
    Write-Host 'Reads settings and saves a private backup. Does not reload or stop anything.'
    Write-Host ''

    $addresses = @([System.Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces() |
        ForEach-Object { $_.GetIPProperties().UnicastAddresses } |
        ForEach-Object { $_.Address.IPAddressToString })
    if ('192.168.140.222' -notin $addresses) {
        throw 'Run this inspection on the production server.'
    }

    $processes = @(Get-Process -Name 'caddy*' -ErrorAction SilentlyContinue)
    if ($processes.Count -eq 0) { throw 'No existing Caddy process was found.' }
    $binaryPaths = @()
    $configCandidates = @()
    foreach ($process in $processes) {
        Write-Host ('Existing Caddy: ' + $process.ProcessName + ' (PID ' + $process.Id + ')')
        try { $binaryPath = $process.Path } catch { $binaryPath = $null }
        if ($binaryPath) {
            $binaryPaths += $binaryPath
            Write-Host ('Executable: ' + $binaryPath)
            foreach ($filename in @('Caddyfile', 'caddy.json')) {
                $candidate = Join-Path (Split-Path -Parent $binaryPath) $filename
                if (Test-Path -LiteralPath $candidate) { $configCandidates += $candidate }
            }
        }
    }

    $metadata = [ordered]@{
        runningConfigurationChanged = $false
        executables = $binaryPaths
        adjacentConfigurationCandidates = $configCandidates
        adminConfigurationReadable = $false
        privateSnapshotRelativePath = $null
    }

    Write-Host ''
    Write-Host 'Reading Caddy settings through its local administration endpoint (GET only)...'
    $response = $null
    $reader = $null
    try {
        $request = [System.Net.HttpWebRequest]::Create('http://127.0.0.1:2019/config/')
        $request.Method = 'GET'
        $request.Timeout = 5000
        $request.ReadWriteTimeout = 5000
        $request.Proxy = $null
        $response = $request.GetResponse()
        $reader = New-Object System.IO.StreamReader($response.GetResponseStream())
        $configurationText = $reader.ReadToEnd()
        if ($configurationText.Length -gt 2097152) { throw 'Configuration exceeds the inspection size limit.' }
        $configuration = $configurationText | ConvertFrom-Json
        if (-not $configuration.apps.http.servers) { throw 'Response does not contain Caddy HTTP server settings.' }

        $backupDirectory = Join-Path $PSScriptRoot 'private-backups'
        New-Item -ItemType Directory -Path $backupDirectory -Force | Out-Null
        $backupName = 'existing-caddy-' + [Guid]::NewGuid().ToString('N').Substring(0, 8) + '.private.json'
        $snapshotRelativePath = Join-Path 'private-backups' $backupName
        $snapshotPath = Join-Path $PSScriptRoot $snapshotRelativePath
        [System.IO.File]::WriteAllText($snapshotPath, $configurationText, (New-Object System.Text.UTF8Encoding($false)))

        $listeners = @($configuration.apps.http.servers.PSObject.Properties |
            ForEach-Object { $_.Value.listen } | Select-Object -Unique)
        $metadata.adminConfigurationReadable = $true
        $metadata.privateSnapshotRelativePath = $snapshotRelativePath
        $metadata.listeners = $listeners
        Write-Host 'Existing configuration: backed up privately for review'
        Write-Host ('Caddy listeners: ' + ($listeners -join ', '))
        Write-Host 'Configuration contents and credentials have not been printed.'
    } catch {
        Write-Host 'The default administration endpoint could not be read.'
        Write-Host 'Its address may be customised or disabled; running settings were left untouched.'
    } finally {
        if ($reader) { $reader.Dispose() }
        if ($response) { $response.Close() }
    }

    foreach ($candidate in $configCandidates) {
        Write-Host ('Possible configuration file: ' + $candidate)
    }
    $metadataPath = Join-Path $PSScriptRoot 'existing-caddy-inspection.json'
    [System.IO.File]::WriteAllText($metadataPath, ($metadata | ConvertTo-Json -Depth 8), (New-Object System.Text.UTF8Encoding($false)))
    Write-Host ''
    Write-Host 'Inspection complete. Send the output window only; keep private backups out of chat.'
    exit 0
} catch {
    Write-Host ('INSPECTION STOPPED: ' + $_.Exception.Message) -ForegroundColor Yellow
    exit 1
}
