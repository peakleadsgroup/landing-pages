# CaptionTester3 - multi-word, current highlighted yellow
Set-Location $PSScriptRoot
$venv = "..\CaptionTester\venv\Scripts\python.exe"
if (-not (Test-Path $venv)) { $venv = ".\venv\Scripts\python.exe" }
if ($args.Count -eq 0) {
    & $venv caption_tester_multiword.py --from-config
} else {
    & $venv caption_tester_multiword.py @args
}
