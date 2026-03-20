# Run CaptionTester
#   .\run.ps1              -> uses saved config (headless)
#   .\run.ps1 -styles       -> style picker GUI (5 caption styles)
#   .\run.ps1 audio.mp3     -> audio only (output auto-generated)
#   .\run.ps1 audio.mp3 out.mp4
Set-Location $PSScriptRoot
if ($args.Count -eq 0) {
    & .\venv\Scripts\python.exe caption_tester.py --from-config
} elseif ($args[0] -eq "-styles" -or $args[0] -eq "-s") {
    & .\venv\Scripts\python.exe caption_tester.py --styles
} else {
    & .\venv\Scripts\python.exe caption_tester.py @args
}
