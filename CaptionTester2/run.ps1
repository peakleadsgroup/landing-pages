# CaptionTester2 - one word, yellow highlight
# Uses CaptionTester venv (shared deps)
Set-Location $PSScriptRoot
$venv = "..\CaptionTester\venv\Scripts\python.exe"
if (-not (Test-Path $venv)) { $venv = ".\venv\Scripts\python.exe" }
if ($args.Count -eq 0) {
    & $venv caption_tester_highlight.py --from-config
} else {
    & $venv caption_tester_highlight.py @args
}
