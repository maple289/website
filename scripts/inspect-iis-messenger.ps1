# Read-only IIS diagnostics. Run on the Windows machine hosting MyHostage,
# using Windows PowerShell as Administrator. Reports selected settings only.
# Reference: https://learn.microsoft.com/en-us/iis/configuration/system.webserver/websocket
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object -TypeName Security.Principal.WindowsPrincipal -ArgumentList $identity
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Open Windows PowerShell as Administrator on the computer hosting IIS, then run this check.'
}

$report = [ordered]@{
    Computer = $env:COMPUTERNAME
    IPv4 = @()
    WebSocketFeature = 'Unable to determine'
    WebSocketModuleInstalled = $null
    ArrModuleInstalled = $null
    ArrProxyEnabled = $null
    Sites = @()
}
try {
    $report.IPv4 = @(Get-NetIPAddress -AddressFamily IPv4 |
        Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
        Select-Object InterfaceAlias, IPAddress)
} catch { }

try {
    if (Get-Command Get-WindowsFeature -ErrorAction SilentlyContinue) {
        $report.WebSocketFeature = [string](Get-WindowsFeature -Name Web-WebSockets).InstallState
    } else {
        $report.WebSocketFeature = [string](Get-WindowsOptionalFeature -Online -FeatureName IIS-WebSockets).State
    }
} catch { }

$iisRoot = Join-Path $env:SystemRoot 'System32\inetsrv'
if ([Environment]::Is64BitOperatingSystem -and -not [Environment]::Is64BitProcess) {
    $iisRoot = Join-Path $env:SystemRoot 'Sysnative\inetsrv'
}
$adminLibrary = Join-Path $iisRoot 'Microsoft.Web.Administration.dll'
if (-not (Test-Path -LiteralPath $adminLibrary)) {
    $report['IisInspection'] = 'IIS administration components not found. Confirm this is the computer hosting the landing page.'
    $report | ConvertTo-Json -Depth 6
    return
}

Add-Type -Path $adminLibrary
$manager = New-Object Microsoft.Web.Administration.ServerManager
try {
    $config = $manager.GetApplicationHostConfiguration()
    $moduleNames = @($config.GetSection('system.webServer/globalModules').GetCollection() |
        ForEach-Object { [string]$_['name'] })
    $report.WebSocketModuleInstalled = $moduleNames -contains 'WebSocketModule'
    $report.ArrModuleInstalled = $moduleNames -contains 'ApplicationRequestRouting'
    try { $report.ArrProxyEnabled = [bool]$config.GetSection('system.webServer/proxy')['enabled'] } catch { }

    foreach ($site in $manager.Sites) {
        $applications = @()
        foreach ($application in $site.Applications) {
            $enabled = $null
            $moduleActive = $null
            try {
                $effective = $manager.GetWebConfiguration($site.Name, $application.Path)
                $enabled = [bool]$effective.GetSection('system.webServer/webSocket')['enabled']
                $effectiveModules = @($effective.GetSection('system.webServer/modules').GetCollection() |
                    ForEach-Object { [string]$_['name'] })
                $moduleActive = $effectiveModules -contains 'WebSocketModule'
            } catch { }
            $applications += [ordered]@{
                UrlPath = $application.Path
                WebSocketEnabled = $enabled
                WebSocketModuleActive = $moduleActive
            }
        }
        $report.Sites += [ordered]@{
            Name = $site.Name
            Bindings = @($site.Bindings | ForEach-Object { $_.Protocol + ' ' + $_.BindingInformation })
            Applications = $applications
        }
    }
} finally {
    $manager.Dispose()
}
$report | ConvertTo-Json -Depth 6
