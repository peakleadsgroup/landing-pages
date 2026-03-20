# CaptionTester

Standalone test program that works exactly like the [No-Code Architects toolkit](https://github.com/stephengpope/no-code-architects-toolkit):

- **Whisper** with `word_timestamps=True` (same as NCA)
- **ASS highlight style** – current word in yellow, rest white
- **Black video** + audio + captions for quick testing

## Setup

```powershell
cd CaptionTester
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

Requires FFmpeg on PATH.

## Usage

**CLI:**
```powershell
python caption_tester.py audio.mp3
python caption_tester.py audio.mp3 output.mp4
```

**GUI (no args):**
```powershell
python caption_tester.py
```
Opens file dialogs to pick audio and save location.

## Output

Creates a 1920x1080 black video with your audio and NCA-style word-highlight captions.
