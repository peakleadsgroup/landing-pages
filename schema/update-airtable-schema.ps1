# Refresh Airtable base schema from Airtable Meta API.
# This script prompts for the API key at runtime and never saves it.
#
# Run from repo root:
#   .\schema\update-airtable-schema.ps1

param(
    [string]$BaseId = "appmBb0lzqRK9dI8v"
)

$outPath = Join-Path $PSScriptRoot "airtable-base-schema.json"
$url = "https://api.airtable.com/v0/meta/bases/$BaseId/tables"

$token = Read-Host "Enter Airtable API key (visible input; not saved)"
if (-not $token) {
    Write-Host "No API key entered. Aborting."
    exit 1
}

try {
    # Remove hidden control characters that can appear on paste and break HTTP headers.
    $token = ($token -replace '[\x00-\x1F\x7F]', '').Trim()
    if ([string]::IsNullOrWhiteSpace($token)) {
        Write-Host "Empty API key entered. Aborting."
        exit 1
    }

    $response = Invoke-RestMethod -Uri $url -Headers @{ "Authorization" = "Bearer $token" } -Method Get
    $response | ConvertTo-Json -Depth 30 | Out-File -FilePath $outPath -Encoding utf8
    Write-Host "Schema updated: $outPath"
    Write-Host "Reminder: API key was used in-memory only and was not saved."
}
catch {
    Write-Host "Failed to refresh schema: $($_.Exception.Message)"
    Write-Host "Ensure the key has 'schema:read' scope."
    exit 1
}
