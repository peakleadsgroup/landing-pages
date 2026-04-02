# Refresh Airtable base schema from Meta API
# Run: .\scripts\refresh-airtable-schema.ps1
# Requires: schema:read scope on your Airtable personal access token

# Set AIRTABLE_API_KEY in the environment (same name as Cloudflare secret), or paste for a one-off session:
#   $env:AIRTABLE_API_KEY = "pat_..."
$baseId = "appmBb0lzqRK9dI8v"
$token = $env:AIRTABLE_API_KEY
if (-not $token) {
    Write-Host "Error: Set environment variable AIRTABLE_API_KEY (your Airtable personal access token with schema:read)."
    exit 1
}
$url = "https://api.airtable.com/v0/meta/bases/$baseId/tables"
$outPath = Join-Path $PSScriptRoot "..\airtable-base-schema.json"

try {
    $response = Invoke-RestMethod -Uri $url -Headers @{ "Authorization" = "Bearer $token" } -Method Get
    $response | ConvertTo-Json -Depth 20 | Out-File -FilePath $outPath -Encoding utf8
    Write-Host "Schema saved to airtable-base-schema.json"
} catch {
    Write-Host "Error: $_"
    Write-Host "Ensure your token has schema:read scope. See: https://airtable.com/developers/web/api/meta-base-schema"
}
