$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class GaiaImportNativeUi {
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr window, uint message, IntPtr wparam, IntPtr lparam);
  [DllImport("user32.dll", EntryPoint="SendMessageW", CharSet=CharSet.Unicode)] public static extern IntPtr SetText(IntPtr window, uint message, IntPtr wparam, string text);
}
'@
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$projectOutput = if ($env:GAIA_IMPORT_OUTPUT) { [IO.Path]::GetFullPath($env:GAIA_IMPORT_OUTPUT) } else { Join-Path $projectRoot 'dist\previews\import-smoke' }
New-Item -ItemType Directory -Force -Path $projectOutput | Out-Null
$projectControl = Join-Path $projectOutput 'control.json'
$projectReportFile = Join-Path $projectOutput 'report.json'
foreach ($projectOldResult in @($projectControl, $projectReportFile)) {
  if (Test-Path -LiteralPath $projectOldResult) { Remove-Item -LiteralPath $projectOldResult }
}
$projectExecutable = Join-Path $projectRoot 'node_modules\electron\dist\electron.exe'
$projectScript = Join-Path $PSScriptRoot 'import-smoke.js'
# This is the interactive application under test: its native picker must receive normal focus.
$projectProcess = Start-Process -FilePath $projectExecutable -ArgumentList ('"' + $projectScript + '"') -WindowStyle Normal -PassThru -RedirectStandardOutput (Join-Path $projectOutput 'stdout.log') -RedirectStandardError (Join-Path $projectOutput 'stderr.log')
# Retain the handle before polling; Windows PowerShell otherwise loses ExitCode after exit.
$null = $projectProcess.Handle
$projectDeadline = (Get-Date).AddSeconds(190)
$projectHandled = ''
try {
  while (-not $projectProcess.HasExited -and (Get-Date) -lt $projectDeadline) {
    if (Test-Path -LiteralPath $projectControl) {
      try { $projectCommand = Get-Content -LiteralPath $projectControl -Raw -Encoding UTF8 | ConvertFrom-Json } catch { Start-Sleep -Milliseconds 100; continue }
      if ($projectCommand.id -ne $projectHandled) {
        $projectCondition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, [int]$projectCommand.pid)
        $projectWindow = [System.Windows.Automation.AutomationElement]::RootElement.FindFirst([System.Windows.Automation.TreeScope]::Children, $projectCondition)
        if ($projectWindow) {
          $projectDialog = $projectWindow.FindFirst([System.Windows.Automation.TreeScope]::Descendants, (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, $projectCommand.title)))
          if ($projectDialog) {
            if ($projectSettledDialog -ne $projectCommand.id) { $projectSettledDialog = $projectCommand.id; Start-Sleep -Milliseconds 1000; continue }
            # Query the legacy control by ID; UIA's combined modern/legacy tree can omit it in broad scans.
            try {
              $projectEdits = $projectDialog.FindAll([System.Windows.Automation.TreeScope]::Descendants, (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::AutomationIdProperty, '1148')))
              if (-not $projectEdits.Count) { $projectEdits = $projectDialog.FindAll([System.Windows.Automation.TreeScope]::Descendants, (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::AutomationIdProperty, '1152'))) }
            }
            catch [System.Windows.Automation.ElementNotAvailableException] { Start-Sleep -Milliseconds 100; continue }
            $projectEdit = $projectEdits | Where-Object { $_.Current.ClassName -eq 'Edit' } | Select-Object -First 1
            if (-not $projectEdit) { Start-Sleep -Milliseconds 100; continue }
            $projectValue = if ($projectCommand.folder) { $projectCommand.paths[0] } else { ($projectCommand.paths | ForEach-Object { '"' + $_ + '"' }) -join ' ' }
            if ($projectEdit.Current.IsOffscreen -or -not $projectEdit.Current.IsEnabled) { Start-Sleep -Milliseconds 100; continue }
            # Focus the filename control on its own dialog thread, without sending keys to another app.
            [GaiaImportNativeUi]::SendMessage([IntPtr]$projectDialog.Current.NativeWindowHandle, 0x0028, [IntPtr]$projectEdit.Current.NativeWindowHandle, [IntPtr]1) | Out-Null
            [GaiaImportNativeUi]::SetText([IntPtr]$projectEdit.Current.NativeWindowHandle, 0x000C, [IntPtr]::Zero, $projectValue) | Out-Null
            $projectOpen = $projectDialog.FindAll([System.Windows.Automation.TreeScope]::Descendants, (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::AutomationIdProperty, '1'))) | Where-Object { $_.Current.ClassName -eq 'Button' } | Select-Object -First 1
            if (-not $projectOpen) { throw 'Native Open button was not found' }
            [GaiaImportNativeUi]::SendMessage([IntPtr]$projectOpen.Current.NativeWindowHandle, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
            $projectHandled = $projectCommand.id
            Write-Output ('Native selection: ' + $projectHandled)
          }
        }
      }
    }
    Start-Sleep -Milliseconds 100
    $projectProcess.Refresh()
  }
  if (-not $projectProcess.HasExited) { throw 'Native UI test exceeded its deadline' }
  $projectProcess.WaitForExit()
  if ($projectProcess.ExitCode -ne 0) { throw ('Native UI test process failed with exit code ' + $projectProcess.ExitCode) }
  if (-not (Test-Path -LiteralPath $projectReportFile)) { throw 'Native UI test exited without producing a report' }
  $projectReport = Get-Content -LiteralPath $projectReportFile -Raw -Encoding UTF8 | ConvertFrom-Json
  Write-Output ($projectReport | Select-Object passed,checks,error | ConvertTo-Json -Depth 4)
  if (-not $projectReport.passed) { exit 1 }
} finally {
  $projectProcess.Refresh()
  if (-not $projectProcess.HasExited) { Stop-Process -Id $projectProcess.Id }
}
