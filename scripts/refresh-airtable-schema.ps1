# Refresh Airtable base schema from Meta API
# Run: .\scripts\refresh-airtable-schema.ps1
# Requires: schema:read scope on your Airtable personal access token

$baseId = "appmBb0lzqRK9dI8v"
$token = "pato6OZtm7CrR83po.9400ea9366fb0dcec3f346273c8b427fb7804557897f19e99bcd8a886284b589"
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
